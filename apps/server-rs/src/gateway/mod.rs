//! The gateway: this server answers the operations it has ported and forwards everything else
//! to the TS server, so a client sees the complete API at every stage of the port
//! (`docs/superpowers/specs/2026-10-14-server-rs-parity-design.md`).

pub mod forward;
pub mod route;

/// Who answered a `/graphql` request. The handler puts it in the response's extensions for the
/// request log, the metrics and error reporting.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Route {
    /// This server answered, including with an error.
    Local,
    /// The request went to the TS server.
    Forward,
}

impl Route {
    /// The value of the log field and the metric label.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Forward => "forward",
        }
    }
}

/// What happened upstream for a forwarded request, in the response's extensions.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Upstream {
    /// TS's status, or `None` when TS never answered.
    pub status: Option<u16>,
    /// From sending the request to the end of TS's body, or to the failure.
    pub duration: std::time::Duration,
}

/// Kept between the gateway's deadline and the router's own timeout.
pub const DEADLINE_HEADROOM: std::time::Duration = std::time::Duration::from_millis(100);

/// When a forwarded exchange must end: `APP_TIMEOUT_MS` after the request arrived, less
/// [`DEADLINE_HEADROOM`]. The router's `TimeoutLayer` starts its clock later and checks it before
/// the handler, so without the headroom it would answer first, with an empty 504.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RequestDeadline(pub tokio::time::Instant);

impl RequestDeadline {
    /// The deadline for a request arriving now, with the whole-request `timeout`.
    pub fn starting_now(timeout: std::time::Duration) -> Self {
        Self(tokio::time::Instant::now() + timeout.saturating_sub(DEADLINE_HEADROOM))
    }
}

/// Middleware that stamps each request with its [`RequestDeadline`]; it runs outside the timeout
/// layer, before that layer starts its clock.
pub async fn stamp_deadline(
    axum::extract::State(timeout): axum::extract::State<std::time::Duration>,
    mut request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    request
        .extensions_mut()
        .insert(RequestDeadline::starting_now(timeout));
    next.run(request).await
}

#[cfg(test)]
mod tests;
