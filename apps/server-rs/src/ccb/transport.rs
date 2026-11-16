//! The GET path of `createCCBClient` (`packages/ccb/src/client.ts`) with the instrumentation of
//! the server's `httpFetch` (`serviceRequest` in `apps/server/src/effect/services/CCBService.ts`):
//! `GET {CCB_API_END_POINT}?<query>` with HTTP Basic auth, a 15 s deadline per attempt covering
//! headers and body, and up to two retries, 500 ms and then 1 s later, after a transport failure
//! (including a body that fails mid-read), 5xx, 408 or 429. Each attempt is one
//! `service_request` sample (`service="ccb"`, `action=<srv>`), timed until the headers arrive.

use std::future::Future;
use std::time::Duration;

use serde::de::DeserializeOwned;

use super::request::CcbRequest;
use super::{CcbError, xml};
use crate::config::{CcbConfig, Secret};
use crate::metrics::Metrics;
use crate::upstream;

/// The `service` metric label, as `CCBService.ts` passes it to `serviceRequest`.
pub const SERVICE: &str = "ccb";
/// The `timeout` `fetchGet` passes to `httpFetch`.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
/// `Schedule.exponential("500 millis")`: 500 ms, then 1 s.
pub const RETRY_BASE: Duration = Duration::from_millis(500);
/// `Schedule.upTo({ times: 2 })`: three attempts in all.
pub const MAX_RETRIES: u32 = 2;

pub struct Transport {
    http: reqwest::Client,
    endpoint: String,
    username: String,
    password: Secret,
    metrics: Metrics,
    timeout: Duration,
    retry_base: Duration,
}

impl Transport {
    pub fn new(config: &CcbConfig, http: reqwest::Client, metrics: Metrics) -> Self {
        Self {
            http,
            endpoint: config.api_endpoint.clone(),
            username: config.username.clone(),
            password: config.password.clone(),
            metrics,
            timeout: REQUEST_TIMEOUT,
            retry_base: RETRY_BASE,
        }
    }

    /// Fetches `request` and decodes its `<response>` as `T`, retrying as the module describes.
    pub async fn get<T: DeserializeOwned>(&self, request: &CcbRequest) -> Result<T, CcbError> {
        with_retries(self.retry_base, || self.once(request)).await
    }

    async fn once<T: DeserializeOwned>(&self, request: &CcbRequest) -> Result<T, CcbError> {
        let action = request.service().srv();
        let send = self
            .http
            .get(format!("{}?{}", self.endpoint, request.query()))
            .timeout(self.timeout)
            .basic_auth(&self.username, Some(self.password.expose()))
            .send();
        // reqwest's error text includes the URL, which can hold an email: keep TS's fixed text.
        let response = upstream::observe(&self.metrics, SERVICE, action, send)
            .await
            .map_err(|_| CcbError::Transport("CCB request failed".to_owned()))?;
        let status = response.status();
        if !status.is_success() {
            tracing::warn!(action, status = status.as_u16(), "CCB GET request failed");
            return Err(CcbError::Status {
                status: status.as_u16(),
            });
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|_| CcbError::Transport("Failed to read response".to_owned()))?;
        xml::decode_body(&bytes)
    }
}

