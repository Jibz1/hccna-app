//! The shared outbound HTTP client and upstream-call metrics, mirroring `withServiceMetrics` in
//! `apps/server/src/utils/serviceRequest.ts`.

use std::future::Future;
use std::time::{Duration, Instant};

use crate::metrics::Metrics;

/// How long an idle upstream connection stays pooled. Requests arrive in bursts minutes to an hour
/// apart, and a burst that finds no pooled connection pays DNS, TCP and TLS before its first Strapi
/// or Google call.
pub const POOL_IDLE_TIMEOUT: Duration = Duration::from_secs(60 * 60);

/// HTTP/2 pings on pooled connections, idle ones included. A connection whose ping goes
/// unanswered for [`HTTP2_KEEP_ALIVE_TIMEOUT`] is closed rather than handed to a request. Strapi
/// (through Railway's edge) and Google both speak HTTP/2.
pub const HTTP2_KEEP_ALIVE_INTERVAL: Duration = Duration::from_secs(60);
pub const HTTP2_KEEP_ALIVE_TIMEOUT: Duration = Duration::from_secs(20);

/// TCP keep-alive for every connection, HTTP/1.1 ones included, so network state along the path
/// does not expire while a connection waits in the pool.
pub const TCP_KEEPALIVE: Duration = Duration::from_secs(60);

/// One pooled client for every upstream. Per-call timeouts are set on each request, as the TS
/// server does, because they differ by upstream.
///
/// `statsig-rust` enables reqwest's `brotli` and `rustls-tls-native-roots` features for its own
/// client; this one opts out of both, so upstream requests keep `Accept-Encoding: gzip` and the
/// bundled web PKI roots.
pub fn http_client() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .no_brotli()
        .tls_built_in_native_certs(false)
        .user_agent(concat!("hccna-server-rs/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(5))
        .pool_idle_timeout(POOL_IDLE_TIMEOUT)
        .http2_keep_alive_interval(HTTP2_KEEP_ALIVE_INTERVAL)
        .http2_keep_alive_timeout(HTTP2_KEEP_ALIVE_TIMEOUT)
        .http2_keep_alive_while_idle(true)
        .tcp_keepalive(TCP_KEEPALIVE)
        .build()
}

/// Runs `call`, recording `service_request_total` and `service_request_duration` always and
/// `service_error_total` when it fails. `service` and `action` become metric labels, so they must
/// be fixed strings, never request data.
pub async fn observe<T, E>(
    metrics: &Metrics,
    service: &'static str,
    action: &'static str,
    call: impl Future<Output = Result<T, E>>,
) -> Result<T, E> {
    let labels = [service, action];
    let start = Instant::now();
    let result = call.await;
    if result.is_err() {
        metrics.service_errors.with_label_values(&labels).inc();
    }
    metrics
        .service_request_duration
        .with_label_values(&labels)
        .observe(start.elapsed().as_secs_f64());
    metrics.service_requests.with_label_values(&labels).inc();
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn records_requests_and_errors() {
        let metrics = Metrics::new();
        let ok: Result<u8, &str> = observe(&metrics, "ccb", "get_ccb_forms", async { Ok(1) }).await;
        let err: Result<u8, &str> =
            observe(&metrics, "ccb", "get_ccb_forms", async { Err("boom") }).await;
        assert_eq!((ok, err), (Ok(1), Err("boom")));

        let text = metrics.render();
        assert!(text.contains(r#"service_request_total{action="get_ccb_forms",service="ccb"} 2"#));
        assert!(text.contains(r#"service_error_total{action="get_ccb_forms",service="ccb"} 1"#));
        assert!(
            text.contains(
                r#"service_request_duration_count{action="get_ccb_forms",service="ccb"} 2"#
            )
        );
    }
}
