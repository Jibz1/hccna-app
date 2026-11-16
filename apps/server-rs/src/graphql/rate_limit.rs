//! Per-client rate limit on `/graphql`: `hono-rate-limiter` with draft-7 headers, as configured
//! in `apps/server/src/routes/graphql.ts`, over the Redis store of
//! `apps/server/src/effect/services/GraphQLRateLimitStoreService.ts` (fixed one-second window,
//! in-memory fallback when Redis fails).

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::Response;
use serde_json::json;
use tokio::time::Instant;

use crate::graphql::errors::error_body;
use crate::store::kv::{KeyValueStore, StoreError};

/// `GRAPHQL_RATE_LIMIT_WINDOW_MS`.
pub const WINDOW: Duration = Duration::from_secs(1);

pub const TOO_MANY_REQUESTS_MESSAGE: &str = "Too many requests, please try again later.";

/// One client's count in the current window.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RateLimitInfo {
    pub limit: u32,
    pub total_hits: i64,
    pub reset_at: Instant,
}

impl RateLimitInfo {
    pub fn remaining(&self) -> i64 {
        (i64::from(self.limit) - self.total_hits).max(0)
    }

    pub fn limited(&self) -> bool {
        self.total_hits > i64::from(self.limit)
    }

    /// Whole seconds until the window resets, rounded up.
    pub fn reset_seconds(&self) -> u64 {
        let left = self.reset_at.saturating_duration_since(Instant::now());
        u64::try_from(left.as_millis().div_ceil(1000)).unwrap_or(u64::MAX)
    }
}

pub struct RateLimiter {
    store: Arc<dyn KeyValueStore>,
    limit: u32,
    fallback: Mutex<HashMap<String, LocalEntry>>,
}

#[derive(Clone, Copy, Debug)]
struct LocalEntry {
    total_hits: i64,
    expires_at: Instant,
}

impl RateLimiter {
    pub fn new(store: Arc<dyn KeyValueStore>, limit: u32) -> Self {
        Self {
            store,
            limit,
            fallback: Mutex::new(HashMap::new()),
        }
    }

    /// Counts one request from `client` in Redis, or in process memory when Redis fails.
    pub async fn hit(&self, client: &str) -> RateLimitInfo {
        match self.hit_redis(client).await {
            Ok(total_hits) => RateLimitInfo {
                limit: self.limit,
                total_hits,
                // Exact on a window's first hit and an upper bound after it, as in TS.
                reset_at: Instant::now() + WINDOW,
            },
            Err(error) => {
                tracing::warn!(
                    key = client,
                    window_ms = 1000_u64,
                    error = %error,
                    "GraphQL rate limit store fell back to local memory"
                );
                self.hit_local(client)
            }
        }
    }

    /// `INCR`, then `EXPIRE` on a window's first hit. Later hits check the TTL in a detached
    /// task, healing keys that lost their expiry without delaying the request.
    async fn hit_redis(&self, client: &str) -> Result<i64, StoreError> {
        let key = self.store.key(&format!("graphql:rate-limit:{client}"));
        let window_seconds = window_seconds();
        let total_hits = self.store.incr(&key).await?;
        if total_hits == 1 {
            self.store.expire(&key, window_seconds).await?;
        } else {
            let store = self.store.clone();
            tokio::spawn(async move {
                if let Ok(ttl) = store.ttl(&key).await
                    && ttl <= 0
                {
                    let _ = store.expire(&key, window_seconds).await;
                }
            });
        }
        Ok(total_hits)
    }

    /// The fixed-window fallback; expired entries are pruned on every call, as in TS.
    fn hit_local(&self, client: &str) -> RateLimitInfo {
        let now = Instant::now();
        let mut entries = self.fallback.lock().unwrap_or_else(PoisonError::into_inner);
        entries.retain(|_, entry| entry.expires_at > now);
        let entry = entries.entry(client.to_owned()).or_insert(LocalEntry {
            total_hits: 0,
            expires_at: now + WINDOW,
        });
        entry.total_hits += 1;
        RateLimitInfo {
            limit: self.limit,
            total_hits: entry.total_hits,
            reset_at: entry.expires_at,
        }
    }
}

fn window_seconds() -> i64 {
    i64::try_from(WINDOW.as_millis().div_ceil(1000)).unwrap_or(1)
}

/// The client key: the trimmed `X-Real-IP` value, else the peer address (`unknown` only when
/// there is no peer, as in in-process tests).
///
/// Deliberate difference from TS, which keys on the raw `X-Forwarded-For` value. Clients control
/// that header, so it would give them a fresh bucket per request, and Railway does not document
/// rewriting it. Railway's edge sets `X-Real-IP` to the client's remote IP
/// (docs.railway.com/networking/public-networking/specs-and-limits, "Request Headers"), and
/// nothing sits in front of Railway for this service.
pub fn client_key(headers: &HeaderMap, peer: Option<SocketAddr>) -> String {
    client_address(headers, peer).unwrap_or_else(|| "unknown".to_owned())
}

