//! `/`, `/healthz` and `/readyz`, with the TS server's responses
//! (`apps/server/src/app.ts`, `OperationalReadinessService.ts`).

use std::fmt::Display;
use std::future::Future;
use std::time::Duration;

use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

use crate::state::AppState;
use crate::store::postgres;

const READINESS_TIMEOUT: Duration = Duration::from_secs(2);

pub async fn root() -> Json<serde_json::Value> {
    Json(json!({ "ok": true }))
}

pub async fn healthz() -> &'static str {
    "OK"
}

/// `OK` when Redis and Postgres both answer within 2 s; otherwise 503 with the failed
/// dependencies (and no error details, which go to the log).
pub async fn readyz(State(state): State<AppState>) -> Response {
    let failures = check_dependencies(
        state.redis.ping(),
        postgres::ping(&state.db),
        READINESS_TIMEOUT,
    )
    .await;

    if failures.is_empty() {
        return "OK".into_response();
    }

    for failure in &failures {
        state
            .metrics
            .readiness_failures
            .with_label_values(&[failure.dependency, failure.reason])
            .inc();
    }
    let details = failures
        .iter()
        .map(|f| json!({ "dependency": f.dependency, "reason": f.reason, "message": f.message }))
        .collect::<Vec<_>>();
    let mut line = serde_json::Map::new();
    line.insert("failures".into(), details.into());
    line.insert("msg".into(), "Readiness check failed".into());
    crate::logging::emit(tracing::Level::WARN, line);

    let body = failures
        .iter()
        .map(|f| json!({ "dependency": f.dependency, "status": "unavailable" }))
        .collect::<Vec<_>>();
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({ "ok": false, "failures": body })),
    )
        .into_response()
}

#[derive(Debug, PartialEq, Eq)]
pub struct ReadinessFailure {
    pub dependency: &'static str,
    /// `timeout` or `unavailable`.
    pub reason: &'static str,
    pub message: String,
}

/// Probes Redis and Postgres concurrently, each under `timeout`, and returns the failures in
/// that order.
pub async fn check_dependencies<R, P, RE, PE>(
    redis: R,
    postgres: P,
    timeout: Duration,
) -> Vec<ReadinessFailure>
where
    R: Future<Output = Result<(), RE>>,
    P: Future<Output = Result<(), PE>>,
    RE: Display,
    PE: Display,
{
    let (redis, postgres) = tokio::join!(
        probe("redis", redis, timeout),
        probe("postgres", postgres, timeout)
    );
    [redis, postgres].into_iter().flatten().collect()
}

async fn probe<F, E>(
    dependency: &'static str,
    check: F,
    timeout: Duration,
) -> Option<ReadinessFailure>
where
    F: Future<Output = Result<(), E>>,
    E: Display,
{
    match tokio::time::timeout(timeout, check).await {
        Ok(Ok(())) => None,
        Ok(Err(error)) => Some(ReadinessFailure {
            dependency,
            reason: "unavailable",
            message: error.to_string(),
        }),
        Err(_) => Some(ReadinessFailure {
            dependency,
            reason: "timeout",
            message: format!(
                "readiness probe timed out after {} seconds",
                timeout.as_secs()
            ),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::future::{pending, ready};

    #[tokio::test]
    async fn passes_when_both_dependencies_answer() {
        let failures = check_dependencies(
            ready(Ok::<(), String>(())),
            ready(Ok::<(), String>(())),
            READINESS_TIMEOUT,
        )
        .await;
        assert!(failures.is_empty());
    }

    #[tokio::test]
    async fn reports_errors_as_unavailable() {
        let failures = check_dependencies(
            ready(Err::<(), _>("connection refused")),
            ready(Ok::<(), String>(())),
            READINESS_TIMEOUT,
        )
        .await;
        assert_eq!(
            failures,
            vec![ReadinessFailure {
                dependency: "redis",
                reason: "unavailable",
                message: "connection refused".to_owned(),
            }]
        );
    }

    #[tokio::test(start_paused = true)]
    async fn reports_slow_dependencies_as_timeouts() {
        let failures = check_dependencies(
            ready(Ok::<(), String>(())),
            pending::<Result<(), String>>(),
            READINESS_TIMEOUT,
        )
        .await;
        assert_eq!(failures.len(), 1);
        assert_eq!(failures[0].dependency, "postgres");
        assert_eq!(failures[0].reason, "timeout");
    }
}