/// Runs `attempt` until it succeeds, fails with an error that is not retryable, or has been
/// retried `MAX_RETRIES` times, sleeping `base`, then `2 × base`, between attempts.
async fn with_retries<T, F, Fut>(base: Duration, mut attempt: F) -> Result<T, CcbError>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, CcbError>>,
{
    let mut retries = 0;
    loop {
        match attempt().await {
            Err(error) if error.is_retryable() && retries < MAX_RETRIES => {
                tokio::time::sleep(base * 2u32.pow(retries)).await;
                retries += 1;
            }
            result => return result,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use wiremock::matchers::{header, method, path, query_param};
    use wiremock::{Mock, MockServer, Request, ResponseTemplate};

    use super::*;
    use crate::ccb::records::IndividualSearch;

    /// `Basic base64("example-user:example-password")`.
    const AUTHORIZATION: &str = "Basic ZXhhbXBsZS11c2VyOmV4YW1wbGUtcGFzc3dvcmQ=";

    const SEARCH: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<ccb_api><response><service>individual_search</service><individuals count="1"><individual id="1001"><first_name>Ada</first_name><last_name>Example</last_name><login>ada@example.com</login><email>ada@example.com</email></individual></individuals></response></ccb_api>"#;

    /// A transport against `endpoint` whose backoff is 1 ms, so retry tests stay fast;
    /// `backs_off_exponentially_from_500_ms` checks the real schedule on paused time.
    fn transport(endpoint: String, metrics: &Metrics) -> Transport {
        let config = CcbConfig {
            api_endpoint: endpoint,
            username: "example-user".to_owned(),
            password: Secret::new("example-password"),
        };
        let mut transport = Transport::new(
            &config,
            crate::upstream::http_client().unwrap(),
            metrics.clone(),
        );
        transport.retry_base = Duration::from_millis(1);
        transport
    }

    async fn search(base: &str, metrics: &Metrics) -> Result<IndividualSearch, CcbError> {
        transport(format!("{base}/api.php"), metrics)
            .get(&CcbRequest::individual_search("ada@example.com"))
            .await
    }

    /// Answers each request with the next response, repeating the last one.
    async fn serve(responses: Vec<ResponseTemplate>) -> MockServer {
        let server = MockServer::start().await;
        let queue = Arc::new(Mutex::new(responses));
        Mock::given(method("GET"))
            .and(path("/api.php"))
            .respond_with(move |_: &Request| {
                let mut queue = queue.lock().unwrap();
                if queue.len() > 1 {
                    queue.remove(0)
                } else {
                    queue[0].clone()
                }
            })
            .mount(&server)
            .await;
        server
    }

    fn xml(status: u16, body: &str) -> ResponseTemplate {
        ResponseTemplate::new(status).set_body_string(body)
    }

    async fn requests(server: &MockServer) -> Vec<Request> {
        server.received_requests().await.unwrap()
    }

    #[tokio::test]
    async fn gets_the_query_with_basic_auth_and_decodes_the_response() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api.php"))
            .and(query_param("srv", "individual_search"))
            .and(query_param("email", "ada@example.com"))
            .and(header("authorization", AUTHORIZATION))
            .respond_with(xml(200, SEARCH))
            .expect(1)
            .mount(&server)
            .await;

        let answer = search(&server.uri(), &Metrics::new()).await.unwrap();

        let individual = &answer.individuals.unwrap().individual[0];
        assert_eq!(individual.id.as_deref(), Some("1001"));
        assert_eq!(
            requests(&server).await[0].url.query(),
            Some("srv=individual_search&email=ada%40example.com")
        );
    }

    #[tokio::test]
    async fn retries_5xx_408_and_429_and_counts_answers_as_requests_not_errors() {
        for status in [500, 503, 408, 429] {
            let server = serve(vec![xml(status, "<html>Busy</html>"), xml(200, SEARCH)]).await;
            let metrics = Metrics::new();

            assert!(search(&server.uri(), &metrics).await.is_ok(), "{status}");

            assert_eq!(requests(&server).await.len(), 2, "{status}");
            let text = metrics.render();
            assert!(
                text.contains(
                    r#"service_request_total{action="individual_search",service="ccb"} 2"#
                )
            );
            assert!(!text.contains("service_error_total{"));
        }
    }

    #[tokio::test]
    async fn gives_up_after_three_attempts() {
        let server = serve(vec![xml(503, "<html>Service Unavailable</html>")]).await;

        let error = search(&server.uri(), &Metrics::new()).await.unwrap_err();

        assert_eq!(error, CcbError::Status { status: 503 });
        assert_eq!(error.to_string(), "CCB API error: 503");
        assert_eq!(requests(&server).await.len(), 3);
    }

    #[tokio::test]
    async fn does_not_retry_other_statuses() {
        for status in [400, 401, 403, 404] {
            let server = serve(vec![xml(status, "")]).await;
            assert_eq!(
                search(&server.uri(), &Metrics::new()).await,
                Err(CcbError::Status { status })
            );
            assert_eq!(requests(&server).await.len(), 1, "{status}");
        }
    }

    // Review Focus: <error> inside a 200, and an HTML page served with 200.
    #[tokio::test]
    async fn does_not_retry_remote_errors_or_bodies_that_do_not_decode() {
        let remote = r#"<ccb_api><response><errors count="1"><error number="20" type="Service Permission">Example permission error</error></errors></response></ccb_api>"#;
        let server = serve(vec![xml(200, remote)]).await;
        assert_eq!(
            search(&server.uri(), &Metrics::new()).await,
            Err(CcbError::Remote {
                message: "Example permission error".to_owned()
            })
        );
        assert_eq!(requests(&server).await.len(), 1);

        let page = r#"<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>Maintenance</body></html>"#;
        let server = serve(vec![xml(200, page)]).await;
        assert!(matches!(
            search(&server.uri(), &Metrics::new()).await,
            Err(CcbError::Decode(_))
        ));
        assert_eq!(requests(&server).await.len(), 1);
    }

    #[tokio::test]
    async fn retries_transport_failures_twice_recording_each_attempt() {
        let metrics = Metrics::new();

        // Nothing listens on port 1, so every attempt is refused.
        let error = search("http://127.0.0.1:1", &metrics).await.unwrap_err();

        assert_eq!(error, CcbError::Transport("CCB request failed".to_owned()));
        let text = metrics.render();
        assert!(
            text.contains(r#"service_request_total{action="individual_search",service="ccb"} 3"#)
        );
        assert!(
            text.contains(r#"service_error_total{action="individual_search",service="ccb"} 3"#)
        );
    }

    #[tokio::test]
    async fn times_out_each_attempt_and_retries() {
        let server = serve(vec![xml(200, SEARCH).set_delay(Duration::from_millis(500))]).await;
        let metrics = Metrics::new();
        let mut transport = transport(format!("{}/api.php", server.uri()), &metrics);
        transport.timeout = Duration::from_millis(50);

        let error = transport
            .get::<IndividualSearch>(&CcbRequest::individual_search("ada@example.com"))
            .await
            .unwrap_err();

        assert_eq!(error, CcbError::Transport("CCB request failed".to_owned()));
        assert_eq!(requests(&server).await.len(), 3);
    }

    /// A server that promises 100 body bytes after `head`, sends a few, then closes the
    /// connection. Returns its address and how many connections it accepted.
    async fn serve_truncated(head: &'static [u8]) -> (std::net::SocketAddr, Arc<Mutex<u32>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let accepted = Arc::new(Mutex::new(0));
        let counter = accepted.clone();
        tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    return;
                };
                *counter.lock().unwrap() += 1;
                let mut buffer = [0u8; 4096];
                let _ = socket.read(&mut buffer).await;
                let _ = socket.write_all(head).await;
                let _ = socket.shutdown().await;
            }
        });
        (address, accepted)
    }

    #[tokio::test]
    async fn retries_a_body_that_fails_mid_read() {
        let (address, accepted) =
            serve_truncated(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n<ccb_api>").await;

        let error = search(&format!("http://{address}"), &Metrics::new())
            .await
            .unwrap_err();

        assert_eq!(
            error,
            CcbError::Transport("Failed to read response".to_owned())
        );
        assert_eq!(*accepted.lock().unwrap(), 3);
    }

    #[test]
    fn uses_the_ts_timeout_and_schedule() {
        assert_eq!(REQUEST_TIMEOUT, Duration::from_secs(15));
        assert_eq!(RETRY_BASE, Duration::from_millis(500));
        assert_eq!(MAX_RETRIES, 2);
    }

    #[tokio::test(start_paused = true)]
    async fn backs_off_exponentially_from_500_ms() {
        let start = tokio::time::Instant::now();
        let attempts = Arc::new(Mutex::new(Vec::new()));
        let seen = attempts.clone();

        let result: Result<(), CcbError> = with_retries(RETRY_BASE, || {
            seen.lock().unwrap().push(start.elapsed());
            async { Err(CcbError::Status { status: 503 }) }
        })
        .await;

        assert!(result.is_err());
        assert_eq!(
            *attempts.lock().unwrap(),
            [
                Duration::ZERO,
                Duration::from_millis(500),
                Duration::from_millis(1500)
            ]
        );
    }
}
