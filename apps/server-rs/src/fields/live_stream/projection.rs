//! The read side of `StreamProjectionStore`
//! (`apps/server/src/effect/services/StreamProjectionStore.ts`) that `liveStreamStatus` uses:
//!
//! - `getLiveStreams`: the `app-config/live-stream` aggregate, read on every call and decoded with
//!   `LiveStreamConfigSchema` (`apps/server/src/effect/services/StreamMappingService.ts`), with
//!   the published metadata in `metadataByStreamId`;
//! - `getCachedPublicMetadata`: the legacy `castr-streams/{id}` title and description for streams
//!   saved before the aggregate carried metadata, in a process cache of 100 streams that keeps a
//!   successful read 5 minutes and no failure; concurrent callers share one read.
//!
//! The writes (`updateStreamMetadata`, `setLiveStatus`) are not ported. TS invalidates its
//! legacy cache when it saves metadata, and the same save publishes `metadataByStreamId`, which
//! takes precedence, so this cache needs no invalidation from TS.

use std::sync::Arc;
use std::time::Duration;

use tokio::time::Instant;

use crate::google::firestore::{Document, DocumentSource, FirestoreError, FirestoreValue};

/// `AppCollections.config` / `AppCollections.liveStreamDoc`.
pub const CONFIG_COLLECTION: &str = "app-config";
pub const LIVE_STREAM_DOCUMENT: &str = "live-stream";
/// `AppCollections.castrStreams`.
pub const CASTR_STREAMS_COLLECTION: &str = "castr-streams";
/// `STREAM_METADATA_CACHE_TTL`.
pub const METADATA_TTL: Duration = Duration::from_secs(5 * 60);
/// The legacy metadata cache's `capacity`.
pub const METADATA_CAPACITY: u64 = 100;

/// A stream's shared title and description (`StreamMetadata`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct StreamMetadata {
    pub title: Option<String>,
    pub description: Option<String>,
}

/// One `streams` entry (`LiveStreamEntry`), with the published metadata when the aggregate has it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LiveStreamEntry {
    pub id: String,
    pub slug: Option<String>,
    pub is_live: bool,
    pub metadata: Option<StreamMetadata>,
}

