//! Forwarding to the TS server (`docs/superpowers/specs/2026-10-14-server-rs-parity-design.md`,
//! "Forwarding"). The request goes to the configured URL with its body bytes and end-to-end
//! headers; the answer comes back with TS's status, headers and body bytes, still compressed if TS
//! compressed it. One deadline covers the exchange, redirects are not followed, and nothing is
//! retried, so a mutation runs at most once.

use std::time::Duration;

use axum::body::{Body, Bytes};
use axum::http::StatusCode;
use axum::http::header::{self, HeaderMap, HeaderName, HeaderValue};
use axum::response::Response;
use tokio::time::Instant;

use crate::config::GatewayConfig;
use crate::gateway::{Route, Upstream};
use crate::graphql::errors::{error_body, json_response};

/// Added to every forwarded request, so the TS side can tell forwarded traffic apart.
pub const FORWARDED_BY_HEADER: HeaderName = HeaderName::from_static("x-hccna-forwarded-by");

/// The value of [`FORWARDED_BY_HEADER`].
pub const FORWARDED_BY: &str = "hccna-backend-rs";

/// The error message when TS does not answer.
pub const UPSTREAM_UNAVAILABLE_MESSAGE: &str = "Upstream unavailable.";

/// Why a forward got no response.
#[derive(Debug, thiserror::Error)]
pub enum ForwardError {
    #[error("the TS server did not answer before the request deadline")]
    Deadline,
    #[error("the TS server could not be reached: {0}")]
    Unreachable(String),
}

/// The HTTP client and target for forwarded requests.
pub struct Forwarder {
    client: reqwest::Client,
    target: url::Url,
}

impl Forwarder {
    pub fn new(config: &GatewayConfig) -> reqwest::Result<Self> {
        Ok(Self {
            client: client()?,
            target: config.ts_graphql_url.clone(),
        })
    }

    /// Forwards one request and returns the response for the client: TS's answer, or 502 (TS
    /// unreachable) or 504 (`deadline` passed) with a GraphQL error body. The response carries
    /// [`Route::Forward`] and an [`Upstream`] in its extensions. Failures are logged and reported.
    pub async fn forward(
        &self,
        headers: &HeaderMap,
        client_address: Option<&str>,
        body: Bytes,
        deadline: Instant,
    ) -> Response {
        let started = std::time::Instant::now();
        let outcome = if Instant::now() >= deadline {
            // `timeout_at` polls the exchange once before it checks the clock, which would send
            // the request on an idle pooled connection. A deadline that has already passed sends
            // nothing.
            Err(ForwardError::Deadline)
        } else {
            let request = self
                .client
                .post(self.target.clone())
                .headers(request_headers(headers, client_address))
                .body(body);
            let exchange = async {
                let upstream = request.send().await?;
                let status = upstream.status();
                let headers = response_headers(upstream.headers());
                let body = upstream.bytes().await?;
                Ok::<_, reqwest::Error>((status, headers, body))
            };
            match tokio::time::timeout_at(deadline, exchange).await {
                Ok(Ok(answer)) => Ok(answer),
                Ok(Err(error)) => Err(ForwardError::Unreachable(error_chain(&error))),
                Err(_) => Err(ForwardError::Deadline),
            }
        };
        let duration = started.elapsed();
        let mut response = match outcome {
            Ok((status, headers, body)) => {
                let mut response = Response::new(Body::from(body));
                *response.status_mut() = status;
                *response.headers_mut() = headers;
                response.extensions_mut().insert(Upstream {
                    status: Some(status.as_u16()),
                    duration,
                });
                response
            }
            Err(error) => {
                let request_id = headers
                    .get("x-request-id")
                    .and_then(|value| value.to_str().ok());
                tracing::error!(
                    cause = %error,
                    request_id,
                    duration_ms = duration_ms(duration),
                    "Forward to the TS server failed"
                );
                crate::reporting::report_upstream_failure(
                    matches!(error, ForwardError::Deadline),
                    &error.to_string(),
                    request_id,
                );
                let status = match error {
                    ForwardError::Deadline => StatusCode::GATEWAY_TIMEOUT,
                    ForwardError::Unreachable(_) => StatusCode::BAD_GATEWAY,
                };
                let mut response =
                    json_response(status, &error_body(UPSTREAM_UNAVAILABLE_MESSAGE, None));
                response.extensions_mut().insert(Upstream {
                    status: None,
                    duration,
                });
                response
            }
        };
        response.extensions_mut().insert(Route::Forward);
        response
    }
}

