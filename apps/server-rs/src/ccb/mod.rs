//! A client for the CCB v1 XML API's read services, ported from `packages/ccb` and the caching
//! that `apps/server/src/effect/services/CCBService.ts` puts around it. The giving fields read
//! through it; the profile and attendance slices of the parity spec will too.

pub mod cache;
pub mod client;
pub mod records;
pub mod request;
pub mod transport;
pub mod xml;

pub use client::CcbClient;

/// Why a CCB read failed. Messages never include the request URL, which can hold an email.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum CcbError {
    /// No response arrived (connection, DNS, timeout) or its body could not be read
    /// (`CCBFetchError` "CCB request failed" / "Failed to read response").
    #[error("{0}")]
    Transport(String),
    /// A response outside 200–299 (`CCBFetchError` "CCB API error: <status>").
    #[error("CCB API error: {status}")]
    Status { status: u16 },
    /// The body is not the expected XML (`CCBParseError`).
    #[error("Failed to parse CCB XML: {0}")]
    Decode(String),
    /// The document has no `<response>`, or an empty one (`CCBParseError` "No response body from
    /// CCB"). CCB answers this way for an event occurrence without saved attendance.
    #[error("No response body from CCB")]
    EmptyResponse,
    /// `<response>` holds CCB's `<errors>` (or a lone `<error>`) element.
    #[error("{message}")]
    Remote { message: String },
}

impl CcbError {
    /// The retry rule of `fetchGet`: transport failures, 5xx, 408 and 429.
    pub fn is_retryable(&self) -> bool {
        match self {
            Self::Transport(_) => true,
            Self::Status { status } => {
                (500..=599).contains(status) || *status == 408 || *status == 429
            }
            Self::Decode(_) | Self::EmptyResponse | Self::Remote { .. } => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retries_transport_failures_5xx_408_and_429_only() {
        let retryable = |error: CcbError| error.is_retryable();
        assert!(retryable(CcbError::Transport(
            "CCB request failed".to_owned()
        )));
        for status in [500, 502, 503, 599, 408, 429] {
            assert!(retryable(CcbError::Status { status }), "{status}");
        }
        for status in [400, 401, 403, 404, 499, 600] {
            assert!(!retryable(CcbError::Status { status }), "{status}");
        }
        assert!(!retryable(CcbError::Decode("bad".to_owned())));
        assert!(!retryable(CcbError::EmptyResponse));
        assert!(!retryable(CcbError::Remote {
            message: "Example permission error".to_owned()
        }));
    }
}
