//! `createStreamMetadataDataLoader` (`apps/server/src/graphql/loaders/streamMetadataDataLoader.ts`):
//! within one request, each stream's legacy metadata is loaded once, failures included, so
//! `title` and `description` share it, and at most four loads run at once. A failed read is
//! logged as a warning and answers no metadata.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};

use tokio::sync::{OnceCell, Semaphore};

use crate::fields::live_stream::projection::{StreamMetadata, StreamProjectionStore};

/// `Effect.forEach(keys, loadLegacyMetadata, { concurrency: 4 })`.
pub const METADATA_CONCURRENCY: usize = 4;

/// One stream's load in this request: `None` once the read has failed.
type MetadataCell = Arc<OnceCell<Option<StreamMetadata>>>;

/// One request's `streamMetadata` loader.
pub struct StreamMetadataLoader {
    entries: Mutex<HashMap<String, MetadataCell>>,
    permits: Semaphore,
}

impl Default for StreamMetadataLoader {
    fn default() -> Self {
        Self {
            entries: Mutex::default(),
            permits: Semaphore::new(METADATA_CONCURRENCY),
        }
    }
}

impl StreamMetadataLoader {
    /// `streamMetadata.load(id)`: the cached legacy metadata, or `None` when the read failed.
    pub async fn load(
        &self,
        store: &StreamProjectionStore,
        stream_id: &str,
    ) -> Option<StreamMetadata> {
        let cell = self
            .entries
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .entry(stream_id.to_owned())
            .or_default()
            .clone();
        cell.get_or_init(|| async {
            // Held until the read ends. The semaphore is never closed, so `acquire` cannot fail.
            let _permit = self.permits.acquire().await;
            match store.cached_public_metadata(stream_id).await {
                Ok(metadata) => Some(metadata),
                Err(error) => {
                    // TS annotates `streamId` and `cause`; the names are kept.
                    tracing::warn!(
                        streamId = stream_id,
                        cause = %error,
                        "Failed to load live stream metadata"
                    );
                    None
                }
            }
        })
        .await
        .clone()
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use serde_json::json;

    use super::*;
    use crate::fields::live_stream::projection::CASTR_STREAMS_COLLECTION;
    use crate::google::firestore::{Document, FirestoreValue};
    use crate::strapi::record_cache::testing::LogCapture;
    use crate::test_support::FakeDocuments;

    fn titled(title: &str) -> Document {
        Document::new([("title".to_owned(), FirestoreValue::String(title.to_owned()))])
    }

    // "Share the legacy fallback between both fields, including failures, within one request."
    #[tokio::test]
    async fn loads_each_stream_once_per_request_failures_included() {
        let documents = Arc::new(
            FakeDocuments::default()
                .with(
                    CASTR_STREAMS_COLLECTION,
                    "stream-1",
                    titled("Example Title"),
                )
                .failing_on(CASTR_STREAMS_COLLECTION, "stream-2"),
        );
        let store = StreamProjectionStore::new(documents.clone());
        let loader = StreamMetadataLoader::default();
        let logs = LogCapture::default();
        let _guard = logs.install();
        let expected = Some(StreamMetadata {
            title: Some("Example Title".to_owned()),
            description: None,
        });

        for _ in 0..2 {
            assert_eq!(loader.load(&store, "stream-1").await, expected);
            assert_eq!(loader.load(&store, "stream-2").await, None);
        }
        assert_eq!(documents.reads_of(CASTR_STREAMS_COLLECTION, "stream-1"), 1);
        // The store keeps no failure; the request's loader does.
        assert_eq!(documents.reads_of(CASTR_STREAMS_COLLECTION, "stream-2"), 1);
        let annotations = json!({ "streamId": "stream-2", "cause": "Firestore answered HTTP 503" });
        assert_eq!(
            logs.lines(),
            [format!(
                "Warn Failed to load live stream metadata {annotations}"
            )]
        );

        // The next request reads the failed stream again.
        assert_eq!(
            StreamMetadataLoader::default()
                .load(&store, "stream-2")
                .await,
            None
        );
        assert_eq!(documents.reads_of(CASTR_STREAMS_COLLECTION, "stream-2"), 2);
    }

    // `Effect.forEach(keys, loadLegacyMetadata, { concurrency: 4 })`.
    #[tokio::test(start_paused = true)]
    async fn runs_at_most_four_reads_at_once() {
        // The assertion below compares against the constant, so pin the TS value here.
        assert_eq!(METADATA_CONCURRENCY, 4);
        let documents = Arc::new(FakeDocuments::default().with_delay(Duration::from_millis(10)));
        let store = StreamProjectionStore::new(documents.clone());
        let loader = StreamMetadataLoader::default();
        let answers = tokio::join!(
            loader.load(&store, "stream-1"),
            loader.load(&store, "stream-2"),
            loader.load(&store, "stream-3"),
            loader.load(&store, "stream-4"),
            loader.load(&store, "stream-5"),
            loader.load(&store, "stream-6"),
        );
        assert_eq!(answers.0, Some(StreamMetadata::default()));
        assert_eq!(documents.reads(), 6);
        assert_eq!(documents.max_in_flight(), METADATA_CONCURRENCY);
    }
}