/// How long an idle connection to TS stays pooled. Over Railway's private network this client talks
/// HTTP/1.1 to Bun directly, and Bun closes a connection after 20 s without a request
/// (`idleTimeout` in `apps/server/src/api.ts`). A request written on a connection Bun is closing
/// fails and is not retried, so the pool drops connections first.
const POOL_IDLE_TIMEOUT: Duration = Duration::from_secs(15);

/// A client for TS alone: no automatic decompression (bodies pass through as sent), no redirects,
/// no retries, no proxy from the environment, and the bundled web PKI roots like
/// [`crate::upstream::http_client`]. It pools connections to the origin for
/// [`POOL_IDLE_TIMEOUT`]. The deadline is per request, in [`Forwarder::forward`].
pub fn client() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .no_proxy()
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .no_zstd()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .tls_built_in_native_certs(false)
        .connect_timeout(Duration::from_secs(5))
        .pool_idle_timeout(POOL_IDLE_TIMEOUT)
        .build()
}

/// The request headers TS receives: the client's end-to-end headers, minus hop-by-hop ones,
/// `host` and `content-length` (the client library sets both for the new connection), with
/// `x-forwarded-for` set to `client_address` and [`FORWARDED_BY_HEADER`] added. Client-supplied
/// values of those two are dropped.
pub fn request_headers(incoming: &HeaderMap, client_address: Option<&str>) -> HeaderMap {
    let nominated = connection_tokens(incoming);
    let mut headers = HeaderMap::with_capacity(incoming.len() + 2);
    for (name, value) in incoming {
        let dropped = is_hop_by_hop(name, &nominated)
            || name == header::HOST
            || name == header::CONTENT_LENGTH
            || name.as_str() == "x-forwarded-for"
            || name == FORWARDED_BY_HEADER;
        if !dropped {
            headers.append(name.clone(), value.clone());
        }
    }
    if let Some(address) = client_address.and_then(|address| HeaderValue::from_str(address).ok()) {
        headers.insert(HeaderName::from_static("x-forwarded-for"), address);
    }
    headers.insert(FORWARDED_BY_HEADER, HeaderValue::from_static(FORWARDED_BY));
    headers
}

/// The response headers the client receives: TS's, minus hop-by-hop ones and `content-length`
/// (the server sets it again for the buffered body).
pub fn response_headers(upstream: &HeaderMap) -> HeaderMap {
    let nominated = connection_tokens(upstream);
    let mut headers = HeaderMap::with_capacity(upstream.len());
    for (name, value) in upstream {
        if !is_hop_by_hop(name, &nominated) && name != header::CONTENT_LENGTH {
            headers.append(name.clone(), value.clone());
        }
    }
    headers
}

/// Headers that belong to one connection (RFC 9110 section 7.6.1): the fixed set, any `proxy-*`
/// header, and any header the `connection` header names.
fn is_hop_by_hop(name: &HeaderName, nominated: &[String]) -> bool {
    matches!(
        name.as_str(),
        "connection" | "keep-alive" | "te" | "trailer" | "transfer-encoding" | "upgrade"
    ) || name.as_str().starts_with("proxy-")
        || nominated.iter().any(|token| token == name.as_str())
}

/// The lowercase header names listed in `connection`.
fn connection_tokens(headers: &HeaderMap) -> Vec<String> {
    headers
        .get_all(header::CONNECTION)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .map(|token| token.trim().to_ascii_lowercase())
        .filter(|token| !token.is_empty())
        .collect()
}

/// An error and its sources, `: `-separated: reqwest's own message leaves out the cause.
fn error_chain(error: &dyn std::error::Error) -> String {
    let mut text = error.to_string();
    let mut source = error.source();
    while let Some(cause) = source {
        text.push_str(": ");
        text.push_str(&cause.to_string());
        source = cause.source();
    }
    text
}