/// The client's address as the limiter derives it: the trimmed `X-Real-IP` value, else the peer's
/// IP. The gateway sends it to TS as `X-Forwarded-For`.
pub fn client_address(headers: &HeaderMap, peer: Option<SocketAddr>) -> Option<String> {
    headers
        .get("x-real-ip")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .or_else(|| peer.map(|peer| peer.ip().to_string()))
}

/// Draft-7 `RateLimit-Policy` and `RateLimit` headers, plus `Retry-After` when limited.
pub fn headers(info: &RateLimitInfo) -> Vec<(&'static str, HeaderValue)> {
    let reset = info.reset_seconds();
    let mut headers = vec![
        (
            "ratelimit-policy",
            ascii(format!("{};w={}", info.limit, window_seconds())),
        ),
        (
            "ratelimit",
            ascii(format!(
                "limit={}, remaining={}, reset={reset}",
                info.limit,
                info.remaining()
            )),
        ),
    ];
    if info.limited() {
        headers.push(("retry-after", ascii(reset.to_string())));
    }
    headers
}

fn ascii(value: String) -> HeaderValue {
    HeaderValue::try_from(value).expect("rate limit headers are ASCII digits and punctuation")
}

/// hono-rate-limiter's 429 with the message configured in `routes/graphql.ts`.
pub fn too_many_requests() -> Response {
    let body = error_body(
        TOO_MANY_REQUESTS_MESSAGE,
        Some(json!({ "code": "TOO_MANY_REQUESTS" })),
    );
    let mut response = Response::new(body.to_string().into());
    *response.status_mut() = StatusCode::TOO_MANY_REQUESTS;
    // Hono's `c.json` content type.
    response.headers_mut().insert(
        axum::http::header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    response
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use axum::extract::ConnectInfo;
    use axum::http::{HeaderMap, HeaderValue, StatusCode};
    use serde_json::json;

    use super::*;
    use crate::store::kv::MemoryStore;
    use crate::test_support::{TestApp, post_graphql};

    fn header(name: &'static str, value: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(name, HeaderValue::from_str(value).unwrap());
        headers
    }

    #[test]
    fn keys_clients_by_real_ip_then_peer() {
        let peer: SocketAddr = "192.0.2.10:5000".parse().unwrap();
        assert_eq!(
            client_key(&header("x-real-ip", "203.0.113.9"), Some(peer)),
            "203.0.113.9"
        );
        assert_eq!(
            client_key(&header("x-real-ip", " 203.0.113.9 "), Some(peer)),
            "203.0.113.9"
        );
        assert_eq!(
            client_key(&header("x-real-ip", " "), Some(peer)),
            "192.0.2.10"
        );
        assert_eq!(client_key(&HeaderMap::new(), Some(peer)), "192.0.2.10");
        let v6: SocketAddr = "[::ffff:192.0.2.11]:5000".parse().unwrap();
        assert_eq!(client_key(&HeaderMap::new(), Some(v6)), "::ffff:192.0.2.11");
        assert_eq!(client_key(&HeaderMap::new(), None), "unknown");
    }

    #[test]
    fn derives_the_client_address_for_forwarding() {
        let peer: SocketAddr = "192.0.2.10:5000".parse().unwrap();
        assert_eq!(
            client_address(&header("x-real-ip", " 203.0.113.9 "), Some(peer)).as_deref(),
            Some("203.0.113.9")
        );
        assert_eq!(
            client_address(&HeaderMap::new(), Some(peer)).as_deref(),
            Some("192.0.2.10")
        );
        // No address at all: nothing to forward, while the limiter still keys on `unknown`.
        assert_eq!(client_address(&HeaderMap::new(), None), None);
        assert_eq!(client_key(&HeaderMap::new(), None), "unknown");
    }

    #[test]
    fn ignores_forwarded_for() {
        let peer: SocketAddr = "192.0.2.10:5000".parse().unwrap();
        assert_eq!(
            client_key(
                &header("x-forwarded-for", "198.51.100.1, 203.0.113.9"),
                Some(peer)
            ),
            "192.0.2.10"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn forged_forwarded_for_shares_the_peer_bucket() {
        let app = TestApp::new();
        let peer: SocketAddr = "192.0.2.10:5000".parse().unwrap();
        let request = |forged: Option<&str>| {
            let mut request = post_graphql(json!({ "query": "query X { __typename }" }));
            if let Some(forged) = forged {
                request
                    .headers_mut()
                    .insert("x-forwarded-for", HeaderValue::from_str(forged).unwrap());
            }
            request.extensions_mut().insert(ConnectInfo(peer));
            request
        };
        app.send(request(Some("198.51.100.1"))).await;
        app.send(request(Some("198.51.100.2, 203.0.113.9"))).await;
        app.send(request(None)).await;
        assert_eq!(
            app.store.raw("rs:graphql:rate-limit:192.0.2.10").as_deref(),
            Some("3")
        );
    }

    #[tokio::test(start_paused = true)]
    async fn counts_in_redis_with_a_one_second_window() {
        let store = Arc::new(MemoryStore::new("rs:"));
        let limiter = RateLimiter::new(store.clone(), 20);
        let first = limiter.hit("203.0.113.7").await;
        assert_eq!((first.total_hits, first.remaining()), (1, 19));
        assert_eq!(first.reset_seconds(), 1);
        assert_eq!(
            store.raw("rs:graphql:rate-limit:203.0.113.7").as_deref(),
            Some("1")
        );
        assert_eq!(
            store
                .ttl("rs:graphql:rate-limit:203.0.113.7")
                .await
                .unwrap(),
            1
        );

        for _ in 0..19 {
            assert!(!limiter.hit("203.0.113.7").await.limited());
        }
        let over = limiter.hit("203.0.113.7").await;
        assert!(over.limited());
        assert_eq!(over.remaining(), 0);
        // Another client has its own window.
        assert_eq!(limiter.hit("203.0.113.8").await.total_hits, 1);

        tokio::time::advance(WINDOW).await;
        assert_eq!(limiter.hit("203.0.113.7").await.total_hits, 1);
    }

    #[tokio::test(start_paused = true)]
    async fn heals_keys_that_lost_their_expiry() {
        let store = Arc::new(MemoryStore::new("rs:"));
        store.insert_raw("rs:graphql:rate-limit:203.0.113.7", "5");
        let limiter = RateLimiter::new(store.clone(), 20);
        assert_eq!(limiter.hit("203.0.113.7").await.total_hits, 6);
        // The TTL check runs detached; let it finish.
        tokio::task::yield_now().await;
        tokio::task::yield_now().await;
        assert_eq!(
            store
                .ttl("rs:graphql:rate-limit:203.0.113.7")
                .await
                .unwrap(),
            1
        );
    }

    #[tokio::test(start_paused = true)]
    async fn falls_back_to_memory_when_redis_fails() {
        let store = Arc::new(MemoryStore::new("rs:"));
        store.set_failing(true);
        let limiter = RateLimiter::new(store, 20);
        for expected in 1..=20 {
            let info = limiter.hit("203.0.113.7").await;
            assert_eq!(info.total_hits, expected);
            assert!(!info.limited());
        }
        assert!(limiter.hit("203.0.113.7").await.limited());
        tokio::time::advance(WINDOW).await;
        assert_eq!(limiter.hit("203.0.113.7").await.total_hits, 1);
    }

    #[test]
    fn renders_draft_7_headers() {
        let reset_at = Instant::now() + Duration::from_millis(1000);
        let info = RateLimitInfo {
            limit: 20,
            total_hits: 3,
            reset_at,
        };
        let headers = headers(&info);
        assert_eq!(
            headers,
            vec![
                ("ratelimit-policy", HeaderValue::from_static("20;w=1")),
                (
                    "ratelimit",
                    HeaderValue::from_static("limit=20, remaining=17, reset=1")
                ),
            ]
        );
        let limited = RateLimitInfo {
            total_hits: 21,
            ..info
        };
        assert_eq!(
            super::headers(&limited).last(),
            Some(&("retry-after", HeaderValue::from_static("1")))
        );
    }

    #[tokio::test(start_paused = true)]
    async fn rejects_the_21st_request_in_a_second() {
        let app = TestApp::new();
        let request = || {
            let mut request = post_graphql(json!({ "query": "query X { __typename }" }));
            request
                .headers_mut()
                .insert("x-real-ip", HeaderValue::from_static("203.0.113.7"));
            request
        };
        for n in 1..=20 {
            let response = app.send(request()).await;
            assert_eq!(response.status, StatusCode::OK);
            assert_eq!(response.headers["ratelimit-policy"], "20;w=1");
            assert_eq!(
                response.headers["ratelimit"],
                format!("limit=20, remaining={}, reset=1", 20 - n).as_str()
            );
        }
        let response = app.send(request()).await;
        assert_eq!(response.status, StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(response.headers["content-type"], "application/json");
        assert_eq!(response.headers["retry-after"], "1");
        assert_eq!(
            response.headers["ratelimit"],
            "limit=20, remaining=0, reset=1"
        );
        assert_eq!(
            response.json(),
            json!({ "errors": [{ "message": "Too many requests, please try again later.", "extensions": { "code": "TOO_MANY_REQUESTS" } }] })
        );
        assert_eq!(
            app.store
                .raw("rs:graphql:rate-limit:203.0.113.7")
                .as_deref(),
            Some("21")
        );
    }

    #[tokio::test(start_paused = true)]
    async fn limits_from_memory_when_redis_is_down() {
        let app = TestApp::with_env(&[("GRAPHQL_RATE_LIMIT_RPS", "2")]);
        app.store.set_failing(true);
        let statuses = [
            app.send(post_graphql(json!({ "query": "query X { __typename }" })))
                .await
                .status,
            app.send(post_graphql(json!({ "query": "query X { __typename }" })))
                .await
                .status,
            app.send(post_graphql(json!({ "query": "query X { __typename }" })))
                .await
                .status,
        ];
        assert_eq!(
            statuses,
            [
                StatusCode::OK,
                StatusCode::OK,
                StatusCode::TOO_MANY_REQUESTS
            ]
        );
    }
}
