pub mod client_meta;
pub mod health;
pub mod request_log;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::http::StatusCode;
use axum::middleware;
use axum::routing::{get, post};
use tower::ServiceBuilder;
use tower_http::compression::CompressionLayer;
use tower_http::cors::{Any, CorsLayer};
use tower_http::request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer};
use tower_http::timeout::TimeoutLayer;

use crate::gateway;
use crate::graphql::handler;
use crate::metrics::Metrics;
use crate::state::AppState;

/// Largest `/graphql` request body: 2 MiB, far above any mobile operation. Larger bodies get 413.
pub const GRAPHQL_BODY_LIMIT: usize = 2 * 1024 * 1024;

/// The app on `PORT`. Middleware runs in the TS server's order: request id, request log and
/// metrics, compression, timeout, CORS; the gateway's deadline is stamped before the timeout.
pub fn router(state: AppState) -> Router {
    let timeout = state.config.request_timeout;
    Router::new()
        .route("/", get(health::root))
        .route("/healthz", get(health::healthz))
        .route("/readyz", get(health::readyz))
        .route(
            "/graphql",
            post(handler::graphql).layer(DefaultBodyLimit::max(GRAPHQL_BODY_LIMIT)),
        )
        .fallback(not_found)
        .layer(
            ServiceBuilder::new()
                .layer(SetRequestIdLayer::x_request_id(MakeRequestUuid))
                .layer(PropagateRequestIdLayer::x_request_id())
                .layer(middleware::from_fn_with_state(
                    state.clone(),
                    request_log::middleware,
                ))
                // Before the timeout layer starts its clock (see `RequestDeadline`).
                .layer(middleware::from_fn_with_state(
                    timeout,
                    gateway::stamp_deadline,
                ))
                .layer(CompressionLayer::new())
                // Hono's `timeout()` answers 504 Gateway Timeout.
                .layer(TimeoutLayer::with_status_code(
                    StatusCode::GATEWAY_TIMEOUT,
                    timeout,
                ))
                .layer(
                    CorsLayer::new()
                        .allow_origin(Any)
                        .allow_methods(Any)
                        .allow_headers(Any),
                ),
        )
        .with_state(state)
}

/// The Prometheus endpoint on `METRICS_SERVER_PORT`, kept off the public port.
pub fn metrics_router(metrics: Metrics) -> Router {
    Router::new().route(
        "/metrics",
        get(move || {
            let metrics = metrics.clone();
            async move {
                (
                    [(
                        http::header::CONTENT_TYPE,
                        "text/plain; version=0.0.4; charset=utf-8",
                    )],
                    metrics.render(),
                )
            }
        }),
    )
}

async fn not_found() -> (StatusCode, &'static str) {
    (StatusCode::NOT_FOUND, "404 Not Found")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;
    use axum::body::Body;
    use http::Request;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    /// State whose Redis and Postgres point at a closed port, so they fail fast.
    fn unreachable_state() -> AppState {
        let config = Config::from_lookup(|name| match name {
            "DATABASE_URL" => Some("postgres://ada:pw@127.0.0.1:1/example".to_owned()),
            "REDIS_HOST" => Some("127.0.0.1".to_owned()),
            "REDIS_PORT" => Some("1".to_owned()),
            "DB_CONNECTION_TIMEOUT_MS" => Some("500".to_owned()),
            "CMS_V5_ENDPOINT" => Some("http://127.0.0.1:1/graphql".to_owned()),
            "CMS_V5_TOKEN" => Some("example-cms-token".to_owned()),
            "TS_ORIGIN_URL" => Some("http://127.0.0.1:1".to_owned()),
            _ => None,
        })
        .unwrap();
        AppState::new(config).unwrap()
    }

    async fn send(app: Router, request: Request<Body>) -> (StatusCode, http::HeaderMap, String) {
        let response = app.oneshot(request).await.unwrap();
        let status = response.status();
        let headers = response.headers().clone();
        let body = response.into_body().collect().await.unwrap().to_bytes();
        (status, headers, String::from_utf8(body.to_vec()).unwrap())
    }

    fn get(path: &str) -> Request<Body> {
        Request::get(path).body(Body::empty()).unwrap()
    }

    #[tokio::test]
    async fn serves_root_and_liveness() {
        let state = unreachable_state();
        let (status, _, body) = send(router(state.clone()), get("/")).await;
        assert_eq!((status, body.as_str()), (StatusCode::OK, r#"{"ok":true}"#));
        let (status, _, body) = send(router(state), get("/healthz")).await;
        assert_eq!((status, body.as_str()), (StatusCode::OK, "OK"));
    }

    #[tokio::test]
    async fn answers_unknown_paths_with_404() {
        let (status, _, body) = send(router(unreachable_state()), get("/nope")).await;
        assert_eq!(
            (status, body.as_str()),
            (StatusCode::NOT_FOUND, "404 Not Found")
        );
    }

    #[tokio::test]
    async fn generates_or_propagates_request_ids() {
        let state = unreachable_state();
        let (_, headers, _) = send(router(state.clone()), get("/healthz")).await;
        assert!(headers.contains_key("x-request-id"));

        let request = Request::get("/healthz")
            .header("x-request-id", "example-request")
            .body(Body::empty())
            .unwrap();
        let (_, headers, _) = send(router(state), request).await;
        assert_eq!(headers["x-request-id"], "example-request");
    }

    #[tokio::test]
    async fn readiness_fails_without_dependencies() {
        let (status, _, body) = send(router(unreachable_state()), get("/readyz")).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        let body: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(
            body,
            serde_json::json!({
                "ok": false,
                "failures": [
                    { "dependency": "redis", "status": "unavailable" },
                    { "dependency": "postgres", "status": "unavailable" },
                ],
            })
        );
    }

    #[tokio::test]
    async fn records_request_metrics() {
        let state = unreachable_state();
        send(router(state.clone()), get("/healthz")).await;
        send(router(state.clone()), get("/nope")).await;

        let (status, _, text) = send(metrics_router(state.metrics.clone()), get("/metrics")).await;
        assert_eq!(status, StatusCode::OK);
        assert!(text.contains(
            r#"http_server_request_duration_seconds_count{method="GET",path_group="/healthz",status_class="2xx"} 1"#
        ));
        assert!(text.contains(
            r#"http_server_request_duration_seconds_count{method="GET",path_group="unmatched",status_class="4xx"} 1"#
        ));
    }
}
