//! Prometheus metrics with the TS server's names, labels and buckets, so both servers' `/metrics`
//! can be compared directly. Served on its own port, like `apps/server/src/metrics.ts`.

use prometheus::{
    Encoder, HistogramOpts, HistogramVec, IntCounterVec, Opts, Registry, TextEncoder,
};

/// `DEFAULT_DURATION_HISTOGRAM_BUCKETS` in `apps/server/src/metrics/create.ts`: the defaults up
/// to 10 s, extended to the 20 s request timeout.
pub const DURATION_BUCKETS: [f64; 13] = [
    0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 15.0, 20.0,
];

#[derive(Clone)]
pub struct Metrics {
    registry: Registry,
    /// Labels: `method`, `path_group`, `status_class`.
    pub http_request_duration: HistogramVec,
    /// HTTP 5xx responses. Labels: `method`, `path_group`.
    pub http_errors: IntCounterVec,
    /// Labels: `operationName`, `operationType`, and the Rust-only `route` (`local`, `forward`).
    pub graphql_requests: IntCounterVec,
    /// Whole-request duration of `/graphql` requests. Labels: `operationName`, `operationType`,
    /// and the Rust-only `route`: a forwarded request's duration includes TS's time and the
    /// network hop, so comparisons with TS read `local` only.
    pub graphql_request_duration: HistogramVec,
    /// Upstream calls. Labels: `service`, `action`.
    pub service_requests: IntCounterVec,
    /// Labels: `service`, `action`.
    pub service_request_duration: HistogramVec,
    /// Failed upstream calls. Labels: `service`, `action`.
    pub service_errors: IntCounterVec,
    /// Labels: `dependency`, `reason`.
    pub readiness_failures: IntCounterVec,
    /// `/graphql` requests by who answered. Rust-only. Labels: `route` (`local`, `forward`),
    /// `status_class` (of the response the client got).
    pub gateway_requests: IntCounterVec,
    /// Duration of `/graphql` requests by who answered. Rust-only. Labels: `route`, `status_class`.
    pub gateway_request_duration: HistogramVec,
}

impl Metrics {
    pub fn new() -> Self {
        let registry = Registry::new();
        let metrics = Self {
            http_request_duration: histogram(
                &registry,
                "http_server_request_duration_seconds",
                "Server request duration in seconds",
                &["method", "path_group", "status_class"],
            ),
            http_errors: counter(
                &registry,
                "http_server_errors_total",
                "Count of HTTP 5xx responses",
                &["method", "path_group"],
            ),
            graphql_requests: counter(
                &registry,
                "graphql_envelop_request_total",
                "Counts the amount of GraphQL requests executed",
                &["operationName", "operationType", "route"],
            ),
            graphql_request_duration: histogram(
                &registry,
                "graphql_envelop_request_duration",
                "Time spent on a GraphQL request, in seconds",
                &["operationName", "operationType", "route"],
            ),
            service_requests: counter(
                &registry,
                "service_request_total",
                "Count of service requests",
                &["service", "action"],
            ),
            service_request_duration: histogram(
                &registry,
                "service_request_duration",
                "Duration of service requests",
                &["service", "action"],
            ),
            service_errors: counter(
                &registry,
                "service_error_total",
                "Count of service errors",
                &["service", "action"],
            ),
            readiness_failures: counter(
                &registry,
                "readiness_dependency_failures_total",
                "Count of readiness dependency probe failures",
                &["dependency", "reason"],
            ),
            gateway_requests: counter(
                &registry,
                "gateway_requests_total",
                "Count of /graphql requests by the server that answered",
                &["route", "status_class"],
            ),
            gateway_request_duration: histogram(
                &registry,
                "gateway_request_duration_seconds",
                "Duration of /graphql requests by the server that answered, in seconds",
                &["route", "status_class"],
            ),
            registry,
        };
        register_process_collector(&metrics.registry);
        metrics
    }

    /// The Prometheus text exposition of every registered metric.
    pub fn render(&self) -> String {
        let mut buffer = Vec::new();
        TextEncoder::new()
            .encode(&self.registry.gather(), &mut buffer)
            .expect("encoding metrics into a Vec cannot fail");
        String::from_utf8(buffer).expect("the Prometheus text format is UTF-8")
    }
}

impl Default for Metrics {
    fn default() -> Self {
        Self::new()
    }
}

fn histogram(registry: &Registry, name: &str, help: &str, labels: &[&str]) -> HistogramVec {
    let metric = HistogramVec::new(
        HistogramOpts::new(name, help).buckets(DURATION_BUCKETS.to_vec()),
        labels,
    )
    .expect("metric definitions are static and valid");
    registry
        .register(Box::new(metric.clone()))
        .expect("metric names are unique");
    metric
}

fn counter(registry: &Registry, name: &str, help: &str, labels: &[&str]) -> IntCounterVec {
    let metric = IntCounterVec::new(Opts::new(name, help), labels)
        .expect("metric definitions are static and valid");
    registry
        .register(Box::new(metric.clone()))
        .expect("metric names are unique");
    metric
}

/// `process_resident_memory_bytes`, `process_cpu_seconds_total` and friends. They read `/proc`,
/// so they exist only on Linux (the container), not on a macOS dev machine.
#[cfg(target_os = "linux")]
fn register_process_collector(registry: &Registry) {
    let collector = prometheus::process_collector::ProcessCollector::for_self();
    registry
        .register(Box::new(collector))
        .expect("the process collector registers once");
}

#[cfg(not(target_os = "linux"))]
fn register_process_collector(_registry: &Registry) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_observed_series_with_ts_names_and_buckets() {
        let metrics = Metrics::new();
        metrics
            .http_request_duration
            .with_label_values(&["GET", "/healthz", "2xx"])
            .observe(0.003);
        metrics
            .graphql_requests
            .with_label_values(&["CoreDataQuery", "query", "local"])
            .inc();

        let text = metrics.render();
        assert!(text.contains(
            r#"http_server_request_duration_seconds_bucket{method="GET",path_group="/healthz",status_class="2xx",le="0.005"} 1"#
        ));
        assert!(text.contains(
            r#"http_server_request_duration_seconds_bucket{method="GET",path_group="/healthz",status_class="2xx",le="20"} 1"#
        ));
        assert!(text.contains(
            r#"graphql_envelop_request_total{operationName="CoreDataQuery",operationType="query",route="local"} 1"#
        ));
    }
}
