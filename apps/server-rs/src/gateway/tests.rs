//! The gateway through the whole router, against a mock TS origin.

use std::io::{Read, Write};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{HeaderValue, Request, StatusCode, header};
use http_body_util::BodyExt;
use serde_json::{Value, json};

use crate::gateway::route::SERVE_LOCALLY_GATE;
use crate::gateway::{RequestDeadline, Route};
use crate::statsig::testing::FixedGates;
use crate::statsig::{DisabledGates, FeatureGates};
use crate::store::kv::{KeyValueStore, MemoryStore, StoreFuture};
use crate::test_support::{MockOrigin, TestApp, origin_reply, post_graphql};

const TS_ANSWER: &str = r#"{"data":{"from":"ts"}}"#;

async fn ts() -> MockOrigin {
    MockOrigin::start(|| origin_reply(StatusCode::OK, TS_ANSWER, &[])).await
}

/// The app forwarding to `origin`, with `vars` and the kill switch from `kill_switch`.
fn app(origin: &MockOrigin, vars: &[(&str, &str)], kill_switch: Arc<dyn FeatureGates>) -> TestApp {
    let mut env = vec![("TS_ORIGIN_URL", origin.url.as_str())];
    env.extend_from_slice(vars);
    TestApp::with_env_and(&env, |dependencies| {
        dependencies.kill_switch = Some(kill_switch);
    })
}

fn gate_on() -> Arc<dyn FeatureGates> {
    Arc::new(FixedGates::passing(&[SERVE_LOCALLY_GATE]))
}

fn query(text: &str) -> Request<Body> {
    post_graphql(json!({ "query": text }))
}

#[tokio::test]
async fn forwards_a_mutation_and_never_executes_it_locally() {
    let origin = ts().await;
    let app = app(&origin, &[], gate_on());
    let body = json!({ "query": "mutation SetVerseOfTheDay { setVerseOfTheDay }" });
    let response = app.send(post_graphql(body.clone())).await;
    // Executed here, the empty Mutation root would have answered a validation error.
    assert_eq!(response.status, StatusCode::OK);
    assert_eq!(response.body, TS_ANSWER);
    let requests = origin.requests();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].body, body.to_string());
    // The request log still names the operation.
    assert_eq!(response.graphql.unwrap().operation_type, "mutation");
}

#[tokio::test]
async fn serves_local_fields_here_and_forwards_the_rest() {
    let origin = ts().await;
    let app = app(&origin, &[], gate_on());

    let local = app.send(query("query Q { __typename }")).await;
    assert_eq!(local.json(), json!({ "data": { "__typename": "Query" } }));
    assert!(origin.requests().is_empty());

    for forwarded in [
        "query ProfileQuery { profile { id } }",
        "query Mixed { core { title } profile { id } }",
        "query Introspection { __schema { queryType { name } } }",
    ] {
        let response = app.send(query(forwarded)).await;
        assert_eq!(response.body, TS_ANSWER, "{forwarded}");
    }
    assert_eq!(origin.requests().len(), 3);
}

#[tokio::test]
async fn passes_the_shorts_query_through_to_ts() {
    // `shorts` is not ported: TS answers it, and this server neither validates nor runs it.
    let origin = ts().await;
    let app = app(&origin, &[], gate_on());
    let body = json!({
        "operationName": "ShortsFeedQuery",
        "query": "query ShortsFeedQuery { shorts { id videoId title channelTitle thumbnail curated } }",
    });
    let response = app.send(post_graphql(body.clone())).await;
    assert_eq!(response.status, StatusCode::OK);
    assert_eq!(response.body, TS_ANSWER);
    let requests = origin.requests();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].body, body.to_string());
}

#[tokio::test]
async fn answers_unusable_requests_here_while_the_gate_is_on() {
    let origin = ts().await;
    let app = app(&origin, &[], gate_on());
    let parse_error = app.send(query("query X { profile")).await;
    assert_eq!(
        parse_error.json()["errors"][0]["extensions"]["code"],
        "GRAPHQL_PARSE_FAILED"
    );
    let anonymous = app.send(query("{ profile { id } }")).await;
    assert_eq!(
        anonymous.json()["errors"][0]["message"],
        "All operations must have a name. Please add a name to your query/mutation."
    );
    assert!(origin.requests().is_empty());
}

#[tokio::test]
async fn forwards_everything_unread_while_the_gate_is_off_or_unknown() {
    for kill_switch in [
        Arc::new(FixedGates::passing(&[])) as Arc<dyn FeatureGates>,
        Arc::new(DisabledGates),
    ] {
        let origin = ts().await;
        let app = app(&origin, &[], kill_switch);
        let local = app.send(query("query Q { __typename }")).await;
        assert_eq!(local.body, TS_ANSWER);
        // Not even parsed: a body this server would reject goes to TS as it is.
        let malformed = Request::post("/graphql")
            .header("content-type", "application/json")
            .body(Body::from("{not json"))
            .unwrap();
        assert_eq!(app.send(malformed).await.body, TS_ANSWER);
        let requests = origin.requests();
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[1].body, "{not json");
    }
}

