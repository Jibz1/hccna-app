//! POSTs one GraphQL operation to Strapi 5 and decodes its `data`, ported from
//! `packages/strapi-v2/src/transport.ts` with the server's `serviceRequest` instrumentation
//! (`apps/server/src/effect/services/cms/content/v5Layer.ts`, `httpFetch`).

use std::future::Future;
use std::time::Duration;

use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::Value;
use serde_json::error::Category;
use serde_json::value::RawValue;

use super::StrapiError;
use crate::config::{CmsConfig, Secret};
use crate::metrics::Metrics;
use crate::upstream;

/// The `service` metric label of every Strapi 5 call, as in `v5Layer.ts`.
pub const SERVICE: &str = "strapi-v5";
/// `REQUEST_TIMEOUT_MS`: each attempt, headers and body, inside the 20 s request budget.
pub const REQUEST_TIMEOUT: Duration = Duration::from_millis(4000);
/// `Schedule.exponential("500 millis")`: 500 ms, then 1 s.
pub const RETRY_BASE: Duration = Duration::from_millis(500);
/// `Schedule.upTo({ times: 2 })`: three attempts in all.
pub const MAX_RETRIES: u32 = 2;

pub struct Transport {
    http: reqwest::Client,
    endpoint: String,
    token: Secret,
    metrics: Metrics,
    timeout: Duration,
    retry_base: Duration,
}

impl Transport {
    pub fn new(config: &CmsConfig, http: reqwest::Client, metrics: Metrics) -> Self {
        Self {
            http,
            endpoint: config.endpoint.clone(),
            token: config.token.clone(),
            metrics,
            timeout: REQUEST_TIMEOUT,
            retry_base: RETRY_BASE,
        }
    }

    /// Runs `operation` with `variables` and decodes its `data` as `T`, retrying transport
    /// failures, 5xx, 408 and 429 up to twice with exponential backoff.
    pub async fn query<T: DeserializeOwned>(
        &self,
        operation: &'static str,
        document: &str,
        variables: &Value,
    ) -> Result<T, StrapiError> {
        // `JSON.stringify({ operationName, query, variables })`: the same bytes on every attempt.
        let body = serde_json::to_vec(&RequestBody {
            operation_name: operation,
            query: document,
            variables,
        })
        .map_err(|error| StrapiError::Decode {
            operation,
            detail: error.to_string(),
        })?;
        with_retries(self.retry_base, || self.once(operation, body.clone())).await
    }

    async fn once<T: DeserializeOwned>(
        &self,
        operation: &'static str,
        body: Vec<u8>,
    ) -> Result<T, StrapiError> {
        let request = self
            .http
            .post(&self.endpoint)
            .timeout(self.timeout)
            .header(http::header::CONTENT_TYPE, "application/json")
            .header(
                http::header::AUTHORIZATION,
                format!("Bearer {}", self.token.expose()),
            )
            // The CMS's strapi-cache plugin caches /graphql answers, authorized ones too, and
            // misses some purges; no-cache makes it skip its cache (the server keeps its own).
            .header(http::header::CACHE_CONTROL, "no-cache")
            .body(body)
            .send();
        // Like `serviceRequest`, the metrics cover the fetch (until the headers arrive).
        let response = upstream::observe(&self.metrics, SERVICE, operation, request)
            .await
            .map_err(|_| StrapiError::Transport {
                operation,
                detail: "Failed to reach Strapi 5".to_owned(),
            })?;

        let status = response.status();
        if !status.is_success() {
            let start = read_error_body_start(response).await;
            return Err(StrapiError::Status {
                operation,
                status: status.as_u16(),
                detail: format!(
                    "Strapi 5 responded {} {}{}",
                    status.as_u16(),
                    status.canonical_reason().unwrap_or_default(),
                    graphql_errors_suffix(&start)
                ),
            });
        }

        let bytes = response.bytes().await.map_err(|_| StrapiError::Transport {
            operation,
            detail: "Failed to read the Strapi 5 response body".to_owned(),
        })?;
        decode_body(operation, &bytes)
    }
}

#[derive(serde::Serialize)]
struct RequestBody<'a> {
    #[serde(rename = "operationName")]
    operation_name: &'a str,
    query: &'a str,
    variables: &'a Value,
}

