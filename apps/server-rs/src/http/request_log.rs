//! One log line and the HTTP metrics per request, mirroring `pinoLogger` and
//! `makeRequestTelemetryRecorder` in `apps/server`.

use std::time::Instant;

use axum::extract::{Request, State};
use axum::middleware::Next;
use axum::response::Response;
use serde_json::{Map, Value, json};
use tracing::Level;

use crate::gateway::{Route, Upstream};
use crate::http::client_meta::ClientMetadata;
use crate::state::AppState;

/// What the GraphQL handler learned about the operation. It inserts this into the response's
/// extensions; the request log and metrics read it from there.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GraphqlOperationInfo {
    /// For the log line, formatted as the TS server does (`<name>-untagged`, `anonymous`).
    pub operation_name: String,
    /// For metric labels: a known operation name, `anonymous` or `untagged`. The client chooses
    /// operation names, so labelling by the raw name (as the TS server does) would let anyone
    /// create unbounded Prometheus series.
    pub metric_operation_name: &'static str,
    /// `query`, `mutation` or `subscription`.
    pub operation_type: String,
    /// Root field names.
    pub fields: Vec<String>,
}

/// Uptime and readiness probes hit these about once a minute; only failures are news.
const HEALTH_PROBE_PATHS: [&str; 3] = ["/", "/healthz", "/readyz"];

pub async fn middleware(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let start = Instant::now();
    let method = request.method().as_str().to_owned();
    let path = request.uri().path().to_owned();
    let headers = request.headers();
    let request_id = header_string(headers, "x-request-id");
    let user_agent = header_string(headers, "user-agent");
    let trace = header_string(headers, "traceparent").and_then(|value| parse_traceparent(&value));
    let client = ClientMetadata::from_headers(headers);

    let response = next.run(request).await;

    let duration = start.elapsed();
    let status = response.status().as_u16();
    let graphql = response.extensions().get::<GraphqlOperationInfo>().cloned();
    let group = path_group(&path);
    let method_label = method_label(&method);
    // A `/graphql` response without a route came from the timeout layer, so from this server.
    let route = response
        .extensions()
        .get::<Route>()
        .copied()
        .or((group == "/graphql").then_some(Route::Local));
    let upstream = response.extensions().get::<Upstream>().copied();

    state
        .metrics
        .http_request_duration
        .with_label_values(&[method_label, group, &status_class(status)])
        .observe(duration.as_secs_f64());
    if status >= 500 {
        state
            .metrics
            .http_errors
            .with_label_values(&[method_label, group])
            .inc();
    }
    if let Some(route) = route {
        let labels = [route.as_str(), &status_class(status)];
        state
            .metrics
            .gateway_requests
            .with_label_values(&labels)
            .inc();
        state
            .metrics
            .gateway_request_duration
            .with_label_values(&labels)
            .observe(duration.as_secs_f64());
    }
    if group == "/graphql" {
        let (name, kind) = graphql.as_ref().map_or(("anonymous", "unknown"), |info| {
            (info.metric_operation_name, info.operation_type.as_str())
        });
        if reports_server_error(status, route) {
            crate::reporting::report_server_error(status, name, request_id.as_deref());
        }
        // Every `/graphql` response has a route (see above).
        let labels = [name, kind, route.unwrap_or(Route::Local).as_str()];
        state
            .metrics
            .graphql_requests
            .with_label_values(&labels)
            .inc();
        state
            .metrics
            .graphql_request_duration
            .with_label_values(&labels)
            .observe(duration.as_secs_f64());
    }

    let mut line = Map::new();
    insert_some(&mut line, "requestId", request_id);
    insert_some(&mut line, "userAgent", user_agent);
    line.insert("method".into(), Value::from(method.as_str()));
    line.insert("path".into(), Value::from(path.as_str()));
    line.insert("status".into(), Value::from(status));
    line.insert("time".into(), Value::from(duration.as_secs_f64() * 1000.0));
    line.insert("client".into(), json!(client));
    insert_graphql_fields(&mut line, graphql);
    insert_route_fields(&mut line, route, upstream);
    if let Some((trace_id, span_id)) = trace {
        line.insert("traceId".into(), Value::from(trace_id));
        line.insert("spanId".into(), Value::from(span_id));
    }

    let passing_probe =
        method == "GET" && HEALTH_PROBE_PATHS.contains(&path.as_str()) && status < 400;
    crate::logging::emit(
        if passing_probe {
            Level::DEBUG
        } else {
            Level::INFO
        },
        line,
    );

    response
}

/// `operationName`, `operationType` and `fields` for the request log line.
fn insert_graphql_fields(line: &mut Map<String, Value>, graphql: Option<GraphqlOperationInfo>) {
    match graphql {
        Some(info) => {
            line.insert("operationName".into(), Value::from(info.operation_name));
            line.insert("operationType".into(), Value::from(info.operation_type));
            line.insert("fields".into(), json!(info.fields));
        }
        None => {
            line.insert("operationName".into(), Value::from("anonymous"));
        }
    }
}