#[tokio::test]
async fn passes_a_gzip_answer_through_without_encoding_it_again() {
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(TS_ANSWER.repeat(20).as_bytes()).unwrap();
    let compressed = encoder.finish().unwrap();
    let reply = compressed.clone();
    let origin = MockOrigin::start(move || {
        let mut response = axum::response::Response::new(Body::from(reply.clone()));
        response
            .headers_mut()
            .insert(header::CONTENT_ENCODING, HeaderValue::from_static("gzip"));
        response.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
        response
    })
    .await;
    let app = app(&origin, &[], gate_on());
    let mut request = query("query ProfileQuery { profile { id } }");
    request
        .headers_mut()
        .insert(header::ACCEPT_ENCODING, HeaderValue::from_static("gzip"));

    let response = app.send_raw(request).await;
    assert_eq!(response.headers()[header::CONTENT_ENCODING], "gzip");
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(bytes, compressed);
    let mut text = String::new();
    flate2::read::GzDecoder::new(&bytes[..])
        .read_to_string(&mut text)
        .unwrap();
    assert_eq!(text, TS_ANSWER.repeat(20));
}

fn unavailable() -> Value {
    json!({ "errors": [{ "message": "Upstream unavailable." }] })
}

#[tokio::test]
async fn answers_502_with_rate_limit_headers_when_ts_is_down() {
    // The test configuration points TS_ORIGIN_URL at a closed port.
    let app = TestApp::new();
    let response = app
        .send(query("query ProfileQuery { profile { id } }"))
        .await;
    assert_eq!(response.status, StatusCode::BAD_GATEWAY);
    assert_eq!(response.json(), unavailable());
    assert!(response.headers.contains_key("ratelimit"));
}

#[tokio::test]
async fn rate_limits_before_forwarding() {
    let origin = ts().await;
    let app = app(&origin, &[("GRAPHQL_RATE_LIMIT_RPS", "1")], gate_on());
    let request = || {
        let mut request = query("query ProfileQuery { profile { id } }");
        request
            .headers_mut()
            .insert("x-real-ip", HeaderValue::from_static("203.0.113.7"));
        request
    };
    assert_eq!(app.send(request()).await.status, StatusCode::OK);
    assert_eq!(
        app.send(request()).await.status,
        StatusCode::TOO_MANY_REQUESTS
    );
    assert_eq!(origin.requests().len(), 1);
}

#[tokio::test]
async fn sends_the_rate_limiter_client_address_as_forwarded_for() {
    let origin = ts().await;
    let app = app(&origin, &[], gate_on());
    let peer: SocketAddr = "192.0.2.10:5000".parse().unwrap();

    let mut behind_edge = query("query ProfileQuery { profile { id } }");
    behind_edge
        .headers_mut()
        .insert("x-real-ip", HeaderValue::from_static("203.0.113.9"));
    behind_edge
        .headers_mut()
        .insert("x-forwarded-for", HeaderValue::from_static("198.51.100.1"));
    behind_edge.extensions_mut().insert(ConnectInfo(peer));
    app.send(behind_edge).await;

    let mut direct = query("query ProfileQuery { profile { id } }");
    direct.extensions_mut().insert(ConnectInfo(peer));
    app.send(direct).await;

    let requests = origin.requests();
    assert_eq!(requests[0].headers["x-forwarded-for"], "203.0.113.9");
    assert_eq!(requests[1].headers["x-forwarded-for"], "192.0.2.10");
}

#[tokio::test]
async fn applies_the_body_limit_to_forwarded_requests() {
    let origin = ts().await;
    let app = app(&origin, &[], Arc::new(DisabledGates));
    let padding = " ".repeat(2 * 1024 * 1024);
    let request = Request::post("/graphql")
        .header("content-type", "application/json")
        .body(Body::from(format!(
            r#"{{"query":"mutation M {{ setVerseOfTheDay }}"}}{padding}"#
        )))
        .unwrap();
    assert_eq!(
        app.send(request).await.status,
        StatusCode::PAYLOAD_TOO_LARGE
    );
    assert!(origin.requests().is_empty());
}

#[tokio::test]
async fn marks_every_graphql_response_with_its_route() {
    let origin = ts().await;
    let app = app(&origin, &[], gate_on());
    let local = app.send_raw(query("query Q { __typename }")).await;
    assert_eq!(local.extensions().get::<Route>(), Some(&Route::Local));
    let forwarded = app.send_raw(query("query P { profile { id } }")).await;
    assert_eq!(forwarded.extensions().get::<Route>(), Some(&Route::Forward));
}

