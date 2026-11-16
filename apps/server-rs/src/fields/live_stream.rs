//! `liveStreamStatus` (`apps/server/src/graphql/schema/castr/liveStreamStatus.ts`): every stream in
//! the `app-config/live-stream` aggregate, or only the streams of one campus slug (trimmed and
//! compared case-insensitively; a blank slug keeps every stream), as `LiveStreamStatusSuccess`.
//! `title` and `description` come from the aggregate's published metadata, else from the legacy
//! `castr-streams/{id}` document through the request's [`loader::StreamMetadataLoader`], read only
//! when one of them is selected; a failed legacy read answers null for both and logs a warning. A
//! failed read or decode of the aggregate is logged with its cause and answered with
//! `LiveStreamStatusFetchError`. The response-cache TTL is 0 (`graphql/response_cache.rs`).

pub mod loader;
pub mod projection;

use std::sync::Arc;

use async_graphql::{ComplexObject, Context, ID, Object, SimpleObject, Union};

use crate::fields::RequestLoaders;
use crate::fields::live_stream::projection::{
    LiveStreamEntry, StreamMetadata, StreamProjectionStore,
};
use crate::graphql::guards::Authorized;
use crate::strapi::js;

/// `LiveStreamStatusFetchError`'s message.
pub const FETCH_ERROR_MESSAGE: &str = "Unable to load live stream status";

// `LiveStream`. (No doc comment: it would become a GraphQL description; TS has none.)
#[derive(Clone, Debug, PartialEq, SimpleObject)]
#[graphql(complex)]
pub struct LiveStream {
    /// The Castr stream ID
    pub id: ID,
    /// The campus slug this stream belongs to, or null when it has no campus
    pub slug: Option<String>,
    // (No doc comment: TS gives `isLive` no description.)
    pub is_live: bool,
    /// The aggregate's published metadata, when it has some for this stream.
    #[graphql(skip)]
    pub metadata: Option<StreamMetadata>,
}

impl From<LiveStreamEntry> for LiveStream {
    fn from(entry: LiveStreamEntry) -> Self {
        Self {
            id: ID(entry.id),
            slug: entry.slug,
            is_live: entry.is_live,
            metadata: entry.metadata,
        }
    }
}

#[ComplexObject]
impl LiveStream {
    /// The stream's shared title, or null when unavailable. Legacy metadata may lag edits briefly.
    async fn title(&self, ctx: &Context<'_>) -> async_graphql::Result<Option<String>> {
        Ok(self
            .shared_metadata(ctx)
            .await?
            .and_then(|metadata| metadata.title))
    }

    /// The stream's shared description, or null when unavailable. Legacy metadata may lag edits briefly.
    async fn description(&self, ctx: &Context<'_>) -> async_graphql::Result<Option<String>> {
        Ok(self
            .shared_metadata(ctx)
            .await?
            .and_then(|metadata| metadata.description))
    }
}