/// `route`, and for forwarded requests `upstreamStatus` (`null` when TS never answered) and
/// `upstreamTime` (milliseconds, like `time`).
fn insert_route_fields(
    line: &mut Map<String, Value>,
    route: Option<Route>,
    upstream: Option<Upstream>,
) {
    if let Some(route) = route {
        line.insert("route".into(), Value::from(route.as_str()));
    }
    if let Some(upstream) = upstream {
        line.insert("upstreamStatus".into(), json!(upstream.status));
        line.insert(
            "upstreamTime".into(),
            Value::from(upstream.duration.as_secs_f64() * 1000.0),
        );
    }
}

/// Whether a `/graphql` response is a 5xx this server produced: TS reports its own, and the
/// forwarder has already reported the ones it made for an unanswered forward.
fn reports_server_error(status: u16, route: Option<Route>) -> bool {
    status >= 500 && route != Some(Route::Forward)
}

/// The route that answered, or `unmatched`. Every route is a fixed path, so this equals the
/// route pattern the TS server reports.
pub fn path_group(path: &str) -> &'static str {
    match path {
        "/" => "/",
        "/healthz" => "/healthz",
        "/readyz" => "/readyz",
        "/graphql" => "/graphql",
        _ => "unmatched",
    }
}

pub fn method_label(method: &str) -> &'static str {
    match method.to_ascii_uppercase().as_str() {
        "GET" => "GET",
        "HEAD" => "HEAD",
        "POST" => "POST",
        "PUT" => "PUT",
        "PATCH" => "PATCH",
        "DELETE" => "DELETE",
        "OPTIONS" => "OPTIONS",
        _ => "OTHER",
    }
}

pub fn status_class(status: u16) -> String {
    format!("{}xx", status / 100)
}

/// `traceparent` is `version-traceId-spanId-flags`.
fn parse_traceparent(value: &str) -> Option<(String, String)> {
    let mut parts = value.split('-');
    let _version = parts.next()?;
    let trace_id = parts.next().filter(|s| !s.is_empty())?;
    let span_id = parts.next().filter(|s| !s.is_empty())?;
    Some((trace_id.to_owned(), span_id.to_owned()))
}

fn header_string(headers: &http::HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
}

