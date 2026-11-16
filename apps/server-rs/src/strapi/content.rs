//! `CmsContent` (`apps/server/src/effect/services/cms/content/CmsContent.ts`), the server's only
//! way to read CMS content, backed by Strapi 5 as `makeCmsContentV5` in `v5Layer.ts` does: each
//! member reads through the record cache with the TS cache keys, and a failed read is logged once
//! and reported as `Malformed` (decode) or `Unavailable` (anything else).
//!
//! Only the members the phase 1 fields read are ported (`campuses`, `events`, `sermons`,
//! `thoughtOfGod`); `invalidate` is not, because no CMS change notice reaches this server.
//!
//! Resolvers read through [`CmsSource`], which `CmsContent` implements, so tests can serve
//! records without Strapi, as the TS tests provide a fake `CmsContent` layer.

use std::fmt;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use super::record_cache::{CacheArea, RecordCache, SharedStore, record_cache_key};
use super::records::{
    CampusRecord, EventQuery, EventRecord, SermonCursor, SermonPage, SermonQuery,
    ThoughtOfGodRecord,
};
use super::{StrapiClient, StrapiError, StrapiErrorReason, Transport};
use crate::config::CmsConfig;
use crate::metrics::Metrics;
use crate::store::RedisStore;

/// `CmsContentError["reason"]`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CmsContentErrorReason {
    /// Strapi could not be reached or answered with an error.
    Unavailable,
    /// Strapi answered with data the server cannot read.
    Malformed,
}

impl fmt::Display for CmsContentErrorReason {
    /// Lowercase, as the TS message's `reason.toLowerCase()`.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Unavailable => "unavailable",
            Self::Malformed => "malformed",
        })
    }
}

/// `CmsContentError`. `operation` is the `CmsContent` member (`"campuses"`, …); `detail` is the
/// Strapi error's message.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
#[error("CMS {operation} {reason}: {detail}")]
pub struct CmsContentError {
    pub reason: CmsContentErrorReason,
    pub operation: &'static str,
    pub detail: String,
}

/// A boxed `CmsContent` read.
pub type CmsFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, CmsContentError>> + Send + 'a>>;

/// The `CmsContent` members the fields read. The server uses [`CmsContent`]; tests inject a fake
/// through `state::Dependencies::cms`, the way the TS tests replace the `CmsContent` layer. The
/// trait only forwards: caching, logging and error mapping stay in `CmsContent`.
pub trait CmsSource: Send + Sync {
    fn campuses(&self) -> CmsFuture<'_, Vec<CampusRecord>>;
    fn events(&self, query: EventQuery) -> CmsFuture<'_, Vec<EventRecord>>;
    fn sermons(&self, query: SermonQuery) -> CmsFuture<'_, SermonPage>;
    fn thought_of_god(&self) -> CmsFuture<'_, Option<ThoughtOfGodRecord>>;
}

impl<S: SharedStore> CmsSource for CmsContent<S> {
    fn campuses(&self) -> CmsFuture<'_, Vec<CampusRecord>> {
        Box::pin(CmsContent::campuses(self))
    }

    fn events(&self, query: EventQuery) -> CmsFuture<'_, Vec<EventRecord>> {
        Box::pin(CmsContent::events(self, query))
    }

    fn sermons(&self, query: SermonQuery) -> CmsFuture<'_, SermonPage> {
        Box::pin(CmsContent::sermons(self, query))
    }

    fn thought_of_god(&self) -> CmsFuture<'_, Option<ThoughtOfGodRecord>> {
        Box::pin(CmsContent::thought_of_god(self))
    }
}

/// The CMS content service. Cloning is cheap.
pub struct CmsContent<S: SharedStore = RedisStore> {
    inner: Arc<Inner<S>>,
}

struct Inner<S: SharedStore> {
    client: StrapiClient,
    cache: RecordCache<S>,
}

impl<S: SharedStore> Clone for CmsContent<S> {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
        }
    }
}

impl CmsContent {
    /// `CmsContentV5Live`: Strapi 5 at `CMS_V5_ENDPOINT`, cached in memory and Redis.
    pub fn new(
        config: &CmsConfig,
        http: reqwest::Client,
        metrics: Metrics,
        redis: RedisStore,
    ) -> Self {
        Self::with_store(config, http, metrics, redis)
    }
}