impl LiveStream {
    /// `root.metadata`, else `ctx.loaders.streamMetadata.load(root.id)`.
    async fn shared_metadata(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Option<StreamMetadata>> {
        if let Some(metadata) = &self.metadata {
            return Ok(Some(metadata.clone()));
        }
        let store = ctx.data::<Arc<StreamProjectionStore>>()?;
        let loaders = ctx.data::<RequestLoaders>()?;
        Ok(loaders.stream_metadata.load(store, self.id.as_str()).await)
    }
}

// `LiveStreamStatusSuccess`. (No doc comment: TS has no description.)
#[derive(Clone, Debug, PartialEq, SimpleObject)]
pub struct LiveStreamStatusSuccess {
    pub streams: Vec<LiveStream>,
}

// `LiveStreamStatusFetchError`. (No doc comment: TS has no description.)
#[derive(Clone, Debug, PartialEq, SimpleObject)]
pub struct LiveStreamStatusFetchError {
    pub message: String,
}

// `LiveStreamStatusResult`. (No doc comment: TS has no description.)
#[derive(Clone, Debug, PartialEq, Union)]
pub enum LiveStreamStatusResult {
    LiveStreamStatusFetchError(LiveStreamStatusFetchError),
    LiveStreamStatusSuccess(LiveStreamStatusSuccess),
}

/// `loadLiveStreamStatus`.
pub async fn resolve(store: &StreamProjectionStore, slug: Option<&str>) -> LiveStreamStatusResult {
    let requested = slug
        .map(|slug| js::trim(slug).to_lowercase())
        .filter(|slug| !slug.is_empty());
    match store.live_streams().await {
        Ok(entries) => LiveStreamStatusResult::LiveStreamStatusSuccess(LiveStreamStatusSuccess {
            streams: entries
                .into_iter()
                .filter(|entry| {
                    requested.as_ref().is_none_or(|requested| {
                        entry
                            .slug
                            .as_ref()
                            .is_some_and(|slug| slug.to_lowercase() == *requested)
                    })
                })
                .map(LiveStream::from)
                .collect(),
        }),
        Err(error) => {
            tracing::error!(
                operation = "liveStreamStatus",
                cause = %error,
                "Failed to load live stream status"
            );
            LiveStreamStatusResult::LiveStreamStatusFetchError(LiveStreamStatusFetchError {
                message: FETCH_ERROR_MESSAGE.to_owned(),
            })
        }
    }
}

#[derive(Default)]
pub struct LiveStreamQuery;

#[Object]
impl LiveStreamQuery {
    /// Get each stream's live status, title, and description with typed success and error responses
    #[graphql(guard = "Authorized")]
    async fn live_stream_status(
        &self,
        ctx: &Context<'_>,
        #[graphql(
            desc = "Optional campus slug. Returns only that campus's streams; an unknown slug returns none. Omitted, null, or blank slugs return every stream."
        )]
        slug: Option<String>,
    ) -> async_graphql::Result<Option<LiveStreamStatusResult>> {
        let store = ctx.data::<Arc<StreamProjectionStore>>()?;
        Ok(Some(resolve(store, slug.as_deref()).await))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use serde_json::{Value, json};

    use crate::fields::live_stream::projection::{
        CASTR_STREAMS_COLLECTION, CONFIG_COLLECTION, LIVE_STREAM_DOCUMENT,
    };
    use crate::google::firestore::{Document, FirestoreValue};
    use crate::strapi::record_cache::testing::LogCapture;
    use crate::test_support::{
        FakeDocuments, TestServices, execute_with_variables, schema_from, viewer,
    };

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

    fn aggregate(streams: Vec<FirestoreValue>, metadata: &[(&str, FirestoreValue)]) -> Document {
        Document::new([
            ("streams".to_owned(), FirestoreValue::Array(streams)),
            ("metadataByStreamId".to_owned(), map(metadata)),
        ])
    }

    fn with_aggregate(document: Document) -> Arc<FakeDocuments> {
        Arc::new(FakeDocuments::default().with(CONFIG_COLLECTION, LIVE_STREAM_DOCUMENT, document))
    }

    async fn run(documents: Arc<FakeDocuments>, query: &str, variables: Value) -> Value {
        let services = TestServices {
            documents,
            ..TestServices::default()
        };
        execute_with_variables(&schema_from(&services), query, variables, Some(viewer())).await
    }

    const QUERY: &str =
        "query LiveStreamStatusQuery($slug: String) { liveStreamStatus(slug: $slug) {
        __typename
        ... on LiveStreamStatusSuccess { streams { id slug isLive title description } }
        ... on LiveStreamStatusFetchError { message }
    } }";

    #[tokio::test]
    async fn answers_every_stream_with_its_published_metadata() {
        let documents = with_aggregate(aggregate(
            vec![
                stream("stream-1", Some("campus-a"), true),
                stream("stream-2", None, false),
            ],
            &[
                (
                    "stream-1",
                    published("Example Title", "Example description"),
                ),
                ("stream-2", published("", "")),
            ],
        ));
        assert_eq!(
            run(documents.clone(), QUERY, Value::Null).await,
            json!({ "data": { "liveStreamStatus": {
                "__typename": "LiveStreamStatusSuccess",
                "streams": [
                    {
                        "id": "stream-1", "slug": "campus-a", "isLive": true,
                        "title": "Example Title", "description": "Example description",
                    },
                    { "id": "stream-2", "slug": null, "isLive": false, "title": "", "description": "" },
                ],
            } } })
        );
        // Only the aggregate: published metadata needs no legacy read.
        assert_eq!(documents.reads(), 1);
    }

    // `slug?.trim().toLowerCase()`, then `stream.slug?.toLowerCase() === requestedSlug`.
    #[tokio::test]
    async fn filters_by_slug_after_trimming_and_ignoring_case() {
        let documents = with_aggregate(aggregate(
            vec![
                stream("stream-1", Some("Campus-A"), true),
                stream("stream-2", Some("campus-b"), false),
                stream("stream-3", None, false),
            ],
            &[],
        ));
        let ids = |response: Value| -> Vec<String> {
            response["data"]["liveStreamStatus"]["streams"]
                .as_array()
                .unwrap()
                .iter()
                .map(|stream| stream["id"].as_str().unwrap().to_owned())
                .collect()
        };
        let query = "query LiveStreamStatusQuery($slug: String) { liveStreamStatus(slug: $slug) { ... on LiveStreamStatusSuccess { streams { id } } } }";
        let every = ["stream-1", "stream-2", "stream-3"];
        assert_eq!(
            ids(run(documents.clone(), query, json!({ "slug": " CAMPUS-a " })).await),
            ["stream-1"]
        );
        assert_eq!(
            ids(run(documents.clone(), query, json!({ "slug": "campus-c" })).await),
            Vec::<String>::new()
        );
        for slug in [json!("   "), json!(""), Value::Null] {
            assert_eq!(
                ids(run(documents.clone(), query, json!({ "slug": slug })).await),
                every,
                "{slug}"
            );
        }
        let without_argument = "query LiveStreamStatusQuery { liveStreamStatus { ... on LiveStreamStatusSuccess { streams { id } } } }";
        assert_eq!(
            ids(run(documents, without_argument, Value::Null).await),
            every
        );
    }

    // Only the requested slug is trimmed: `stream.slug?.toLowerCase() === requestedSlug`.
    #[tokio::test]
    async fn does_not_trim_stored_slugs() {
        let documents = with_aggregate(aggregate(
            vec![stream("stream-1", Some(" campus-a "), true)],
            &[],
        ));
        let query = "query LiveStreamStatusQuery($slug: String) { liveStreamStatus(slug: $slug) { ... on LiveStreamStatusSuccess { streams { id } } } }";
        for slug in ["campus-a", " campus-a "] {
            assert_eq!(
                run(documents.clone(), query, json!({ "slug": slug })).await,
                json!({ "data": { "liveStreamStatus": { "streams": [] } } }),
                "{slug}"
            );
        }
    }

    #[tokio::test]
    async fn answers_no_streams_without_the_aggregate_document() {
        assert_eq!(
            run(Arc::new(FakeDocuments::default()), QUERY, Value::Null).await,
            json!({ "data": { "liveStreamStatus": {
                "__typename": "LiveStreamStatusSuccess", "streams": [],
            } } })
        );
    }

    #[tokio::test]
    async fn answers_the_fetch_error_and_logs_the_read_failure() {
        let logs = LogCapture::default();
        let _guard = logs.install();
        assert_eq!(
            run(Arc::new(FakeDocuments::failing()), QUERY, Value::Null).await,
            json!({ "data": { "liveStreamStatus": {
                "__typename": "LiveStreamStatusFetchError",
                "message": "Unable to load live stream status",
            } } })
        );
        let annotations =
            json!({ "operation": "liveStreamStatus", "cause": "Firestore answered HTTP 503" });
        assert_eq!(
            logs.lines(),
            [format!(
                "Error Failed to load live stream status {annotations}"
            )]
        );
    }

    #[tokio::test]
    async fn answers_the_fetch_error_for_an_undecodable_aggregate() {
        let bad = map(&[("id", string("stream-1")), ("isLive", string("yes"))]);
        let documents = with_aggregate(aggregate(
            vec![stream("stream-0", Some("campus-a"), true), bad],
            &[],
        ));
        let logs = LogCapture::default();
        let _guard = logs.install();
        let response = run(documents, QUERY, Value::Null).await;
        assert_eq!(
            response["data"]["liveStreamStatus"],
            json!({
                "__typename": "LiveStreamStatusFetchError",
                "message": "Unable to load live stream status",
            })
        );
        let annotations = json!({
            "operation": "liveStreamStatus",
            "cause": "Expected boolean\n  at [\"streams\"][1][\"isLive\"]",
        });
        assert_eq!(
            logs.lines(),
            [format!(
                "Error Failed to load live stream status {annotations}"
            )]
        );
    }

    #[tokio::test]
    async fn requires_an_authorized_caller() {
        let documents = Arc::new(FakeDocuments::default());
        let services = TestServices {
            documents: documents.clone(),
            ..TestServices::default()
        };
        let body = execute_with_variables(&schema_from(&services), QUERY, Value::Null, None).await;
        assert_eq!(body["data"], json!({ "liveStreamStatus": null }));
        assert_eq!(
            body["errors"][0]["message"],
            "Not authorized to resolve Query.liveStreamStatus"
        );
        assert_eq!(documents.reads(), 0);
    }

    // The pipeline: TTL 0, so nothing is stored and every request reads the aggregate.
    #[tokio::test]
    async fn resolves_through_the_router_without_storing_the_response() {
        use crate::google::GoogleAuth;
        use crate::graphql::auth::testing::{GoogleMock, anonymous_claims, sign};
        use crate::test_support::{TestApp, post_graphql_as};

        let mock = GoogleMock::start().await;
        mock.mount_jwks(1).await;
        mock.mount_account(2).await;
        let documents = with_aggregate(aggregate(
            vec![stream("stream-1", Some("campus-a"), true)],
            &[(
                "stream-1",
                published("Example Title", "Example description"),
            )],
        ));
        let app = TestApp::with_dependencies(
            &mock,
            GoogleAuth::fixed("example-access-token"),
            |dependencies| dependencies.documents = Some(documents.clone()),
        );
        let body = json!({ "query": "query LiveStreamStatusQuery { liveStreamStatus { ... on LiveStreamStatusSuccess { streams { id isLive title } } } }" });
        let token = sign(&anonymous_claims());
        for _ in 0..2 {
            let response = app.send(post_graphql_as(body.clone(), &token)).await;
            assert_eq!(
                response.json(),
                json!({ "data": { "liveStreamStatus": { "streams": [
                    { "id": "stream-1", "isLive": true, "title": "Example Title" },
                ] } } })
            );
        }
        assert_eq!(
            documents.reads_of(CONFIG_COLLECTION, LIVE_STREAM_DOCUMENT),
            2
        );
    }

    #[tokio::test]
    async fn falls_back_to_the_legacy_document_once_per_stream() {
        let documents = Arc::new(
            FakeDocuments::default()
                .with(
                    CONFIG_COLLECTION,
                    LIVE_STREAM_DOCUMENT,
                    aggregate(
                        vec![
                            stream("stream-1", Some("campus-a"), true),
                            stream("stream-2", Some("campus-b"), false),
                            stream("stream-3", None, false),
                        ],
                        &[
                            (
                                "stream-1",
                                published("Example Title", "Example description"),
                            ),
                            // A title without a description is not published metadata.
                            ("stream-3", map(&[("title", string("Partial title"))])),
                        ],
                    ),
                )
                .with(
                    CASTR_STREAMS_COLLECTION,
                    "stream-2",
                    Document::new([
                        ("title".to_owned(), string("Legacy title")),
                        ("description".to_owned(), FirestoreValue::Other),
                    ]),
                ),
        );
        let response = run(
            documents.clone(),
            "query LiveStreamStatusQuery { liveStreamStatus { ... on LiveStreamStatusSuccess { streams { id title description again: title } } } }",
            Value::Null,
        )
        .await;
        assert_eq!(
            response,
            json!({ "data": { "liveStreamStatus": { "streams": [
                {
                    "id": "stream-1", "title": "Example Title",
                    "description": "Example description", "again": "Example Title",
                },
                { "id": "stream-2", "title": "Legacy title", "description": null, "again": "Legacy title" },
                { "id": "stream-3", "title": null, "description": null, "again": null },
            ] } } })
        );
        assert_eq!(documents.reads_of(CASTR_STREAMS_COLLECTION, "stream-1"), 0);
        assert_eq!(documents.reads_of(CASTR_STREAMS_COLLECTION, "stream-2"), 1);
        assert_eq!(documents.reads_of(CASTR_STREAMS_COLLECTION, "stream-3"), 1);
    }

    // The loader runs only from the `title` and `description` resolvers.
    #[tokio::test]
    async fn reads_no_legacy_document_unless_title_or_description_is_selected() {
        let documents = with_aggregate(aggregate(
            vec![stream("stream-2", Some("campus-b"), false)],
            &[],
        ));
        run(
            documents.clone(),
            "query LiveStreamStatusQuery { liveStreamStatus { ... on LiveStreamStatusSuccess { streams { id isLive } } } }",
            Value::Null,
        )
        .await;
        assert_eq!(documents.reads_of(CASTR_STREAMS_COLLECTION, "stream-2"), 0);
    }

    #[tokio::test]
    async fn answers_null_metadata_and_warns_once_when_the_legacy_read_fails() {
        let documents = Arc::new(
            FakeDocuments::default()
                .with(
                    CONFIG_COLLECTION,
                    LIVE_STREAM_DOCUMENT,
                    aggregate(vec![stream("stream-2", Some("campus-b"), false)], &[]),
                )
                .failing_on(CASTR_STREAMS_COLLECTION, "stream-2"),
        );
        let logs = LogCapture::default();
        let _guard = logs.install();
        let response = run(
            documents.clone(),
            "query LiveStreamStatusQuery { liveStreamStatus { ... on LiveStreamStatusSuccess { streams { id title description } } } }",
            Value::Null,
        )
        .await;
        assert_eq!(
            response,
            json!({ "data": { "liveStreamStatus": { "streams": [
                { "id": "stream-2", "title": null, "description": null },
            ] } } })
        );
        assert_eq!(documents.reads_of(CASTR_STREAMS_COLLECTION, "stream-2"), 1);
        let annotations = json!({ "streamId": "stream-2", "cause": "Firestore answered HTTP 503" });
        assert_eq!(
            logs.lines(),
            [format!(
                "Warn Failed to load live stream metadata {annotations}"
            )]
        );
    }
}