fn insert_some(map: &mut Map<String, Value>, key: &str, value: Option<String>) {
    if let Some(value) = value {
        map.insert(key.to_owned(), Value::from(value));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn groups_paths_like_the_ts_router() {
        assert_eq!(path_group("/graphql"), "/graphql");
        assert_eq!(path_group("/readyz"), "/readyz");
        assert_eq!(path_group("/graphql/extra"), "unmatched");
        assert_eq!(path_group("/wp-admin"), "unmatched");
    }

    #[test]
    fn labels_methods_and_status_classes() {
        assert_eq!(method_label("post"), "POST");
        assert_eq!(method_label("PROPFIND"), "OTHER");
        assert_eq!(status_class(204), "2xx");
        assert_eq!(status_class(503), "5xx");
    }

    #[test]
    fn logs_the_ts_formatted_operation_name() {
        let mut line = Map::new();
        insert_graphql_fields(
            &mut line,
            Some(GraphqlOperationInfo {
                operation_name: "Bench-untagged".to_owned(),
                metric_operation_name: "untagged",
                operation_type: "query".to_owned(),
                fields: vec!["core".to_owned()],
            }),
        );
        assert_eq!(
            Value::Object(line),
            json!({ "operationName": "Bench-untagged", "operationType": "query", "fields": ["core"] })
        );
    }

    #[test]
    fn logs_the_route_and_the_upstream_outcome() {
        let fields = |route, upstream| {
            let mut line = Map::new();
            insert_route_fields(&mut line, route, upstream);
            Value::Object(line)
        };
        assert_eq!(fields(None, None), json!({}));
        assert_eq!(
            fields(Some(Route::Local), None),
            json!({ "route": "local" })
        );
        let answered = Upstream {
            status: Some(502),
            duration: std::time::Duration::from_millis(1500),
        };
        assert_eq!(
            fields(Some(Route::Forward), Some(answered)),
            json!({ "route": "forward", "upstreamStatus": 502, "upstreamTime": 1500.0 })
        );
        let unanswered = Upstream {
            status: None,
            ..answered
        };
        assert_eq!(
            fields(Some(Route::Forward), Some(unanswered)),
            json!({ "route": "forward", "upstreamStatus": null, "upstreamTime": 1500.0 })
        );
    }

    #[test]
    fn reports_only_server_errors_this_server_produced() {
        assert!(reports_server_error(503, Some(Route::Local)));
        // The timeout layer's 504 carries no route.
        assert!(reports_server_error(504, None));
        assert!(!reports_server_error(500, Some(Route::Forward)));
        assert!(!reports_server_error(502, Some(Route::Forward)));
        assert!(!reports_server_error(429, Some(Route::Local)));
    }

    #[tokio::test]
    async fn counts_graphql_requests_by_route_and_status_class() {
        use crate::test_support::{MockOrigin, TestApp, origin_reply, post_graphql};

        let origin =
            MockOrigin::start(|| origin_reply(http::StatusCode::OK, r#"{"data":{}}"#, &[])).await;
        let app = TestApp::with_env(&[("TS_ORIGIN_URL", origin.url.as_str())]);
        app.send(post_graphql(json!({ "query": "query Q { __typename }" })))
            .await;
        app.send(post_graphql(
            json!({ "query": "query P { profile { id } }" }),
        ))
        .await;
        app.send(
            axum::http::Request::get("/healthz")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await;

        let metrics = app.state.metrics.render();
        assert!(metrics.contains(r#"gateway_requests_total{route="local",status_class="2xx"} 1"#));
        assert!(
            metrics.contains(r#"gateway_requests_total{route="forward",status_class="2xx"} 1"#)
        );
        assert!(metrics.contains(
            r#"gateway_request_duration_seconds_count{route="forward",status_class="2xx"} 1"#
        ));
        // Only `/graphql` has a route.
        assert_eq!(metrics.matches("gateway_requests_total{").count(), 2);
        // The operation metrics carry it too, so a forwarded request's time (TS's plus the hop)
        // is not read as Rust's.
        assert!(metrics.contains(
            r#"graphql_envelop_request_total{operationName="untagged",operationType="query",route="local"} 1"#
        ));
        assert!(metrics.contains(
            r#"graphql_envelop_request_total{operationName="untagged",operationType="query",route="forward"} 1"#
        ));
        assert!(metrics.contains(
            r#"graphql_envelop_request_duration_count{operationName="untagged",operationType="query",route="forward"} 1"#
        ));
    }

    #[test]
    fn reports_rust_server_errors_once_and_leaves_ts_errors_to_ts() {
        use crate::google::GoogleAuth;
        use crate::graphql::auth::testing::{ACCESS_TOKEN, GoogleMock, anonymous_claims, sign};
        use crate::reporting::{SERVER_ERROR_MESSAGE, UPSTREAM_FAILURE_MESSAGE};
        use crate::test_support::{
            MockOrigin, TestApp, origin_reply, post_graphql, post_graphql_as,
        };
        use wiremock::ResponseTemplate;

        let events = sentry::test::with_captured_events(|| {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            runtime.block_on(async {
                // Rust's own 503: the account lookup fails.
                let mock = GoogleMock::start().await;
                mock.mount_jwks(1).await;
                mock.mount_lookup(ResponseTemplate::new(500), 1).await;
                let app = TestApp::with_google(&mock, Some(GoogleAuth::fixed(ACCESS_TOKEN)));
                let response = app
                    .send(post_graphql_as(
                        json!({ "query": "query CCBFormsV2Query { ccbFormsV2 { __typename } }" }),
                        &sign(&anonymous_claims()),
                    ))
                    .await;
                assert_eq!(response.status, http::StatusCode::SERVICE_UNAVAILABLE);

                // TS's own 500, passed through: TS reports it.
                let origin = MockOrigin::start(|| {
                    origin_reply(http::StatusCode::INTERNAL_SERVER_ERROR, "{}", &[])
                })
                .await;
                let forwarding = TestApp::with_env(&[("TS_ORIGIN_URL", origin.url.as_str())]);
                let profile = json!({ "query": "query ProfileQuery { profile { id } }" });
                let response = forwarding.send(post_graphql(profile.clone())).await;
                assert_eq!(response.status, http::StatusCode::INTERNAL_SERVER_ERROR);

                // TS unreachable: one upstream-failure event, not a second server-error one.
                let response = TestApp::new().send(post_graphql(profile)).await;
                assert_eq!(response.status, http::StatusCode::BAD_GATEWAY);
            });
        });
        let messages: Vec<_> = events
            .iter()
            .map(|event| event.message.as_deref().unwrap_or_default())
            .collect();
        assert_eq!(messages, [SERVER_ERROR_MESSAGE, UPSTREAM_FAILURE_MESSAGE]);
        assert_eq!(events[0].tags["status"], "503");
        assert_eq!(events[0].tags["operation_name"], "CCBFormsV2Query");
        assert!(events.iter().all(|event| event.request.is_none()));
    }

    #[test]
    fn parses_traceparent() {
        assert_eq!(
            parse_traceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"),
            Some((
                "4bf92f3577b34da6a3ce929d0e0e4736".to_owned(),
                "00f067aa0ba902b7".to_owned()
            ))
        );
        assert_eq!(parse_traceparent("garbage"), None);
    }
}