impl<S: SharedStore> CmsContent<S> {
    pub fn with_store(
        config: &CmsConfig,
        http: reqwest::Client,
        metrics: Metrics,
        shared: S,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                client: StrapiClient::new(Transport::new(config, http, metrics)),
                cache: RecordCache::new(shared),
            }),
        }
    }

    /// `campuses`.
    pub async fn campuses(&self) -> Result<Vec<CampusRecord>, CmsContentError> {
        let key = record_cache_key(CacheArea::Campuses, &[]);
        self.inner
            .cache
            .cached(&key, || read("campuses", self.inner.client.campuses()))
            .await
    }

    /// `events(filter)`.
    pub async fn events(&self, query: EventQuery) -> Result<Vec<EventRecord>, CmsContentError> {
        let key = record_cache_key(
            CacheArea::Events,
            &[
                Some(&query.campus_slug),
                query.reoccurring.as_deref(),
                query.slug.as_deref(),
                query.upcoming_from.as_deref(),
            ],
        );
        self.inner
            .cache
            .cached(&key, || read("events", self.inner.client.events(&query)))
            .await
    }

    /// `sermons(query)`.
    ///
    /// The cache key encoding is TS's (`makeCmsContentV5` in `v5Layer.ts`), kept byte for byte:
    /// slugs are joined with "," and `record_cache_key` joins parts with "|" (`None` and `""`
    /// alike), so inputs such as `["a,b"]` and `["a", "b"]` share one entry. That collision is by
    /// design of the port, which must behave as the TS server does; only the cursors are
    /// JSON-quoted (`cursor_key_part`), as in TS.
    pub async fn sermons(&self, query: SermonQuery) -> Result<SermonPage, CmsContentError> {
        let key = match &query {
            SermonQuery::Slugs(slugs) => {
                let joined = slugs.join(",");
                record_cache_key(CacheArea::Sermons, &[Some("slugs"), Some(&joined)])
            }
            SermonQuery::Page {
                page_size,
                after,
                before,
            } => {
                let page_size = page_size.to_string();
                let after = after.as_ref().map(cursor_key_part);
                let before = before.as_ref().map(cursor_key_part);
                record_cache_key(
                    CacheArea::Sermons,
                    &[
                        Some("page"),
                        Some(&page_size),
                        after.as_deref(),
                        before.as_deref(),
                    ],
                )
            }
        };
        self.inner
            .cache
            .cached(&key, || read("sermons", self.inner.client.sermons(&query)))
            .await
    }

    /// `thoughtOfGod`: `None` when the single type is missing.
    pub async fn thought_of_god(&self) -> Result<Option<ThoughtOfGodRecord>, CmsContentError> {
        let key = record_cache_key(CacheArea::ThoughtOfGod, &[]);
        self.inner
            .cache
            .cached(&key, || {
                read("thoughtOfGod", self.inner.client.thought_of_god())
            })
            .await
    }
}

/// Cursors come from clients: JSON keeps an empty cursor apart from none, and its quoting keeps
/// a "|" inside a value from passing for a key separator (`JSON.stringify([date, slug])`).
fn cursor_key_part(cursor: &SermonCursor) -> String {
    serde_json::to_string(&[&cursor.date, &cursor.slug]).unwrap_or_default()
}

