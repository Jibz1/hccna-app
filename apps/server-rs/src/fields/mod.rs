//! Root fields, one module per field group. Each module names the TS file it ports.

pub mod campuses;
pub mod ccb_forms;
pub mod core;
pub mod events;
pub mod giving;
pub mod giving_history;
pub mod legacy_wire;
pub mod live_stream;
pub mod scalars;
pub mod sermons;
pub mod thought_of_god;
pub mod user;
pub mod vod;

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use tokio::sync::OnceCell;

/// Per-request caches, like the TS server's per-request DataLoaders: a field selected several
/// times in one request loads once.
#[derive(Default)]
pub struct RequestLoaders {
    pub ccb_forms: OnceCell<Arc<Vec<ccb_forms::CcbFormData>>>,
    /// `streamMetadata`: each stream's legacy metadata, loaded once per request.
    pub stream_metadata: live_stream::loader::StreamMetadataLoader,
    /// `userProfile` and `woa`, for the caller.
    pub user: user::UserLoaders,
}

/// The time resolvers read (`Date.now()`, Luxon's `DateTime.now()`); tests fix it, as the TS
/// tests call `setSystemTime`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Clock {
    fixed_ms: Option<i64>,
}

impl Clock {
    pub fn system() -> Self {
        Self::default()
    }

    /// A clock stopped at `ms` since the Unix epoch.
    pub fn fixed(ms: i64) -> Self {
        Self { fixed_ms: Some(ms) }
    }

    /// Milliseconds since the Unix epoch.
    pub fn now_ms(&self) -> i64 {
        self.fixed_ms.unwrap_or_else(|| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |elapsed| {
                    i64::try_from(elapsed.as_millis()).unwrap_or(i64::MAX)
                })
        })
    }
}