fn duration_ms(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1000.0
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use axum::http::{HeaderMap, HeaderValue, StatusCode};
    use http_body_util::BodyExt;
    use serde_json::{Value, json};

    use super::*;
    use crate::test_support::{MockOrigin, origin_reply};

    fn headers(pairs: &[(&'static str, &'static str)]) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for (name, value) in pairs {
            headers.append(*name, HeaderValue::from_static(value));
        }
        headers
    }

    fn forwarder(origin: &str) -> Forwarder {
        let mut url = url::Url::parse(origin).expect("a valid origin");
        url.set_path("/graphql");
        Forwarder::new(&GatewayConfig {
            ts_graphql_url: url,
        })
        .expect("the client builds")
    }

    fn soon(millis: u64) -> Instant {
        Instant::now() + Duration::from_millis(millis)
    }

    async fn body_bytes(response: Response) -> Bytes {
        response
            .into_body()
            .collect()
            .await
            .expect("the body is readable")
            .to_bytes()
    }

    fn gzip(text: &str) -> Vec<u8> {
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder
            .write_all(text.as_bytes())
            .expect("writes to memory");
        encoder.finish().expect("finishes in memory")
    }

    #[test]
    fn keeps_end_to_end_request_headers() {
        let incoming = headers(&[
            ("authorization", "Bearer example-token"),
            ("content-type", "application/json"),
            ("accept", "application/graphql-response+json"),
            ("accept-encoding", "gzip"),
            ("user-agent", "HCCNA/2.1.0"),
            ("x-firebase-appcheck", "example-app-check"),
            ("x-hccna-app-version", "2.1.0"),
            (
                "traceparent",
                "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
            ),
            ("x-request-id", "example-request"),
            ("cookie", "a=1"),
            ("cookie", "b=2"),
        ]);
        let forwarded = request_headers(&incoming, Some("203.0.113.9"));
        for (name, value) in &incoming {
            assert!(
                forwarded.get_all(name).iter().any(|kept| kept == value),
                "{name} was dropped"
            );
        }
        assert_eq!(forwarded.get_all("cookie").iter().count(), 2);
    }

    #[test]
    fn drops_hop_by_hop_host_and_length_headers() {
        let incoming = headers(&[
            ("connection", "keep-alive, x-hop"),
            ("keep-alive", "timeout=5"),
            ("proxy-authorization", "Basic example"),
            ("proxy-connection", "keep-alive"),
            ("te", "trailers"),
            ("trailer", "x-checksum"),
            ("transfer-encoding", "chunked"),
            ("upgrade", "h2c"),
            ("x-hop", "named by connection"),
            ("host", "hccna-backend-rs-production.up.railway.app"),
            ("content-length", "42"),
            ("content-type", "application/json"),
        ]);
        let forwarded = request_headers(&incoming, None);
        let names: Vec<&str> = forwarded.keys().map(HeaderName::as_str).collect();
        assert_eq!(names, ["content-type", "x-hccna-forwarded-by"]);
    }

    #[test]
    fn sets_forwarded_for_and_forwarded_by_over_client_values() {
        let incoming = headers(&[
            ("x-forwarded-for", "198.51.100.1, 198.51.100.2"),
            ("x-hccna-forwarded-by", "someone-else"),
        ]);
        let forwarded = request_headers(&incoming, Some("203.0.113.9"));
        assert_eq!(forwarded.get_all("x-forwarded-for").iter().count(), 1);
        assert_eq!(forwarded["x-forwarded-for"], "203.0.113.9");
        assert_eq!(forwarded.get_all("x-hccna-forwarded-by").iter().count(), 1);
        assert_eq!(forwarded["x-hccna-forwarded-by"], "hccna-backend-rs");
        // No derived address: the client's value is still not passed on.
        assert!(!request_headers(&incoming, None).contains_key("x-forwarded-for"));
    }

    #[test]
    fn passes_response_headers_except_hop_by_hop_and_length() {
        let upstream = headers(&[
            ("content-type", "application/json; charset=utf-8"),
            ("content-encoding", "gzip"),
            ("vary", "Accept-Encoding"),
            ("etag", "\"example\""),
            ("set-cookie", "a=1"),
            ("set-cookie", "b=2"),
            ("connection", "close"),
            ("keep-alive", "timeout=5"),
            ("transfer-encoding", "chunked"),
            ("content-length", "42"),
        ]);
        let passed = response_headers(&upstream);
        let names: Vec<&str> = passed.keys().map(HeaderName::as_str).collect();
        assert_eq!(
            names,
            [
                "content-type",
                "content-encoding",
                "vary",
                "etag",
                "set-cookie"
            ]
        );
        assert_eq!(passed.get_all("set-cookie").iter().count(), 2);
    }

    #[tokio::test]
    async fn sends_the_body_to_the_fixed_target_and_returns_the_answer() {
        let origin = MockOrigin::start(|| {
            origin_reply(
                StatusCode::INTERNAL_SERVER_ERROR,
                r#"{"errors":[{"message":"Unexpected error."}]}"#,
                &[("x-ts-header", "kept")],
            )
        })
        .await;
        let body = Bytes::from_static(br#"{"query":"mutation M { setVerseOfTheDay }"}"#);
        let incoming = headers(&[
            ("content-type", "application/json"),
            ("host", "attacker.example.com"),
        ]);
        let response = forwarder(&origin.url)
            .forward(&incoming, Some("203.0.113.9"), body.clone(), soon(5_000))
            .await;

        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(response.headers()["x-ts-header"], "kept");
        assert_eq!(response.extensions().get::<Route>(), Some(&Route::Forward));
        assert_eq!(
            response.extensions().get::<Upstream>().map(|up| up.status),
            Some(Some(500))
        );
        assert_eq!(
            body_bytes(response).await,
            r#"{"errors":[{"message":"Unexpected error."}]}"#
        );

        let requests = origin.requests();
        assert_eq!(requests.len(), 1);
        let received = &requests[0];
        assert_eq!(received.method, axum::http::Method::POST);
        assert_eq!(received.uri, "/graphql");
        assert_eq!(received.body, body);
        // The client's Host never chooses the target.
        assert_eq!(
            received.headers["host"],
            origin.url.trim_start_matches("http://")
        );
        assert_eq!(received.headers["x-forwarded-for"], "203.0.113.9");
        assert_eq!(received.headers["x-hccna-forwarded-by"], "hccna-backend-rs");
    }

    #[tokio::test]
    async fn passes_gzip_bodies_through_compressed() {
        let compressed = gzip(r#"{"data":{"profile":null}}"#);
        let reply_body = compressed.clone();
        let origin = MockOrigin::start(move || {
            let mut response = axum::response::Response::new(Body::from(reply_body.clone()));
            response
                .headers_mut()
                .insert(header::CONTENT_ENCODING, HeaderValue::from_static("gzip"));
            response
        })
        .await;
        let incoming = headers(&[("accept-encoding", "gzip")]);
        let response = forwarder(&origin.url)
            .forward(&incoming, None, Bytes::from_static(b"{}"), soon(5_000))
            .await;
        assert_eq!(response.headers()["content-encoding"], "gzip");
        assert_eq!(body_bytes(response).await, compressed);
        assert_eq!(origin.requests()[0].headers["accept-encoding"], "gzip");
    }

    #[tokio::test]
    async fn does_not_ask_for_compression_the_client_did_not_ask_for() {
        let origin = MockOrigin::start(|| origin_reply(StatusCode::OK, "{}", &[])).await;
        forwarder(&origin.url)
            .forward(
                &HeaderMap::new(),
                None,
                Bytes::from_static(b"{}"),
                soon(5_000),
            )
            .await;
        assert!(!origin.requests()[0].headers.contains_key("accept-encoding"));
    }

    #[tokio::test]
    async fn returns_redirects_without_following_them() {
        let origin = MockOrigin::start(|| {
            origin_reply(
                StatusCode::TEMPORARY_REDIRECT,
                "",
                &[("location", "https://example.com/graphql")],
            )
        })
        .await;
        let response = forwarder(&origin.url)
            .forward(
                &HeaderMap::new(),
                None,
                Bytes::from_static(b"{}"),
                soon(5_000),
            )
            .await;
        assert_eq!(response.status(), StatusCode::TEMPORARY_REDIRECT);
        assert_eq!(
            response.headers()["location"],
            "https://example.com/graphql"
        );
        assert_eq!(origin.requests().len(), 1);
    }

    fn unavailable() -> Value {
        json!({ "errors": [{ "message": "Upstream unavailable." }] })
    }

    #[tokio::test]
    async fn answers_502_when_ts_is_unreachable() {
        let response = forwarder("http://127.0.0.1:1")
            .forward(
                &HeaderMap::new(),
                None,
                Bytes::from_static(b"{}"),
                soon(5_000),
            )
            .await;
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        assert_eq!(
            response.headers()["content-type"],
            "application/json; charset=utf-8"
        );
        assert_eq!(
            response.extensions().get::<Upstream>().map(|up| up.status),
            Some(None)
        );
        let body: Value = serde_json::from_slice(&body_bytes(response).await).unwrap();
        assert_eq!(body, unavailable());
    }

    #[tokio::test]
    async fn answers_504_when_the_deadline_passes() {
        let origin = MockOrigin::start_delayed(Duration::from_secs(5), || {
            origin_reply(StatusCode::OK, "{}", &[])
        })
        .await;
        let started = std::time::Instant::now();
        let response = forwarder(&origin.url)
            .forward(
                &HeaderMap::new(),
                None,
                Bytes::from_static(b"{}"),
                soon(200),
            )
            .await;
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "{:?}",
            started.elapsed()
        );
        assert_eq!(response.status(), StatusCode::GATEWAY_TIMEOUT);
        let body: Value = serde_json::from_slice(&body_bytes(response).await).unwrap();
        assert_eq!(body, unavailable());
    }

    #[tokio::test]
    async fn does_not_send_a_forward_whose_deadline_has_passed() {
        let origin = MockOrigin::start(|| origin_reply(StatusCode::OK, "{}", &[])).await;
        let forwarder = forwarder(&origin.url);
        // Warm the pool: the late forward would then reuse an idle connection and go out at once.
        let warm = forwarder
            .forward(
                &HeaderMap::new(),
                None,
                Bytes::from_static(b"{}"),
                soon(5_000),
            )
            .await;
        assert_eq!(warm.status(), StatusCode::OK);
        let _ = body_bytes(warm).await;
        let response = forwarder
            .forward(
                &HeaderMap::new(),
                None,
                Bytes::from_static(br#"{"query":"mutation M { setVerseOfTheDay }"}"#),
                Instant::now(),
            )
            .await;
        assert_eq!(response.status(), StatusCode::GATEWAY_TIMEOUT);
        assert_eq!(
            response.extensions().get::<Upstream>().map(|up| up.status),
            Some(None)
        );
        assert_eq!(
            response.extensions().get::<Route>().copied(),
            Some(Route::Forward)
        );
        let body: Value = serde_json::from_slice(&body_bytes(response).await).unwrap();
        assert_eq!(body, unavailable());
        tokio::time::sleep(Duration::from_millis(100)).await;
        // Only the warm-up reached the origin.
        assert_eq!(origin.requests().len(), 1);
    }

    /// A TS that reads the request and closes the connection without answering, counting the
    /// requests it read.
    async fn hanging_up_origin() -> (String, std::sync::Arc<std::sync::atomic::AtomicUsize>) {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use tokio::io::AsyncReadExt;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let seen = std::sync::Arc::new(AtomicUsize::new(0));
        let counter = seen.clone();
        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                let mut buffer = [0_u8; 4096];
                if socket.read(&mut buffer).await.unwrap_or(0) > 0 {
                    counter.fetch_add(1, Ordering::SeqCst);
                }
                drop(socket);
            }
        });
        (url, seen)
    }

    #[tokio::test]
    async fn never_retries_a_request_ts_dropped() {
        let (url, seen) = hanging_up_origin().await;
        let response = forwarder(&url)
            .forward(
                &HeaderMap::new(),
                None,
                Bytes::from_static(br#"{"query":"mutation M { setVerseOfTheDay }"}"#),
                soon(5_000),
            )
            .await;
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(seen.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn never_retries_an_error_status() {
        let origin =
            MockOrigin::start(|| origin_reply(StatusCode::SERVICE_UNAVAILABLE, "{}", &[])).await;
        let response = forwarder(&origin.url)
            .forward(
                &HeaderMap::new(),
                None,
                Bytes::from_static(b"{}"),
                soon(5_000),
            )
            .await;
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(origin.requests().len(), 1);
    }

    #[test]
    fn reports_failures_without_request_data() {
        let events = sentry::test::with_captured_events(|| {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            runtime.block_on(async {
                let incoming = headers(&[
                    ("authorization", "Bearer example-token"),
                    ("x-request-id", "example-request"),
                ]);
                forwarder("http://127.0.0.1:1")
                    .forward(&incoming, None, Bytes::from_static(b"{}"), soon(5_000))
                    .await;
            });
        });
        assert_eq!(events.len(), 1);
        let event = &events[0];
        assert_eq!(
            event.message.as_deref(),
            Some(crate::reporting::UPSTREAM_FAILURE_MESSAGE)
        );
        assert_eq!(event.tags["upstream_failure"], "unreachable");
        assert_eq!(event.tags["request_id"], "example-request");
        assert!(event.request.is_none());
        assert!(!format!("{event:?}").contains("example-token"));
    }

    #[tokio::test]
    async fn cancelling_a_forward_never_sends_it_again() {
        // The client hangs up (the handler future is dropped) while TS is still working.
        let origin = MockOrigin::start_delayed(Duration::from_millis(500), || {
            origin_reply(StatusCode::OK, "{}", &[])
        })
        .await;
        let forwarder = forwarder(&origin.url);
        let headers = HeaderMap::new();
        let body = Bytes::from_static(br#"{"query":"mutation M { setVerseOfTheDay }"}"#);
        // Drive the forward until the origin has the request, then drop it: whichever branch of
        // the `select!` finishes first, the other future is dropped.
        let recorded = async {
            while origin.requests().is_empty() {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        };
        tokio::select! {
            _ = forwarder.forward(&headers, None, body, soon(5_000)) => {
                panic!("the forward finished before it was cancelled");
            }
            arrived = tokio::time::timeout(Duration::from_secs(5), recorded) => {
                assert!(arrived.is_ok(), "the origin never received the request");
            }
        }
        // Past the origin's reply delay: a retry or a resend would have shown up by now.
        tokio::time::sleep(Duration::from_millis(700)).await;
        assert_eq!(origin.requests().len(), 1);
    }

    #[test]
    fn passes_an_edge_error_page_through_as_ts_answered_it() {
        // Railway's edge answers for a TS that is down or restarting. That is an answer: it is
        // passed on as it is and is not reported as an upstream failure.
        let events = sentry::test::with_captured_events(|| {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            runtime.block_on(async {
                let origin = MockOrigin::start(|| {
                    let mut response = axum::response::Response::new(Body::from(
                        "<html>Application failed to respond</html>",
                    ));
                    *response.status_mut() = StatusCode::BAD_GATEWAY;
                    response
                        .headers_mut()
                        .insert(header::CONTENT_TYPE, HeaderValue::from_static("text/html"));
                    response
                })
                .await;
                let response = forwarder(&origin.url)
                    .forward(
                        &HeaderMap::new(),
                        None,
                        Bytes::from_static(b"{}"),
                        soon(5_000),
                    )
                    .await;
                assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
                assert_eq!(response.headers()["content-type"], "text/html");
                assert_eq!(
                    response.extensions().get::<Upstream>().map(|up| up.status),
                    Some(Some(502))
                );
                assert_eq!(
                    body_bytes(response).await,
                    "<html>Application failed to respond</html>"
                );
            });
        });
        assert!(events.is_empty());
    }

    #[tokio::test]
    async fn passes_a_large_answer_through_intact() {
        // Answers are buffered whole; nothing caps their size.
        let large: String = "x".repeat(8 * 1024 * 1024);
        let reply = large.clone();
        let origin = MockOrigin::start(move || origin_reply(StatusCode::OK, &reply, &[])).await;
        let response = forwarder(&origin.url)
            .forward(
                &HeaderMap::new(),
                None,
                Bytes::from_static(b"{}"),
                soon(5_000),
            )
            .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(body_bytes(response).await.len(), large.len());
    }
}