/// `Envelope` in `transport.ts`: `data` is optional and nullable; `errors`, when present, is a
/// list of objects with a string `message`.
#[derive(Deserialize)]
struct Envelope<'a> {
    #[serde(default, borrow)]
    data: Option<&'a RawValue>,
    #[serde(default, deserialize_with = "present")]
    errors: Option<Vec<GraphqlErrorMessage>>,
}

#[derive(Deserialize)]
struct GraphqlErrorMessage {
    message: String,
}

/// An optional key that, when present, must not be `null` (`Schema.optional(Schema.Array(…))`).
fn present<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

/// Decodes a 2xx body: not JSON → Decode, GraphQL errors → GraphQL, `data` not a `T` → Decode.
fn decode_body<T: DeserializeOwned>(
    operation: &'static str,
    bytes: &[u8],
) -> Result<T, StrapiError> {
    let decode = |detail: String| StrapiError::Decode { operation, detail };
    // `response.text()` decodes UTF-8 with replacement characters and drops a byte-order mark.
    let text = String::from_utf8_lossy(bytes);
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    let envelope: Envelope =
        serde_json::from_str(text).map_err(|error| match error.classify() {
            Category::Data => decode(error.to_string()),
            Category::Io | Category::Syntax | Category::Eof => {
                decode("Response body is not JSON".to_owned())
            }
        })?;
    if let Some(errors) = envelope.errors.filter(|errors| !errors.is_empty()) {
        let messages: Vec<_> = errors.into_iter().map(|error| error.message).collect();
        return Err(StrapiError::GraphQL {
            operation,
            detail: messages.join("; "),
        });
    }
    // A missing `data` decodes like `null`, which no record shape accepts.
    serde_json::from_str(envelope.data.map_or("null", RawValue::get))
        .map_err(|error| decode(error.to_string()))
}

/// Enough for Strapi's GraphQL validation messages; the rest of an error body is never read.
const ERROR_BODY_MAX_BYTES: usize = 2048;

/// The first 2 KB of a non-OK body, best-effort: a body that cannot be read counts as empty.
async fn read_error_body_start(mut response: reqwest::Response) -> String {
    let mut bytes = Vec::new();
    while bytes.len() < ERROR_BODY_MAX_BYTES {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                let take = chunk.len().min(ERROR_BODY_MAX_BYTES - bytes.len());
                bytes.extend_from_slice(&chunk[..take]);
            }
            Ok(None) => break,
            Err(_) => return String::new(),
        }
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

/// `: <message>; <message>` when the body is a GraphQL error response, otherwise "".
fn graphql_errors_suffix(body: &str) -> String {
    #[derive(Deserialize)]
    struct ErrorBody {
        errors: Vec<GraphqlErrorMessage>,
    }
    match serde_json::from_str::<ErrorBody>(body) {
        Ok(ErrorBody { errors }) if !errors.is_empty() => {
            let messages: Vec<_> = errors.into_iter().map(|error| error.message).collect();
            format!(": {}", messages.join("; "))
        }
        _ => String::new(),
    }
}