#[tokio::test]
async fn passes_not_modified_answers_through_without_a_body() {
    let origin = MockOrigin::start(|| {
        let mut response = axum::response::Response::new(Body::empty());
        *response.status_mut() = StatusCode::NOT_MODIFIED;
        response
            .headers_mut()
            .insert(header::ETAG, HeaderValue::from_static("\"example-etag\""));
        response
    })
    .await;
    let app = app(&origin, &[], gate_on());
    let mut request = query("query ProfileQuery { profile { id } }");
    request.headers_mut().insert(
        header::IF_NONE_MATCH,
        HeaderValue::from_static("\"example-etag\""),
    );
    request
        .headers_mut()
        .insert(header::ACCEPT_ENCODING, HeaderValue::from_static("gzip"));
    let response = app.send_raw(request).await;
    assert_eq!(response.status(), StatusCode::NOT_MODIFIED);
    assert_eq!(response.headers()[header::ETAG], "\"example-etag\"");
    assert!(!response.headers().contains_key(header::CONTENT_ENCODING));
    assert!(
        response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .is_empty()
    );
    assert_eq!(
        origin.requests()[0].headers[header::IF_NONE_MATCH],
        "\"example-etag\""
    );
}

#[tokio::test]
async fn answers_its_own_504_before_the_router_timeout() {
    let origin = MockOrigin::start_delayed(Duration::from_secs(5), || {
        origin_reply(StatusCode::OK, TS_ANSWER, &[])
    })
    .await;
    let app = app(&origin, &[("APP_TIMEOUT_MS", "300")], gate_on());
    let started = std::time::Instant::now();
    let response = app
        .send(query("query ProfileQuery { profile { id } }"))
        .await;
    assert!(started.elapsed() < Duration::from_secs(2));
    assert_eq!(response.status, StatusCode::GATEWAY_TIMEOUT);
    // The gateway's body, not the timeout layer's empty one.
    assert_eq!(response.json(), unavailable());
}

#[tokio::test(start_paused = true)]
async fn deadlines_keep_their_headroom_inside_the_request_timeout() {
    let now = tokio::time::Instant::now();
    assert_eq!(
        RequestDeadline::starting_now(Duration::from_secs(20)).0,
        now + Duration::from_millis(19_900)
    );
    // A timeout shorter than the headroom gives a deadline that has already passed.
    assert_eq!(
        RequestDeadline::starting_now(Duration::from_millis(50)).0,
        now
    );
}

/// A store whose `incr`, the rate limiter's first awaited command, takes `delay`; every other
/// command is `inner`'s.
struct SlowIncr {
    inner: Arc<MemoryStore>,
    delay: Duration,
}

impl KeyValueStore for SlowIncr {
    fn key(&self, suffix: &str) -> String {
        self.inner.key(suffix)
    }

    fn get<'a>(&'a self, key: &'a str) -> StoreFuture<'a, Option<String>> {
        self.inner.get(key)
    }

    fn set_ex<'a>(&'a self, key: &'a str, seconds: u64, value: &'a str) -> StoreFuture<'a, ()> {
        self.inner.set_ex(key, seconds, value)
    }

    fn del<'a>(&'a self, key: &'a str) -> StoreFuture<'a, ()> {
        self.inner.del(key)
    }

    fn incr<'a>(&'a self, key: &'a str) -> StoreFuture<'a, i64> {
        Box::pin(async move {
            tokio::time::sleep(self.delay).await;
            self.inner.incr(key).await
        })
    }

    fn expire<'a>(&'a self, key: &'a str, seconds: i64) -> StoreFuture<'a, ()> {
        self.inner.expire(key, seconds)
    }

    fn ttl<'a>(&'a self, key: &'a str) -> StoreFuture<'a, i64> {
        self.inner.ttl(key)
    }
}

/// The rate limiter's `INCR` takes longer than the 100 ms headroom, so only a deadline stamped
/// before the rate limiter runs answers inside the router's timeout.
#[tokio::test]
async fn stamps_the_deadline_before_a_slow_rate_limiter_runs() {
    let origin = MockOrigin::start_delayed(Duration::from_secs(5), || {
        origin_reply(StatusCode::OK, TS_ANSWER, &[])
    })
    .await;
    let slow_store: Arc<dyn KeyValueStore> = Arc::new(SlowIncr {
        inner: Arc::new(MemoryStore::new("rs:")),
        delay: Duration::from_millis(300),
    });
    let app = TestApp::with_env_and(
        &[
            ("TS_ORIGIN_URL", origin.url.as_str()),
            ("APP_TIMEOUT_MS", "1000"),
        ],
        move |dependencies| {
            dependencies.kv = slow_store;
            dependencies.kill_switch = Some(gate_on());
        },
    );
    let started = std::time::Instant::now();
    let response = app
        .send(query("query ProfileQuery { profile { id } }"))
        .await;
    assert!(started.elapsed() < Duration::from_secs(3));
    assert_eq!(response.status, StatusCode::GATEWAY_TIMEOUT);
    // The gateway's body, not the timeout layer's empty one.
    assert_eq!(response.json(), unavailable());
}