/// `read`: a client read reported under its `CmsContent` member: Decode → Malformed, the rest →
/// Unavailable. Each failure is logged once, here.
async fn read<T>(
    operation: &'static str,
    call: impl Future<Output = Result<T, StrapiError>>,
) -> Result<T, CmsContentError> {
    call.await.map_err(|error| {
        tracing::error!(
            operation,
            reason = %error.reason(),
            detail = error.detail(),
            "Strapi 5 read failed"
        );
        CmsContentError {
            reason: match error.reason() {
                StrapiErrorReason::Decode => CmsContentErrorReason::Malformed,
                _ => CmsContentErrorReason::Unavailable,
            },
            operation,
            detail: error.to_string(),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Secret;
    use crate::strapi::record_cache::testing::{LogCapture, MemoryStore, Mode};
    use serde_json::{Value, json};
    use std::sync::Mutex;
    use wiremock::{Mock, MockServer, Request, ResponseTemplate};

    fn campus() -> Value {
        json!({
            "slug": "new-breed", "CampusName": "New Breed", "Phone": null, "Address": null,
            "CityState": null, "FacebookChannelLink": null, "InstagramChannelLink": null,
            "LiveStreamChannelLink": null, "body": null, "Header": null, "Stream": null,
            "GivingPlatforms": null, "leaderships": [],
        })
    }

    struct FakeStrapi {
        _server: MockServer,
        operations: Arc<Mutex<Vec<String>>>,
        cms: CmsContent<MemoryStore>,
        store: MemoryStore,
    }

    impl FakeStrapi {
        fn operations(&self) -> Vec<String> {
            self.operations.lock().unwrap().clone()
        }
    }

    /// Answers each operation with `{"data": <its data>}` (or `status` when it is not 200) and
    /// records the operations requested.
    async fn fake_strapi(data_by_operation: Value, status: u16, mode: Mode) -> FakeStrapi {
        let server = MockServer::start().await;
        let operations = Arc::new(Mutex::new(Vec::new()));
        let seen = operations.clone();
        Mock::given(wiremock::matchers::method("POST"))
            .respond_with(move |request: &Request| {
                let body: Value = serde_json::from_slice(&request.body).unwrap();
                let operation = body["operationName"].as_str().unwrap().to_owned();
                let data = data_by_operation
                    .get(&operation)
                    .cloned()
                    .unwrap_or(Value::Null);
                seen.lock().unwrap().push(operation);
                ResponseTemplate::new(status).set_body_string(json!({ "data": data }).to_string())
            })
            .mount(&server)
            .await;
        let config = CmsConfig {
            endpoint: format!("{}/graphql", server.uri()),
            token: Secret::new("example-cms-token"),
        };
        let store = MemoryStore::new(mode);
        let cms = CmsContent::with_store(
            &config,
            crate::upstream::http_client().unwrap(),
            Metrics::new(),
            store.clone(),
        );
        FakeStrapi {
            _server: server,
            operations,
            cms,
            store,
        }
    }

    fn names(records: &[CampusRecord]) -> Vec<Option<String>> {
        records.iter().map(|record| record.name.clone()).collect()
    }

    #[tokio::test]
    async fn caches_campuses() {
        let strapi = fake_strapi(
            json!({ "StrapiV2Campuses": { "campuses": [campus()] } }),
            200,
            Mode::Working,
        )
        .await;

        let first = strapi.cms.campuses().await.unwrap();
        strapi.cms.campuses().await.unwrap();

        assert_eq!(names(&first), [Some("New Breed".to_owned())]);
        assert_eq!(strapi.operations(), ["StrapiV2Campuses"]);
        assert!(strapi.store.entry("rs:cms-v5:3:campuses:").is_some());
    }

    // Review Focus: Redis down on Railway must still serve CMS data.
    #[tokio::test]
    async fn serves_campuses_while_redis_is_down() {
        let strapi = fake_strapi(
            json!({ "StrapiV2Campuses": { "campuses": [campus()] } }),
            200,
            Mode::Failing,
        )
        .await;

        let first = strapi.cms.campuses().await.unwrap();
        let second = strapi.cms.campuses().await.unwrap();

        assert_eq!(names(&first), names(&second));
        assert_eq!(strapi.operations(), ["StrapiV2Campuses"]);
    }

    fn page(
        page_size: i64,
        after: Option<(&str, &str)>,
        before: Option<(&str, &str)>,
    ) -> SermonQuery {
        let cursor = |(date, slug): (&str, &str)| SermonCursor {
            date: date.to_owned(),
            slug: slug.to_owned(),
        };
        SermonQuery::Page {
            page_size,
            after: after.map(cursor),
            before: before.map(cursor),
        }
    }

    fn filter(campus_slug: &str, reoccurring: Option<&str>) -> EventQuery {
        EventQuery {
            campus_slug: campus_slug.to_owned(),
            reoccurring: reoccurring.map(str::to_owned),
            ..EventQuery::default()
        }
    }

    #[tokio::test]
    async fn caches_events_and_sermons_per_query_under_the_ts_keys() {
        let strapi = fake_strapi(
            json!({
                "StrapiV2Events": { "events": [] },
                "StrapiV2Sermons": { "sermons": [], "sermonPage": null },
            }),
            200,
            Mode::Working,
        )
        .await;
        let cms = &strapi.cms;

        cms.events(filter("new-breed", None)).await.unwrap();
        cms.events(filter("new-breed", None)).await.unwrap();
        cms.events(filter("new-breed", Some("Weekly")))
            .await
            .unwrap();
        cms.events(filter("light-house", None)).await.unwrap();
        cms.sermons(page(4, None, None)).await.unwrap();
        cms.sermons(page(4, None, None)).await.unwrap();
        cms.sermons(page(4, Some(("2026-09-01", "a")), None))
            .await
            .unwrap();
        cms.sermons(page(4, Some(("2026-09-01", "b")), None))
            .await
            .unwrap();
        cms.sermons(SermonQuery::Slugs(vec!["a".to_owned(), "b".to_owned()]))
            .await
            .unwrap();

        assert_eq!(
            strapi.operations(),
            [
                "StrapiV2Events",
                "StrapiV2Events",
                "StrapiV2Events",
                "StrapiV2Sermons",
                "StrapiV2Sermons",
                "StrapiV2Sermons",
                "StrapiV2Sermons",
            ]
        );
        let mut keys: Vec<String> = strapi
            .store
            .entries
            .lock()
            .unwrap()
            .keys()
            .cloned()
            .collect();
        keys.sort();
        assert_eq!(
            keys,
            [
                "rs:cms-v5:3:events:light-house|||",
                "rs:cms-v5:3:events:new-breed|Weekly||",
                "rs:cms-v5:3:events:new-breed|||",
                "rs:cms-v5:3:sermons:page|4|[\"2026-09-01\",\"a\"]|",
                "rs:cms-v5:3:sermons:page|4|[\"2026-09-01\",\"b\"]|",
                "rs:cms-v5:3:sermons:page|4||",
                "rs:cms-v5:3:sermons:slugs|a,b",
            ]
        );
        assert_eq!(
            strapi
                .store
                .entry("rs:cms-v5:3:sermons:page|4||")
                .as_deref(),
            Some(r#"{"items":[],"featuredImg":null,"body":null}"#)
        );
    }

    // Cursors come from clients: an empty one must not share the first page's cache entry.
    #[tokio::test]
    async fn keys_sermon_pages_by_whether_a_cursor_was_given() {
        let strapi = fake_strapi(
            json!({ "StrapiV2Sermons": { "sermons": [], "sermonPage": null } }),
            200,
            Mode::Working,
        )
        .await;

        strapi.cms.sermons(page(4, None, None)).await.unwrap();
        strapi
            .cms
            .sermons(page(4, Some(("", "")), None))
            .await
            .unwrap();
        strapi
            .cms
            .sermons(page(4, None, Some(("", ""))))
            .await
            .unwrap();

        assert_eq!(
            strapi.operations(),
            ["StrapiV2Sermons", "StrapiV2Sermons", "StrapiV2Sermons"]
        );
        assert!(
            strapi
                .store
                .entry("rs:cms-v5:3:sermons:page|4||[\"\",\"\"]")
                .is_some()
        );
    }

    #[tokio::test]
    async fn caches_a_missing_thought_of_god() {
        let strapi = fake_strapi(
            json!({ "StrapiV2ThoughtOfGod": { "tog": null } }),
            200,
            Mode::Working,
        )
        .await;

        assert_eq!(strapi.cms.thought_of_god().await, Ok(None));
        assert_eq!(strapi.cms.thought_of_god().await, Ok(None));

        assert_eq!(strapi.operations(), ["StrapiV2ThoughtOfGod"]);
        assert_eq!(
            strapi.store.entry("rs:cms-v5:3:thoughtOfGod:").as_deref(),
            Some("null")
        );
    }

    #[tokio::test]
    async fn reports_undecodable_data_as_malformed() {
        let mut bad = campus();
        bad["body"] = json!({ "type": "doc", "content": [{ "type": "mysteryWidget" }] });
        let strapi = fake_strapi(
            json!({ "StrapiV2Campuses": { "campuses": [bad] } }),
            200,
            Mode::Working,
        )
        .await;

        let error = strapi.cms.campuses().await.unwrap_err();

        assert_eq!(
            error,
            CmsContentError {
                reason: CmsContentErrorReason::Malformed,
                operation: "campuses",
                detail: "Strapi 5 StrapiV2Campuses failed (Decode): Unsupported rich text node: mysteryWidget"
                    .to_owned(),
            }
        );
        assert_eq!(
            error.to_string(),
            "CMS campuses malformed: Strapi 5 StrapiV2Campuses failed (Decode): Unsupported rich text node: mysteryWidget"
        );
    }

    #[tokio::test]
    async fn logs_a_failed_read_once() {
        let mut bad = campus();
        bad["GivingPlatforms"] = json!([{ "Platform": "Venmo", "link": null }]);
        let strapi = fake_strapi(
            json!({ "StrapiV2Campuses": { "campuses": [bad] } }),
            200,
            Mode::Working,
        )
        .await;
        let logs = LogCapture::default();
        let _guard = logs.install();

        let error = strapi.cms.campuses().await.unwrap_err();

        assert_eq!(error.reason, CmsContentErrorReason::Malformed);
        let lines = logs.lines();
        assert_eq!(lines.len(), 1, "{lines:?}");
        assert!(lines[0].starts_with(
            r#"Error Strapi 5 read failed {"operation":"campuses","reason":"Decode","detail":"#
        ));
        assert!(lines[0].contains("Venmo"));
    }

    #[tokio::test]
    async fn reports_an_unreachable_cms_as_unavailable_and_caches_nothing() {
        let strapi = fake_strapi(json!({}), 401, Mode::Working).await;

        let first = strapi.cms.campuses().await.unwrap_err();
        let second = strapi.cms.campuses().await.unwrap_err();

        assert_eq!(first.reason, CmsContentErrorReason::Unavailable);
        assert_eq!(
            first.detail,
            "Strapi 5 StrapiV2Campuses failed (Status): Strapi 5 responded 401 Unauthorized"
        );
        assert_eq!(first, second);
        assert_eq!(
            strapi.operations(),
            ["StrapiV2Campuses", "StrapiV2Campuses"]
        );
        assert!(strapi.store.entries.lock().unwrap().is_empty());
    }
}