/// Runs `attempt` until it succeeds, fails with a non-retryable error, or has been retried
/// `MAX_RETRIES` times, sleeping `base`, `2 × base`, … between attempts.
async fn with_retries<T, F, Fut>(base: Duration, mut attempt: F) -> Result<T, StrapiError>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, StrapiError>>,
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
    use super::*;
    use crate::strapi::StrapiErrorReason;
    use serde::Deserialize;
    use serde_json::json;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, Request, ResponseTemplate};

    #[derive(Debug, Deserialize, PartialEq)]
    struct Ping {
        ping: String,
    }

    const TOKEN: &str = "example-cms-token";

    /// A transport against `endpoint` whose backoff is 1 ms, so HTTP-level retry tests stay
    /// fast; `backs_off_exponentially_from_500_ms` covers the real schedule on paused time.
    fn transport(endpoint: String, metrics: &Metrics) -> Transport {
        let config = CmsConfig {
            endpoint,
            token: Secret::new(TOKEN),
        };
        let mut transport = Transport::new(
            &config,
            crate::upstream::http_client().unwrap(),
            metrics.clone(),
        );
        transport.retry_base = Duration::from_millis(1);
        transport
    }

    async fn ping(server_uri: &str, metrics: &Metrics) -> Result<Ping, StrapiError> {
        transport(format!("{server_uri}/graphql"), metrics)
            .query("Ping", "query Ping { ping }", &json!({ "a": 1 }))
            .await
    }

    /// Answers each request with the next response, repeating the last one.
    async fn serve(responses: Vec<ResponseTemplate>) -> MockServer {
        let server = MockServer::start().await;
        let queue = Arc::new(Mutex::new(responses));
        Mock::given(method("POST"))
            .and(path("/graphql"))
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

    fn json_response(status: u16, body: Value) -> ResponseTemplate {
        ResponseTemplate::new(status).set_body_string(body.to_string())
    }

    async fn requests(server: &MockServer) -> Vec<Request> {
        server.received_requests().await.unwrap()
    }

    #[tokio::test]
    async fn posts_the_named_operation_with_a_bearer_token_and_decodes_data() {
        let server = serve(vec![json_response(
            200,
            json!({ "data": { "ping": "pong" } }),
        )])
        .await;
        let metrics = Metrics::new();

        let result = ping(&server.uri(), &metrics).await;

        assert_eq!(
            result,
            Ok(Ping {
                ping: "pong".to_owned()
            })
        );
        let requests = requests(&server).await;
        assert_eq!(requests.len(), 1);
        let headers = &requests[0].headers;
        assert_eq!(headers["authorization"], "Bearer example-cms-token");
        assert_eq!(headers["content-type"], "application/json");
        assert_eq!(headers["cache-control"], "no-cache");
        // `JSON.stringify({ operationName, query, variables })`, key order included.
        assert_eq!(
            String::from_utf8(requests[0].body.clone()).unwrap(),
            r#"{"operationName":"Ping","query":"query Ping { ping }","variables":{"a":1}}"#
        );
    }

    #[tokio::test]
    async fn asks_the_cms_to_skip_its_response_cache_on_every_attempt() {
        let server = serve(vec![
            json_response(503, json!({})),
            json_response(200, json!({ "data": { "ping": "pong" } })),
        ])
        .await;

        ping(&server.uri(), &Metrics::new()).await.unwrap();

        let cache_control: Vec<_> = requests(&server)
            .await
            .iter()
            .map(|request| request.headers["cache-control"].clone())
            .collect();
        assert_eq!(cache_control, ["no-cache", "no-cache"]);
    }

    #[tokio::test]
    async fn retries_a_503_and_succeeds() {
        let server = serve(vec![
            json_response(503, json!({})),
            json_response(200, json!({ "data": { "ping": "pong" } })),
        ])
        .await;

        let result = ping(&server.uri(), &Metrics::new()).await;

        assert!(result.is_ok());
        assert_eq!(requests(&server).await.len(), 2);
    }

    #[tokio::test]
    async fn retries_408_and_429() {
        for status in [408, 429] {
            let server = serve(vec![
                json_response(status, json!({})),
                json_response(200, json!({ "data": { "ping": "pong" } })),
            ])
            .await;
            assert!(ping(&server.uri(), &Metrics::new()).await.is_ok());
            assert_eq!(requests(&server).await.len(), 2, "status {status}");
        }
    }

    #[tokio::test]
    async fn does_not_retry_a_401() {
        let server = serve(vec![json_response(401, json!({}))]).await;

        let error = ping(&server.uri(), &Metrics::new()).await.unwrap_err();

        assert_eq!(error.reason(), StrapiErrorReason::Status);
        assert!(matches!(error, StrapiError::Status { status: 401, .. }));
        assert_eq!(requests(&server).await.len(), 1);
    }

    #[tokio::test]
    async fn keeps_strapis_graphql_messages_from_a_400_without_retrying() {
        let server = serve(vec![json_response(
            400,
            json!({ "errors": [{ "message": "Cannot query field \"x\" on type \"Campus\"." }] }),
        )])
        .await;

        let error = ping(&server.uri(), &Metrics::new()).await.unwrap_err();

        assert_eq!(
            error,
            StrapiError::Status {
                operation: "Ping",
                status: 400,
                detail: r#"Strapi 5 responded 400 Bad Request: Cannot query field "x" on type "Campus"."#
                    .to_owned(),
            }
        );
        assert_eq!(requests(&server).await.len(), 1);
    }

    #[tokio::test]
    async fn retries_a_503_with_a_non_json_body_and_reports_only_its_status() {
        let server = serve(vec![
            ResponseTemplate::new(503).set_body_string("<html>upstream unavailable</html>"),
        ])
        .await;

        let error = ping(&server.uri(), &Metrics::new()).await.unwrap_err();

        assert_eq!(error.reason(), StrapiErrorReason::Status);
        assert_eq!(error.detail(), "Strapi 5 responded 503 Service Unavailable");
        assert_eq!(requests(&server).await.len(), 3);
    }

    #[tokio::test]
    async fn reads_only_the_first_2_kb_of_an_error_body() {
        // Valid GraphQL errors, but past 2 KB: the truncated start is not JSON, so no suffix.
        let message = "x".repeat(4096);
        let server = serve(vec![json_response(
            400,
            json!({ "errors": [{ "message": message }] }),
        )])
        .await;

        let error = ping(&server.uri(), &Metrics::new()).await.unwrap_err();

        assert_eq!(error.detail(), "Strapi 5 responded 400 Bad Request");
        assert_eq!(requests(&server).await.len(), 1);
    }

    #[tokio::test]
    async fn fails_with_graphql_errors_without_retrying() {
        let server = serve(vec![json_response(
            200,
            json!({ "data": null, "errors": [{ "message": "Forbidden access" }, { "message": "Again" }] }),
        )])
        .await;

        let error = ping(&server.uri(), &Metrics::new()).await.unwrap_err();

        assert_eq!(
            error,
            StrapiError::GraphQL {
                operation: "Ping",
                detail: "Forbidden access; Again".to_owned()
            }
        );
        assert_eq!(requests(&server).await.len(), 1);
    }

    #[tokio::test]
    async fn ignores_an_empty_errors_list() {
        let server = serve(vec![json_response(
            200,
            json!({ "data": { "ping": "pong" }, "errors": [] }),
        )])
        .await;

        assert!(ping(&server.uri(), &Metrics::new()).await.is_ok());
    }

    #[tokio::test]
    async fn fails_with_decode_when_data_does_not_match() {
        for body in [
            json!({ "data": { "ping": 42 } }),
            json!({ "data": null }),
            json!({}),
            json!({ "data": { "ping": "pong" }, "errors": null }),
            json!({ "data": { "ping": "pong" }, "errors": [{ "message": 1 }] }),
        ] {
            let server = serve(vec![json_response(200, body.clone())]).await;

            let error = ping(&server.uri(), &Metrics::new()).await.unwrap_err();

            assert_eq!(error.reason(), StrapiErrorReason::Decode, "{body}");
            assert_eq!(error.operation(), "Ping");
            assert_eq!(requests(&server).await.len(), 1);
        }
    }

    #[tokio::test]
    async fn fails_with_decode_on_a_non_json_body_without_retrying() {
        let server = serve(vec![ResponseTemplate::new(200).set_body_string("not json")]).await;

        let error = ping(&server.uri(), &Metrics::new()).await.unwrap_err();

        assert_eq!(
            error,
            StrapiError::Decode {
                operation: "Ping",
                detail: "Response body is not JSON".to_owned()
            }
        );
        assert_eq!(requests(&server).await.len(), 1);
    }

    #[tokio::test]
    async fn retries_transport_failures_twice_then_fails_recording_each_attempt() {
        let metrics = Metrics::new();

        // Nothing listens on port 1, so every attempt is refused.
        let error = ping("http://127.0.0.1:1", &metrics).await.unwrap_err();

        assert_eq!(error.reason(), StrapiErrorReason::Transport);
        assert_eq!(error.detail(), "Failed to reach Strapi 5");
        let text = metrics.render();
        assert!(text.contains(r#"service_request_total{action="Ping",service="strapi-v5"} 3"#));
        assert!(text.contains(r#"service_error_total{action="Ping",service="strapi-v5"} 3"#));
    }

    #[tokio::test]
    async fn records_each_attempt_and_counts_only_unreached_strapi_as_an_error() {
        let server = serve(vec![
            json_response(503, json!({})),
            json_response(200, json!({ "data": { "ping": "pong" } })),
        ])
        .await;
        let metrics = Metrics::new();

        ping(&server.uri(), &metrics).await.unwrap();

        // `serviceRequest` wraps `fetch` only: a 503 answer is a request, not a service error.
        let text = metrics.render();
        assert!(text.contains(r#"service_request_total{action="Ping",service="strapi-v5"} 2"#));
        assert!(
            text.contains(r#"service_request_duration_count{action="Ping",service="strapi-v5"} 2"#)
        );
        assert!(!text.contains("service_error_total{"));
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
            serve_truncated(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n{\"da").await;
        let metrics = Metrics::new();

        let error = ping(&format!("http://{address}"), &metrics)
            .await
            .unwrap_err();

        assert_eq!(
            error,
            StrapiError::Transport {
                operation: "Ping",
                detail: "Failed to read the Strapi 5 response body".to_owned()
            }
        );
        assert_eq!(*accepted.lock().unwrap(), 3);
        // The headers arrived, so `serviceRequest` saw three successful fetches.
        assert!(!metrics.render().contains("service_error_total{"));
    }

    #[tokio::test]
    async fn keeps_the_status_detail_when_an_error_body_fails_mid_read() {
        let (address, accepted) =
            serve_truncated(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 100\r\n\r\n{\"er").await;

        let error = ping(&format!("http://{address}"), &Metrics::new())
            .await
            .unwrap_err();

        // The unreadable body counts as empty: no GraphQL messages, and a 401 is not retried.
        assert_eq!(error.reason(), StrapiErrorReason::Status);
        assert_eq!(error.detail(), "Strapi 5 responded 401 Unauthorized");
        assert_eq!(*accepted.lock().unwrap(), 1);
    }

    #[tokio::test]
    async fn times_out_each_attempt_and_retries() {
        let server = serve(vec![
            json_response(200, json!({ "data": { "ping": "pong" } }))
                .set_delay(Duration::from_millis(500)),
        ])
        .await;
        let metrics = Metrics::new();
        let mut transport = transport(format!("{}/graphql", server.uri()), &metrics);
        transport.timeout = Duration::from_millis(50);

        let error = transport
            .query::<Ping>("Ping", "query Ping { ping }", &json!({}))
            .await
            .unwrap_err();

        assert_eq!(error.reason(), StrapiErrorReason::Transport);
        assert_eq!(requests(&server).await.len(), 3);
        assert!(
            metrics
                .render()
                .contains(r#"service_error_total{action="Ping",service="strapi-v5"} 3"#)
        );
    }

    #[test]
    fn uses_the_ts_timeout_and_schedule() {
        assert_eq!(REQUEST_TIMEOUT, Duration::from_secs(4));
        assert_eq!(RETRY_BASE, Duration::from_millis(500));
        assert_eq!(MAX_RETRIES, 2);
    }

    #[tokio::test(start_paused = true)]
    async fn backs_off_exponentially_from_500_ms() {
        let start = tokio::time::Instant::now();
        let attempts = Arc::new(Mutex::new(Vec::new()));
        let seen = attempts.clone();

        let result: Result<(), StrapiError> = with_retries(RETRY_BASE, || {
            seen.lock().unwrap().push(start.elapsed());
            async {
                Err(StrapiError::Status {
                    operation: "Ping",
                    status: 503,
                    detail: "Strapi 5 responded 503 Service Unavailable".to_owned(),
                })
            }
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

    #[tokio::test(start_paused = true)]
    async fn does_not_back_off_after_a_non_retryable_error_or_success() {
        let calls = Arc::new(Mutex::new(0));
        let counter = calls.clone();
        let result: Result<(), StrapiError> = with_retries(RETRY_BASE, || {
            *counter.lock().unwrap() += 1;
            async {
                Err(StrapiError::Decode {
                    operation: "Ping",
                    detail: "bad".to_owned(),
                })
            }
        })
        .await;
        assert!(result.is_err());
        assert_eq!(*calls.lock().unwrap(), 1);

        let ok: Result<u8, StrapiError> = with_retries(RETRY_BASE, || async { Ok(7) }).await;
        assert_eq!(ok, Ok(7));
    }
}
