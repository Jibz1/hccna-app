//! The Strapi 5 client: a port of `packages/strapi-v2` (transport, query documents, records,
//! rich content, the Tiptap → EditorJS conversion) and of the server's CMS content service in
//! `apps/server/src/effect/services/cms/content` (record cache, `CmsContent`).

pub mod client;
pub mod content;
mod html;
pub(crate) mod js;
pub mod queries;
pub mod record_cache;
pub mod records;
pub mod rich_content;
pub mod rich_text;
pub mod transport;

pub use client::StrapiClient;
pub use content::{CmsContent, CmsContentError, CmsContentErrorReason, CmsFuture, CmsSource};
pub use transport::Transport;

use std::fmt;

/// Why a Strapi 5 read failed, as `StrapiV2Error["reason"]` in `packages/strapi-v2/src/errors.ts`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StrapiErrorReason {
    Transport,
    Status,
    GraphQL,
    Decode,
}

impl fmt::Display for StrapiErrorReason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Transport => "Transport",
            Self::Status => "Status",
            Self::GraphQL => "GraphQL",
            Self::Decode => "Decode",
        })
    }
}

/// A failed Strapi 5 operation (`StrapiV2Error`). `operation` is the GraphQL operation name, a
/// fixed string that is also the `action` metric label.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum StrapiError {
    /// Strapi could not be reached, or the response body could not be read. Retried.
    #[error("Strapi 5 {operation} failed (Transport): {detail}")]
    Transport {
        operation: &'static str,
        detail: String,
    },
    /// Strapi answered with a non-2xx status. Retried for 5xx, 408 and 429.
    #[error("Strapi 5 {operation} failed (Status): {detail}")]
    Status {
        operation: &'static str,
        status: u16,
        detail: String,
    },
    /// The response carried GraphQL `errors`.
    #[error("Strapi 5 {operation} failed (GraphQL): {detail}")]
    GraphQL {
        operation: &'static str,
        detail: String,
    },
    /// The response, or content inside it, did not have the expected shape.
    #[error("Strapi 5 {operation} failed (Decode): {detail}")]
    Decode {
        operation: &'static str,
        detail: String,
    },
}

impl StrapiError {
    pub fn reason(&self) -> StrapiErrorReason {
        match self {
            Self::Transport { .. } => StrapiErrorReason::Transport,
            Self::Status { .. } => StrapiErrorReason::Status,
            Self::GraphQL { .. } => StrapiErrorReason::GraphQL,
            Self::Decode { .. } => StrapiErrorReason::Decode,
        }
    }

    pub fn operation(&self) -> &'static str {
        match self {
            Self::Transport { operation, .. }
            | Self::Status { operation, .. }
            | Self::GraphQL { operation, .. }
            | Self::Decode { operation, .. } => operation,
        }
    }

    pub fn detail(&self) -> &str {
        match self {
            Self::Transport { detail, .. }
            | Self::Status { detail, .. }
            | Self::GraphQL { detail, .. }
            | Self::Decode { detail, .. } => detail,
        }
    }

    /// `isRetryable` in `transport.ts`: transport failures, 5xx, 408 and 429.
    pub fn is_retryable(&self) -> bool {
        match self {
            Self::Transport { .. } => true,
            Self::Status { status, .. } => *status >= 500 || *status == 408 || *status == 429,
            Self::GraphQL { .. } | Self::Decode { .. } => false,
        }
    }
}