/// `LiveStreamConfigReadError`: the aggregate could not be read or decoded. The text is the
/// `cause` the TS resolver logs.
#[derive(Debug, thiserror::Error)]
pub enum LiveStreamConfigReadError {
    #[error(transparent)]
    Read(#[from] FirestoreError),
    /// An Effect `SchemaError`-shaped issue: what was expected, then where.
    #[error("{0}")]
    Decode(String),
}

fn issue(expected: &str, path: String) -> LiveStreamConfigReadError {
    LiveStreamConfigReadError::Decode(format!("{expected}\n  at {path}"))
}

/// `getLiveStreams` after the read. A missing document or `streams` field means no streams. An
/// entry that is not `{ id: string, slug?: string, isLive: boolean }` fails the whole aggregate, as
/// the schema decode does (other keys are ignored). An entry takes `metadataByStreamId[id]` when
/// that is a map whose `title` and `description` are both strings.
pub fn decode_live_streams(
    document: Option<&Document>,
) -> Result<Vec<LiveStreamEntry>, LiveStreamConfigReadError> {
    let Some(document) = document else {
        return Ok(Vec::new());
    };
    let entries = match document.get("streams") {
        None => return Ok(Vec::new()),
        Some(FirestoreValue::Array(entries)) => entries,
        Some(_) => {
            return Err(issue(
                "Expected array | undefined",
                r#"["streams"]"#.to_owned(),
            ));
        }
    };
    let published = match document.get("metadataByStreamId") {
        Some(FirestoreValue::Map(published)) => Some(published),
        _ => None,
    };
    entries
        .iter()
        .enumerate()
        .map(|(index, value)| {
            let mut entry = decode_entry(index, value)?;
            entry.metadata = published
                .and_then(|published| published.get(&entry.id))
                .and_then(published_metadata);
            Ok(entry)
        })
        .collect()
}

/// `LiveStreamEntrySchema`, checked in its key order: `id`, `slug`, `isLive`.
fn decode_entry(
    index: usize,
    value: &FirestoreValue,
) -> Result<LiveStreamEntry, LiveStreamConfigReadError> {
    let path = |key: &str| format!(r#"["streams"][{index}]["{key}"]"#);
    let FirestoreValue::Map(fields) = value else {
        return Err(issue("Expected object", format!(r#"["streams"][{index}]"#)));
    };
    let id = match fields.get("id") {
        Some(FirestoreValue::String(id)) => id.clone(),
        None => return Err(issue("Missing key", path("id"))),
        Some(_) => return Err(issue("Expected string", path("id"))),
    };
    let slug = match fields.get("slug") {
        None => None,
        Some(FirestoreValue::String(slug)) => Some(slug.clone()),
        Some(_) => return Err(issue("Expected string | undefined", path("slug"))),
    };
    let is_live = match fields.get("isLive") {
        Some(FirestoreValue::Boolean(is_live)) => *is_live,
        None => return Err(issue("Missing key", path("isLive"))),
        Some(_) => return Err(issue("Expected boolean", path("isLive"))),
    };
    Ok(LiveStreamEntry {
        id,
        slug,
        is_live,
        metadata: None,
    })
}

/// `decodePublishedMetadata`: both `title` and `description` must be strings.
fn published_metadata(value: &FirestoreValue) -> Option<StreamMetadata> {
    let FirestoreValue::Map(fields) = value else {
        return None;
    };
    match (fields.get("title"), fields.get("description")) {
        (Some(FirestoreValue::String(title)), Some(FirestoreValue::String(description))) => {
            Some(StreamMetadata {
                title: Some(title.clone()),
                description: Some(description.clone()),
            })
        }
        _ => None,
    }
}

/// `loadStreamMetadata`: the document's string `title` and `description` (`decodeMetadataString`);
/// a missing document has neither.
fn legacy_metadata(document: Option<&Document>) -> StreamMetadata {
    let string = |field: &str| match document.and_then(|document| document.get(field)) {
        Some(FirestoreValue::String(text)) => Some(text.clone()),
        _ => None,
    };
    StreamMetadata {
        title: string("title"),
        description: string("description"),
    }
}

/// A cached legacy read and when it expires, on tokio's clock so tests can move it. moka's own
/// TTL (the same 5 minutes, on its clock) only drops entries nobody reads again.
#[derive(Clone)]
struct CachedMetadata {
    metadata: StreamMetadata,
    expires: Instant,
}

/// The stream reads behind `liveStreamStatus`.
pub struct StreamProjectionStore {
    documents: Arc<dyn DocumentSource>,
    metadata: moka::future::Cache<String, CachedMetadata>,
}

impl StreamProjectionStore {
    pub fn new(documents: Arc<dyn DocumentSource>) -> Self {
        Self {
            documents,
            metadata: moka::future::Cache::builder()
                .max_capacity(METADATA_CAPACITY)
                .time_to_live(METADATA_TTL)
                .build(),
        }
    }

    /// `getLiveStreams`: every stream entry in the aggregate.
    pub async fn live_streams(&self) -> Result<Vec<LiveStreamEntry>, LiveStreamConfigReadError> {
        let document = self
            .documents
            .get_document(CONFIG_COLLECTION, LIVE_STREAM_DOCUMENT)
            .await?;
        decode_live_streams(document.as_ref())
    }

    /// `getCachedPublicMetadata`: the legacy title and description, kept [`METADATA_TTL`] after a
    /// successful read. A failed read reaches every caller waiting on it and is kept nowhere.
    pub async fn cached_public_metadata(
        &self,
        stream_id: &str,
    ) -> Result<StreamMetadata, Arc<FirestoreError>> {
        if let Some(cached) = self.metadata.get(stream_id).await {
            if cached.expires > Instant::now() {
                return Ok(cached.metadata);
            }
            self.metadata.invalidate(stream_id).await;
        }
        self.metadata
            .try_get_with(stream_id.to_owned(), async {
                let document = self
                    .documents
                    .get_document(CASTR_STREAMS_COLLECTION, stream_id)
                    .await?;
                Ok::<_, FirestoreError>(CachedMetadata {
                    metadata: legacy_metadata(document.as_ref()),
                    expires: Instant::now() + METADATA_TTL,
                })
            })
            .await
            .map(|cached| cached.metadata)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::FakeDocuments;

    fn string(text: &str) -> FirestoreValue {
        FirestoreValue::String(text.to_owned())
    }

    fn map(fields: &[(&str, FirestoreValue)]) -> FirestoreValue {
        FirestoreValue::Map(
            fields
                .iter()
                .map(|(name, value)| ((*name).to_owned(), value.clone()))
                .collect(),
        )
    }

    fn document(fields: &[(&str, FirestoreValue)]) -> Document {
        Document::new(
            fields
                .iter()
                .map(|(name, value)| ((*name).to_owned(), value.clone())),
        )
    }

    fn stream(id: &str, slug: Option<&str>, is_live: bool) -> FirestoreValue {
        let mut fields = vec![
            ("id", string(id)),
            ("isLive", FirestoreValue::Boolean(is_live)),
        ];
        if let Some(slug) = slug {
            fields.push(("slug", string(slug)));
        }
        map(&fields)
    }

    fn published(title: &str, description: &str) -> FirestoreValue {
        map(&[
            ("title", string(title)),
            ("description", string(description)),
        ])
    }

    fn entry(
        id: &str,
        slug: Option<&str>,
        is_live: bool,
        metadata: Option<(&str, &str)>,
    ) -> LiveStreamEntry {
        LiveStreamEntry {
            id: id.to_owned(),
            slug: slug.map(str::to_owned),
            is_live,
            metadata: metadata.map(|(title, description)| StreamMetadata {
                title: Some(title.to_owned()),
                description: Some(description.to_owned()),
            }),
        }
    }

    fn decode(fields: &[(&str, FirestoreValue)]) -> Result<Vec<LiveStreamEntry>, String> {
        decode_live_streams(Some(&document(fields))).map_err(|error| error.to_string())
    }

    // `data ?? {}` and `config.streams ?? []`.
    #[test]
    fn reads_no_streams_without_the_document_or_its_streams() {
        assert_eq!(
            decode_live_streams(None).unwrap(),
            Vec::<LiveStreamEntry>::new()
        );
        assert_eq!(decode(&[]), Ok(vec![]));
        assert_eq!(
            decode(&[("streams", FirestoreValue::Array(vec![]))]),
            Ok(vec![])
        );
        assert_eq!(
            decode(&[(
                "metadataByStreamId",
                map(&[(
                    "stream-1",
                    published("Example Title", "Example description")
                )])
            )]),
            Ok(vec![])
        );
    }

    // The schema keeps `id`, `slug` and `isLive` and ignores other keys.
    #[test]
    fn reads_streams_in_order_and_ignores_other_keys() {
        assert_eq!(
            decode(&[
                (
                    "streams",
                    FirestoreValue::Array(vec![
                        stream("stream-1", Some("campus-a"), true),
                        map(&[
                            ("id", string("stream-2")),
                            ("isLive", FirestoreValue::Boolean(false)),
                            ("startedAt", FirestoreValue::Other),
                        ]),
                    ])
                ),
                (
                    "campusLiveStatus",
                    map(&[("campus-a", FirestoreValue::Boolean(true))])
                ),
            ]),
            Ok(vec![
                entry("stream-1", Some("campus-a"), true, None),
                entry("stream-2", None, false, None),
            ])
        );
    }

    // `decodePublishedMetadata`: `{ title: string, description: string }` or nothing.
    #[test]
    fn attaches_published_metadata_only_when_title_and_description_are_strings() {
        let streams = FirestoreValue::Array(
            [
                "stream-1", "stream-2", "stream-3", "stream-4", "stream-5", "stream-6",
            ]
            .into_iter()
            .map(|id| stream(id, None, true))
            .collect(),
        );
        let metadata = map(&[
            (
                "stream-1",
                published("Example Title", "Example description"),
            ),
            ("stream-2", map(&[("title", string("Only a title"))])),
            (
                "stream-3",
                map(&[
                    ("title", string("Example Title")),
                    ("description", FirestoreValue::Other),
                ]),
            ),
            ("stream-4", string("not a map")),
            ("stream-5", published("", "")),
        ]);
        assert_eq!(
            decode(&[("streams", streams), ("metadataByStreamId", metadata)]),
            Ok(vec![
                entry(
                    "stream-1",
                    None,
                    true,
                    Some(("Example Title", "Example description"))
                ),
                entry("stream-2", None, true, None),
                entry("stream-3", None, true, None),
                entry("stream-4", None, true, None),
                entry("stream-5", None, true, Some(("", ""))),
                entry("stream-6", None, true, None),
            ])
        );
    }

    // `decodeMetadataMap` fails quietly: the streams still decode.
    #[test]
    fn ignores_metadata_that_is_not_a_map() {
        let streams = FirestoreValue::Array(vec![stream("stream-1", None, true)]);
        for metadata in [
            FirestoreValue::Array(vec![published("Example Title", "Example description")]),
            string("stream-1"),
            FirestoreValue::Other,
        ] {
            assert_eq!(
                decode(&[
                    ("streams", streams.clone()),
                    ("metadataByStreamId", metadata)
                ]),
                Ok(vec![entry("stream-1", None, true, None)])
            );
        }
    }

    // `Schema.decodeUnknownEffect(LiveStreamConfigSchema)` stops at the first issue.
    #[test]
    fn fails_the_whole_aggregate_on_one_bad_entry() {
        let good = stream("stream-0", Some("campus-a"), true);
        let cases: Vec<(FirestoreValue, &str)> = vec![
            (string("stream-1"), "Expected object\n  at [\"streams\"][1]"),
            (
                map(&[("isLive", FirestoreValue::Boolean(true))]),
                "Missing key\n  at [\"streams\"][1][\"id\"]",
            ),
            (
                map(&[
                    ("id", FirestoreValue::Other),
                    ("isLive", FirestoreValue::Boolean(true)),
                ]),
                "Expected string\n  at [\"streams\"][1][\"id\"]",
            ),
            (
                map(&[
                    ("id", string("stream-1")),
                    ("slug", FirestoreValue::Other),
                    ("isLive", FirestoreValue::Boolean(true)),
                ]),
                "Expected string | undefined\n  at [\"streams\"][1][\"slug\"]",
            ),
            (
                map(&[("id", string("stream-1"))]),
                "Missing key\n  at [\"streams\"][1][\"isLive\"]",
            ),
            (
                map(&[("id", string("stream-1")), ("isLive", string("true"))]),
                "Expected boolean\n  at [\"streams\"][1][\"isLive\"]",
            ),
        ];
        for (bad, message) in cases {
            assert_eq!(
                decode(&[("streams", FirestoreValue::Array(vec![good.clone(), bad]))]),
                Err(message.to_owned()),
                "{message}"
            );
        }
        for streams in [string("stream-1"), map(&[]), FirestoreValue::Other] {
            assert_eq!(
                decode(&[("streams", streams)]),
                Err("Expected array | undefined\n  at [\"streams\"]".to_owned())
            );
        }
    }

    fn store_over(documents: &Arc<FakeDocuments>) -> StreamProjectionStore {
        StreamProjectionStore::new(documents.clone())
    }

    // `getLiveStreams` reads the aggregate on every call; nothing caches it.
    #[tokio::test]
    async fn reads_the_aggregate_on_every_call() {
        let documents = Arc::new(FakeDocuments::default().with(
            CONFIG_COLLECTION,
            LIVE_STREAM_DOCUMENT,
            document(&[(
                "streams",
                FirestoreValue::Array(vec![stream("stream-1", Some("campus-a"), true)]),
            )]),
        ));
        let store = store_over(&documents);
        for _ in 0..2 {
            assert_eq!(
                store.live_streams().await.unwrap(),
                vec![LiveStreamEntry {
                    id: "stream-1".to_owned(),
                    slug: Some("campus-a".to_owned()),
                    is_live: true,
                    metadata: None,
                }]
            );
        }
        assert_eq!(
            documents.reads_of(CONFIG_COLLECTION, LIVE_STREAM_DOCUMENT),
            2
        );
    }

    #[tokio::test]
    async fn answers_no_streams_without_the_aggregate() {
        let documents = Arc::new(FakeDocuments::default());
        assert!(
            store_over(&documents)
                .live_streams()
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn fails_with_the_read_error_when_firestore_fails() {
        let documents = Arc::new(FakeDocuments::failing());
        let error = store_over(&documents).live_streams().await.unwrap_err();
        assert!(matches!(
            error,
            LiveStreamConfigReadError::Read(FirestoreError::Status(503))
        ));
        assert_eq!(error.to_string(), "Firestore answered HTTP 503");
    }

    // `decodeMetadataString` keeps strings only; a successful read is kept 5 minutes.
    #[tokio::test(start_paused = true)]
    async fn reads_legacy_strings_and_caches_them_for_five_minutes() {
        let documents = Arc::new(FakeDocuments::default().with(
            CASTR_STREAMS_COLLECTION,
            "stream-1",
            document(&[
                ("title", string("Example Title")),
                ("description", FirestoreValue::Other),
            ]),
        ));
        let store = store_over(&documents);
        let expected = StreamMetadata {
            title: Some("Example Title".to_owned()),
            description: None,
        };
        assert_eq!(
            store.cached_public_metadata("stream-1").await.unwrap(),
            expected
        );
        tokio::time::advance(METADATA_TTL - Duration::from_millis(1)).await;
        assert_eq!(
            store.cached_public_metadata("stream-1").await.unwrap(),
            expected
        );
        assert_eq!(documents.reads_of(CASTR_STREAMS_COLLECTION, "stream-1"), 1);
        tokio::time::advance(Duration::from_millis(1)).await;
        assert_eq!(
            store.cached_public_metadata("stream-1").await.unwrap(),
            expected
        );
        assert_eq!(documents.reads_of(CASTR_STREAMS_COLLECTION, "stream-1"), 2);
    }

    // `snapshot.data()` is undefined: no title or description, and that success is cached.
    #[tokio::test]
    async fn caches_a_missing_legacy_document_as_no_metadata() {
        let documents = Arc::new(FakeDocuments::default());
        let store = store_over(&documents);
        for _ in 0..2 {
            assert_eq!(
                store.cached_public_metadata("stream-1").await.unwrap(),
                StreamMetadata::default()
            );
        }
        assert_eq!(documents.reads_of(CASTR_STREAMS_COLLECTION, "stream-1"), 1);
    }

    // `timeToLive: (exit) => (Exit.isSuccess(exit) ? STREAM_METADATA_CACHE_TTL : 0)`.
    #[tokio::test]
    async fn does_not_cache_a_failed_legacy_read() {
        let documents =
            Arc::new(FakeDocuments::default().failing_on(CASTR_STREAMS_COLLECTION, "stream-1"));
        let store = store_over(&documents);
        for _ in 0..2 {
            let error = store.cached_public_metadata("stream-1").await.unwrap_err();
            assert_eq!(error.to_string(), "Firestore answered HTTP 503");
        }
        assert_eq!(documents.reads_of(CASTR_STREAMS_COLLECTION, "stream-1"), 2);
    }

    // "Joining callers wait on it."
    #[tokio::test(start_paused = true)]
    async fn shares_one_legacy_read_between_concurrent_callers() {
        let documents = Arc::new(
            FakeDocuments::default()
                .with(
                    CASTR_STREAMS_COLLECTION,
                    "stream-1",
                    document(&[
                        ("title", string("Example Title")),
                        ("description", string("Example description")),
                    ]),
                )
                .with_delay(Duration::from_millis(10)),
        );
        let store = store_over(&documents);
        let (first, second) = tokio::join!(
            store.cached_public_metadata("stream-1"),
            store.cached_public_metadata("stream-1")
        );
        assert_eq!(first.unwrap(), second.unwrap());
        assert_eq!(documents.reads_of(CASTR_STREAMS_COLLECTION, "stream-1"), 1);
    }

    #[test]
    fn keeps_the_ts_cache_settings() {
        assert_eq!(METADATA_TTL, Duration::from_secs(300));
        assert_eq!(METADATA_CAPACITY, 100);
    }
}
