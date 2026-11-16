//! The GraphQL response cache: the policy of `apps/server/src/graphql/sharedResponseCachePolicy.ts`
//! and `responseCache.ts`, graphql-yoga's `useResponseCache` (cache key, TTL, `ETag` and
//! `Last-Modified`), and the two-tier storage of
//! `apps/server/src/effect/services/GraphQLResponseCacheService.ts`.
//!
//! The entity index used for invalidation is not ported: nothing invalidates entries on this
//! server, so they expire by TTL. yoga's `If-None-Match` → 304 path is not ported either, because
//! the TS server never takes it: the plugin checks it in `onRequest`, before the policy has marked
//! the request cacheable, so its `enabled` check is always false there.

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use async_graphql::parser::types::{ExecutableDocument, OperationType, Selection, SelectionSet};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::graphql::handler::GraphqlParams;
use crate::graphql::memo::DocumentFacts;
use crate::graphql::operation;
use crate::store::kv::KeyValueStore;

/// `SHARED_RESPONSE_CACHE_QUERY_FIELDS`: root fields safe to share across callers.
pub const SHARED_QUERY_FIELDS: [&str; 12] = [
    "campuses",
    "campusesV2",
    "ccbForms",
    "ccbFormsV2",
    "core",
    "events",
    "home",
    "featuredEvents",
    "sermons",
    "thoughtOfGod",
    "verseOfTheDay",
    "verseOfTheDayV2",
];

/// `responseCacheDefaultTtlMs`.
pub const DEFAULT_TTL: Duration = Duration::from_secs(5 * 60);

/// `LRU_TTL_CAP_MS`: the in-process tier never keeps an entry longer than this.
pub const MEMORY_TTL_CAP: Duration = Duration::from_secs(30);

/// The in-process tier's size (`LRU_CACHE_MAX`, shared with other caches on the TS server).
pub const MEMORY_CAPACITY: u64 = 1000;

const TEN_MINUTES: Duration = Duration::from_secs(10 * 60);
const TWO_HOURS: Duration = Duration::from_secs(2 * 60 * 60);

/// `responseCacheTtlPerSchemaCoordinate` plus the plugin's `Query.__schema: 0`. `User.profile`
/// is left out: this schema's `User` type has no `profile` field, and `Query.user` is 0 anyway.
pub fn coordinate_ttl(coordinate: &str) -> Option<Duration> {
    match coordinate {
        "Query.home" | "Query.featuredEvents" => Some(Duration::from_secs(15)),
        "Query.core"
        | "Query.campuses"
        | "Query.campusesV2"
        | "Query.ccbFormsV2"
        | "Query.sermons"
        | "Query.events"
        | "Query.upcomingEventsByMonth"
        | "Query.thoughtOfGod" => Some(TEN_MINUTES),
        "Query.verseOfTheDay" | "Query.verseOfTheDayV2" => Some(TWO_HOURS),
        "Query.__schema"
        | "Query.castrStream"
        | "Query.liveStreamStatus"
        | "Query.user"
        | "Query.profile"
        | "Query.getPreviousFiveYearsGivingV2"
        | "Query.myGivingHistory"
        | "Query.exportAttendance" => Some(Duration::ZERO),
        _ => None,
    }
}

/// `scopePerSchemaCoordinate`: root fields never cached without a session.
const PRIVATE_ROOT_FIELDS: [&str; 5] = [
    "user",
    "profile",
    "getPreviousFiveYearsGivingV2",
    "myGivingHistory",
    "exportAttendance",
];

/// How one request uses the cache, decided before authentication.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CachePlan {
    /// The cache key, also the `ETag`.
    pub key: String,
    pub ttl: Duration,
    /// The raw `Authorization` value for per-caller entries; `None` when shared or absent.
    pub session: Option<String>,
}

impl CachePlan {
    /// The plan for a query, or `None` for mutations, subscriptions and unknown operations.
    /// `facts` memoizes the TTL per document when given.
    pub fn new(
        document: &ExecutableDocument,
        params: &GraphqlParams,
        authorization: Option<&str>,
        facts: Option<&DocumentFacts>,
    ) -> Option<Self> {
        let operation = operation::select_operation(document, params.operation_name.as_deref())?;
        let definition = &operation.definition.node;
        if definition.ty != OperationType::Query {
            return None;
        }
        // `queryUsesOnlySharedCacheFields`: at least one root field besides `__typename`, all
        // of them shareable.
        let fields = operation::root_fields(document, &definition.selection_set.node, true);
        let shared = !fields.is_empty()
            && fields
                .iter()
                .all(|field| SHARED_QUERY_FIELDS.contains(&field.as_str()));
        let session = if shared {
            None
        } else {
            authorization.map(str::to_owned)
        };
        Some(Self {
            key: cache_key(
                &params.query,
                params.operation_name.as_deref(),
                &params.variables,
                session.as_deref(),
            ),
            ttl: facts.map_or_else(
                || document_ttl(document),
                |facts| facts.ttl(|| document_ttl(document)),
            ),
            session,
        })
    }

    /// Whether `data` may be stored and given an `ETag`: yoga skips results that select a
    /// private root field when there is no session.
    pub fn allows(&self, data: &Value) -> bool {
        if self
            .session
            .as_deref()
            .is_some_and(|session| !session.is_empty())
        {
            return true;
        }
        !data.as_object().is_some_and(|root| {
            root.keys()
                .any(|key| PRIVATE_ROOT_FIELDS.contains(&key.as_str()))
        })
    }
}

/// `defaultBuildResponseCacheKey`: hex SHA-256 of
/// `[query, operationName ?? "", stableStringify(variables ?? {}), sessionId ?? ""].join("|")`.
pub fn cache_key(
    query: &str,
    operation_name: Option<&str>,
    variables: &Value,
    session: Option<&str>,
) -> String {
    let variables = match variables {
        Value::Null => "{}".to_owned(),
        other => stable_stringify(other),
    };
    let input = [
        query,
        operation_name.unwrap_or_default(),
        &variables,
        session.unwrap_or_default(),
    ]
    .join("|");
    hex::encode(Sha256::digest(input.as_bytes()))
}

/// `fast-json-stable-stringify`: JSON with object keys sorted.
pub fn stable_stringify(value: &Value) -> String {
    let mut out = String::new();
    write_stable(value, &mut out);
    out
}

fn write_stable(value: &Value, out: &mut String) {
    match value {
        Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_stable(item, out);
            }
            out.push(']');
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            out.push('{');
            for (index, key) in keys.into_iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                out.push_str(&Value::from(key.as_str()).to_string());
                out.push(':');
                write_stable(&map[key], out);
            }
            out.push('}');
        }
        scalar => out.push_str(&scalar.to_string()),
    }
}

/// The minimum TTL over every field coordinate in the document that has one, else the default.
/// Like the plugin's TypeInfo walk, it covers all operations and fragment definitions; only
/// root-level coordinates are known here, which covers every configured one but `User.profile`.
pub fn document_ttl(document: &ExecutableDocument) -> Duration {
    let mut ttl = None;
    let mut visit = |parent: &str, selection_set: &SelectionSet| {
        visit_root_ttl(parent, selection_set, &mut ttl);
    };
    for (_, operation) in document.operations.iter() {
        let parent = match operation.node.ty {
            OperationType::Query => "Query",
            OperationType::Mutation => "Mutation",
            // The plugin's visitor skips subscriptions.
            OperationType::Subscription => continue,
        };
        visit(parent, &operation.node.selection_set.node);
    }
    for fragment in document.fragments.values() {
        visit(
            fragment.node.type_condition.node.on.node.as_str(),
            &fragment.node.selection_set.node,
        );
    }
    ttl.unwrap_or(DEFAULT_TTL)
}

/// `calculateTtl` over the fields directly under `parent`, through inline fragments (fragment
/// spreads are covered by visiting their definitions).
fn visit_root_ttl(parent: &str, selection_set: &SelectionSet, ttl: &mut Option<Duration>) {
    for selection in &selection_set.items {
        match &selection.node {
            Selection::Field(field) => {
                let coordinate = format!("{parent}.{}", field.node.name.node);
                if let Some(field_ttl) = coordinate_ttl(&coordinate) {
                    *ttl = Some(ttl.map_or(field_ttl, |current| current.min(field_ttl)));
                }
            }
            Selection::InlineFragment(fragment) => {
                let parent = fragment
                    .node
                    .type_condition
                    .as_ref()
                    .map_or(parent, |condition| condition.node.on.node.as_str());
                visit_root_ttl(parent, &fragment.node.selection_set.node, ttl);
            }
            Selection::FragmentSpread(_) => {}
        }
    }
}

/// A cached result: its `data` and the validators it was stored with. In Redis it is the TS
/// shape, `{ data, extensions: { http: { headers: { ETag, Last-Modified } } } }`.
#[derive(Clone, Debug, PartialEq)]
pub struct CachedResult {
    /// Shared by every hit; serialized in place, never copied.
    pub data: Arc<Value>,
    /// Always present on entries this server wrote.
    pub etag: Option<Arc<str>>,
    pub last_modified: Option<Arc<str>>,
    /// Epoch milliseconds after which the entry is stale.
    pub expires_at_ms: u64,
}

impl CachedResult {
    pub fn etag(&self) -> Option<&str> {
        self.etag.as_deref()
    }

    pub fn last_modified(&self) -> Option<&str> {
        self.last_modified.as_deref()
    }

    /// The response body, `{"data": …}` (yoga strips `extensions.http`).
    pub fn body(&self) -> Vec<u8> {
        #[derive(Serialize)]
        struct Body<'a> {
            data: &'a Value,
        }
        serde_json::to_vec(&Body { data: &self.data }).expect("a JSON value serializes")
    }
}

/// The Redis value, written from borrowed parts.
#[derive(Serialize)]
struct StoredPayload<'a> {
    data: StoredResult<'a>,
    #[serde(rename = "expiresAt")]
    expires_at: u64,
}

#[derive(Serialize)]
struct StoredResult<'a> {
    data: &'a Value,
    extensions: StoredExtensions<'a>,
}

#[derive(Serialize)]
struct StoredExtensions<'a> {
    http: StoredHttp<'a>,
}

#[derive(Serialize)]
struct StoredHttp<'a> {
    headers: StoredHeaders<'a>,
}

#[derive(Serialize)]
struct StoredHeaders<'a> {
    #[serde(rename = "ETag")]
    etag: &'a str,
    #[serde(rename = "Last-Modified")]
    last_modified: &'a str,
}

/// The Redis value as read back.
#[derive(Deserialize)]
struct LoadedPayload {
    data: LoadedResult,
    #[serde(rename = "expiresAt")]
    expires_at: u64,
}

/// Lenient like the TS reader, which looks at `expiresAt` and hands back `data` as stored.
#[derive(Deserialize)]
struct LoadedResult {
    data: Value,
    #[serde(default)]
    extensions: Option<LoadedExtensions>,
}

#[derive(Deserialize)]
struct LoadedExtensions {
    #[serde(default)]
    http: Option<LoadedHttp>,
}

#[derive(Deserialize)]
struct LoadedHttp {
    #[serde(default)]
    headers: Option<LoadedHeaders>,
}

#[derive(Deserialize)]
struct LoadedHeaders {
    #[serde(rename = "ETag")]
    etag: Option<String>,
    #[serde(rename = "Last-Modified")]
    last_modified: Option<String>,
}

/// In-process tier (TTL ≤ 30 s) over Redis `{data, expiresAt}`.
pub struct ResponseCache {
    store: Arc<dyn KeyValueStore>,
    memory: moka::future::Cache<String, (CachedResult, Duration)>,
}

struct PerEntryTtl;

impl moka::Expiry<String, (CachedResult, Duration)> for PerEntryTtl {
    fn expire_after_create(
        &self,
        _key: &String,
        value: &(CachedResult, Duration),
        _created_at: std::time::Instant,
    ) -> Option<Duration> {
        Some(value.1)
    }
}

impl ResponseCache {
    pub fn new(store: Arc<dyn KeyValueStore>) -> Self {
        Self {
            store,
            memory: moka::future::Cache::builder()
                .max_capacity(MEMORY_CAPACITY)
                .expire_after(PerEntryTtl)
                .build(),
        }
    }

    fn redis_key(&self, key: &str) -> String {
        self.store
            .key(&format!("graphql:response-cache:result:v2:{key}"))
    }

    /// The cached result for `key`. Redis errors and undecodable entries are misses.
    pub async fn get(&self, key: &str) -> Option<CachedResult> {
        if let Some((cached, _)) = self.memory.get(key).await
            && cached.expires_at_ms > now_ms()
        {
            return Some(cached);
        }

        let redis_key = self.redis_key(key);
        let raw = self.store.get(&redis_key).await.ok().flatten()?;
        let payload: LoadedPayload = serde_json::from_str(&raw).ok()?;
        let expires_at_ms = payload.expires_at;
        let now = now_ms();
        if expires_at_ms <= now {
            self.memory.invalidate(key).await;
            let _ = self.store.del(&redis_key).await;
            return None;
        }
        let headers = payload
            .data
            .extensions
            .and_then(|extensions| extensions.http)
            .and_then(|http| http.headers);
        let (etag, last_modified) = headers.map_or((None, None), |headers| {
            (headers.etag, headers.last_modified)
        });
        let cached = CachedResult {
            data: Arc::new(payload.data.data),
            etag: etag.map(Arc::from),
            last_modified: last_modified.map(Arc::from),
            expires_at_ms,
        };
        let ttl = memory_ttl(Duration::from_millis(expires_at_ms - now));
        self.memory
            .insert(key.to_owned(), (cached.clone(), ttl))
            .await;
        Some(cached)
    }

    /// Stores an error-free result: in process now, in Redis in the background (the TS plugin
    /// does not await the write either). Redis errors are ignored.
    pub async fn store(
        self: &Arc<Self>,
        key: &str,
        data: Value,
        last_modified: &str,
        ttl: Duration,
    ) {
        let ttl_ms = u64::try_from(ttl.as_millis()).unwrap_or(u64::MAX);
        let cached = CachedResult {
            data: Arc::new(data),
            etag: Some(key.into()),
            last_modified: Some(last_modified.into()),
            expires_at_ms: now_ms().saturating_add(ttl_ms),
        };
        self.memory
            .insert(key.to_owned(), (cached.clone(), memory_ttl(ttl)))
            .await;

        let seconds = ttl_ms.div_ceil(1000).max(1);
        let redis_key = self.redis_key(key);
        let cache = Arc::clone(self);
        tokio::spawn(async move {
            let payload = StoredPayload {
                data: StoredResult {
                    data: &cached.data,
                    extensions: StoredExtensions {
                        http: StoredHttp {
                            headers: StoredHeaders {
                                etag: cached.etag.as_deref().unwrap_or_default(),
                                last_modified: cached.last_modified.as_deref().unwrap_or_default(),
                            },
                        },
                    },
                },
                expires_at: cached.expires_at_ms,
            };
            let Ok(payload) = serde_json::to_string(&payload) else {
                return;
            };
            let _ = cache.store.set_ex(&redis_key, seconds, &payload).await;
        });
    }
}

/// `min(ttl, 30 s)`, at least 1 ms.
pub fn memory_ttl(ttl: Duration) -> Duration {
    ttl.min(MEMORY_TTL_CAP).max(Duration::from_millis(1))
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::Duration;

    use axum::http::{HeaderValue, StatusCode};
    use serde_json::{Value, json};
    use wiremock::ResponseTemplate;

    use super::*;
    use crate::google::GoogleAuth;
    use crate::graphql::auth::testing::*;
    use crate::store::kv::MemoryStore;
    use crate::test_support::{TestApp, post_graphql, post_graphql_as};

    fn document(query: &str) -> ExecutableDocument {
        operation::parse_document(query).unwrap()
    }

    fn params(query: &str) -> GraphqlParams {
        GraphqlParams {
            query: query.to_owned(),
            operation_name: None,
            variables: Value::Null,
        }
    }

    fn plan(query: &str, authorization: Option<&str>) -> Option<CachePlan> {
        CachePlan::new(&document(query), &params(query), authorization, None)
    }

    #[test]
    fn stringifies_with_sorted_keys() {
        assert_eq!(
            stable_stringify(&json!({ "b": [1, { "d": null, "c": "x" }], "a": true })),
            r#"{"a":true,"b":[1,{"c":"x","d":null}]}"#
        );
    }

    #[test]
    fn keys_like_the_envelop_plugin() {
        // sha256("query A { core }|A|{\"a\":1,\"b\":2}|Bearer x")
        let key = cache_key(
            "query A { core }",
            Some("A"),
            &json!({ "b": 2, "a": 1 }),
            Some("Bearer x"),
        );
        let expected = hex::encode(Sha256::digest(
            "query A { core }|A|{\"a\":1,\"b\":2}|Bearer x",
        ));
        assert_eq!(key, expected);
        assert_eq!(
            cache_key("query A { core }", None, &Value::Null, None),
            hex::encode(Sha256::digest("query A { core }||{}|"))
        );
    }

    #[test]
    fn shares_public_queries_and_scopes_others_to_the_caller() {
        let shared = plan(
            "query Home { __typename core { a } ...F } fragment F on Query { sermons { id } }",
            Some("Bearer a"),
        )
        .unwrap();
        assert_eq!(shared.session, None);

        let scoped = plan("query Me { user { id } core { a } }", Some("Bearer a")).unwrap();
        assert_eq!(scoped.session.as_deref(), Some("Bearer a"));
        // Only `__typename`: no shareable root field.
        let typename = plan("query X { __typename }", Some("Bearer a")).unwrap();
        assert_eq!(typename.session.as_deref(), Some("Bearer a"));
        // The session is part of the key.
        let other = plan("query X { __typename }", Some("Bearer b")).unwrap();
        assert_ne!(typename.key, other.key);
        assert_eq!(plan("query X { __typename }", None).unwrap().session, None);
    }

    #[test]
    fn caches_queries_only() {
        assert!(plan("mutation M { setVerseOfTheDay }", None).is_none());
        assert!(plan("query A { core } query B { sermons }", None).is_none());
    }

    #[test]
    fn takes_the_minimum_ttl_over_the_document() {
        let ttl = |query: &str| document_ttl(&document(query));
        assert_eq!(ttl("query A { core }"), Duration::from_secs(600));
        assert_eq!(ttl("query A { core home }"), Duration::from_secs(15));
        assert_eq!(
            ttl("query A { verseOfTheDayV2 { a } }"),
            Duration::from_secs(7200)
        );
        assert_eq!(ttl("query A { core user { id } }"), Duration::ZERO);
        assert_eq!(ttl("query A { liveStreamStatus { a } }"), Duration::ZERO);
        assert_eq!(
            ttl("query A { __schema { types { name } } }"),
            Duration::ZERO
        );
        // Fields without a TTL do not lower it; with none at all the default applies.
        assert_eq!(
            ttl("query A { core somethingElse }"),
            Duration::from_secs(600)
        );
        assert_eq!(ttl("query A { __typename }"), DEFAULT_TTL);
        // Fragment definitions and other operations count, as in the plugin's document walk.
        assert_eq!(
            ttl("query A { core ...F } fragment F on Query { home }"),
            Duration::from_secs(15)
        );
        assert_eq!(
            ttl("query A { core ... on Query { castrStream(campusSlug: \"x\") { a } } }"),
            Duration::ZERO
        );
        assert_eq!(ttl("query A { core } query B { profile }"), Duration::ZERO);
    }

    #[test]
    fn caches_campuses_for_ten_minutes_under_one_shared_key() {
        let query = "query A { campuses { pageBody } }";
        assert_eq!(document_ttl(&document(query)), Duration::from_secs(600));
        assert_eq!(plan(query, Some("Bearer a")).unwrap().session, None);
    }

    #[test]
    fn never_stores_live_stream_status_and_keys_it_per_caller() {
        let query = "query A { liveStreamStatus { __typename } }";
        assert_eq!(document_ttl(&document(query)), Duration::ZERO);
        assert_eq!(
            plan(query, Some("Bearer a")).unwrap().session.as_deref(),
            Some("Bearer a")
        );
    }

    #[test]
    fn skips_private_fields_without_a_session() {
        let query = "query Me { user { id } }";
        let anonymous = plan(query, None).unwrap();
        assert!(!anonymous.allows(&json!({ "user": { "id": "1" } })));
        let signed_in = plan(query, Some("Bearer a")).unwrap();
        assert!(signed_in.allows(&json!({ "user": { "id": "1" } })));
        // The check reads response keys, so an alias escapes it, as in TS.
        assert!(anonymous.allows(&json!({ "me": { "id": "1" } })));
    }

    #[test]
    fn caps_the_memory_ttl() {
        assert_eq!(memory_ttl(Duration::from_secs(600)), MEMORY_TTL_CAP);
        assert_eq!(memory_ttl(Duration::from_secs(15)), Duration::from_secs(15));
    }

    fn redis_key(key: &str) -> String {
        format!("rs:graphql:response-cache:result:v2:{key}")
    }

    async fn wait_for_redis(store: &MemoryStore, key: &str) -> Value {
        for _ in 0..100 {
            if let Some(raw) = store.raw(&redis_key(key)) {
                return serde_json::from_str(&raw).unwrap();
            }
            tokio::task::yield_now().await;
        }
        panic!("{key} was never written to Redis");
    }

    #[tokio::test]
    async fn stores_in_memory_and_redis() {
        let store = Arc::new(MemoryStore::new("rs:"));
        let cache = Arc::new(ResponseCache::new(store.clone()));
        cache
            .store(
                "k1",
                json!({ "core": { "a": 1 } }),
                "Tue, 13 Oct 2026 18:25:00 GMT",
                Duration::from_secs(600),
            )
            .await;
        let payload = wait_for_redis(&store, "k1").await;
        assert_eq!(
            payload["data"],
            json!({
                "data": { "core": { "a": 1 } },
                "extensions": { "http": { "headers": {
                    "ETag": "k1",
                    "Last-Modified": "Tue, 13 Oct 2026 18:25:00 GMT",
                } } },
            })
        );
        let expires_at = payload["expiresAt"].as_u64().unwrap();
        assert!(expires_at > now_ms() + 590_000 && expires_at <= now_ms() + 600_000);
        assert_eq!(store.ttl(&redis_key("k1")).await.unwrap(), 600);

        let hit = cache.get("k1").await.unwrap();
        assert_eq!(hit.etag(), Some("k1"));
        assert_eq!(hit.body(), br#"{"data":{"core":{"a":1}}}"#);
    }

    #[tokio::test]
    async fn hits_keep_the_result_field_order_while_the_key_sorts_variables() {
        // serde_json keeps insertion order (`preserve_order`), as JSON.stringify does: memory and
        // Redis hits answer in the executed result's field order, not sorted, while the cache key
        // still sorts variable keys like `stableStringify`.
        let data: Value = serde_json::from_str(r#"{"sermons":[],"core":{"b":1,"a":2}}"#).unwrap();
        let store = Arc::new(MemoryStore::new("rs:"));
        let writer = Arc::new(ResponseCache::new(store.clone()));
        writer
            .store(
                "k7",
                data,
                "Tue, 13 Oct 2026 18:25:00 GMT",
                Duration::from_secs(60),
            )
            .await;
        let expected = br#"{"data":{"sermons":[],"core":{"b":1,"a":2}}}"#;
        assert_eq!(writer.get("k7").await.unwrap().body(), expected);
        wait_for_redis(&store, "k7").await;
        assert!(
            store
                .raw(&redis_key("k7"))
                .unwrap()
                .starts_with(r#"{"data":{"data":{"sermons":[],"core":{"b":1,"a":2}}"#)
        );
        let reader = ResponseCache::new(store);
        assert_eq!(reader.get("k7").await.unwrap().body(), expected);

        let unsorted: Value = serde_json::from_str(r#"{"b":2,"a":{"d":1,"c":2}}"#).unwrap();
        let sorted: Value = serde_json::from_str(r#"{"a":{"c":2,"d":1},"b":2}"#).unwrap();
        assert_eq!(
            cache_key("query A { core }", Some("A"), &unsorted, None),
            cache_key("query A { core }", Some("A"), &sorted, None)
        );
    }

    #[tokio::test]
    async fn memory_hits_share_the_stored_result() {
        let store = Arc::new(MemoryStore::new("rs:"));
        let cache = Arc::new(ResponseCache::new(store));
        cache
            .store(
                "k6",
                json!({ "core": { "title": "Ada Example" } }),
                "Tue, 13 Oct 2026 18:25:00 GMT",
                Duration::from_secs(60),
            )
            .await;
        let first = cache.get("k6").await.unwrap();
        let second = cache.get("k6").await.unwrap();
        // Hits hand out the stored value itself and serialize it in place; nothing is copied.
        assert!(Arc::ptr_eq(&first.data, &second.data));
        assert_eq!(
            second.body(),
            br#"{"data":{"core":{"title":"Ada Example"}}}"#
        );
    }

    #[tokio::test]
    async fn reads_redis_when_memory_misses() {
        let store = Arc::new(MemoryStore::new("rs:"));
        let writer = Arc::new(ResponseCache::new(store.clone()));
        writer
            .store(
                "k2",
                json!({ "core": null }),
                "Tue, 13 Oct 2026 18:25:00 GMT",
                Duration::from_secs(60),
            )
            .await;
        wait_for_redis(&store, "k2").await;
        let reader = ResponseCache::new(store.clone());
        let hit = reader.get("k2").await.unwrap();
        assert_eq!(hit.last_modified(), Some("Tue, 13 Oct 2026 18:25:00 GMT"));
        // Now in memory: Redis is not asked again.
        let commands = store.commands();
        reader.get("k2").await.unwrap();
        assert_eq!(store.commands(), commands);
    }

    #[tokio::test]
    async fn drops_expired_redis_entries() {
        let store = Arc::new(MemoryStore::new("rs:"));
        store.insert_raw(
            &redis_key("k3"),
            &json!({ "data": { "data": { "core": null } }, "expiresAt": now_ms() - 1 }).to_string(),
        );
        let cache = ResponseCache::new(store.clone());
        assert!(cache.get("k3").await.is_none());
        assert!(store.raw(&redis_key("k3")).is_none());
    }

    #[tokio::test]
    async fn treats_redis_failures_and_garbage_as_misses() {
        let store = Arc::new(MemoryStore::new("rs:"));
        store.insert_raw(&redis_key("k4"), "not json");
        let cache = Arc::new(ResponseCache::new(store.clone()));
        assert!(cache.get("k4").await.is_none());

        store.set_failing(true);
        assert!(cache.get("k5").await.is_none());
        // A failed Redis write still fills memory.
        cache
            .store(
                "k5",
                json!({ "core": null }),
                "Tue, 13 Oct 2026 18:25:00 GMT",
                Duration::from_secs(60),
            )
            .await;
        assert!(cache.get("k5").await.is_some());
    }

    const FORMS_QUERY: &str = "query CCBFormsV2Query { ccbFormsV2 { __typename } }";

    #[tokio::test]
    async fn serves_shared_hits_before_authentication() {
        let mock = GoogleMock::start().await;
        // Any token check would fail with 503; the hit must not get that far.
        mock.mount_jwks(0).await;
        mock.mount_lookup(ResponseTemplate::new(500), 0).await;
        let app = TestApp::with_google(&mock, Some(GoogleAuth::fixed(ACCESS_TOKEN)));

        let first = app
            .send(post_graphql(json!({ "query": FORMS_QUERY })))
            .await;
        assert_eq!(first.status, StatusCode::OK);
        let etag = first.headers["etag"].clone();
        assert_eq!(etag.len(), 64);
        assert!(first.headers.contains_key("last-modified"));

        let second = app
            .send(post_graphql_as(
                json!({ "query": FORMS_QUERY }),
                &sign(&anonymous_claims()),
            ))
            .await;
        assert_eq!(second.status, StatusCode::OK);
        assert_eq!(second.body, first.body);
        assert_eq!(second.headers["etag"], etag);
        assert_eq!(
            second.headers["last-modified"],
            first.headers["last-modified"]
        );
    }

    #[tokio::test]
    async fn keeps_per_caller_entries_apart() {
        let app = TestApp::new();
        let send = |authorization: &'static str| {
            let mut request = post_graphql(json!({ "query": "query X { __typename }" }));
            request
                .headers_mut()
                .insert("authorization", HeaderValue::from_static(authorization));
            app.send(request)
        };
        let ada = send("Bearer opaque-ada").await;
        let grace = send("Bearer opaque-grace").await;
        assert_ne!(ada.headers["etag"], grace.headers["etag"]);
        // Grace's request missed (her key differs) and was stored separately.
        let again = send("Bearer opaque-ada").await;
        assert_eq!(again.headers["etag"], ada.headers["etag"]);
        assert_eq!(again.headers["last-modified"], ada.headers["last-modified"]);
        // Redis writes run in the background.
        for _ in 0..50 {
            tokio::task::yield_now().await;
        }
        let entries = app
            .store
            .keys()
            .into_iter()
            .filter(|key| key.starts_with("rs:graphql:response-cache:"))
            .count();
        assert_eq!(entries, 2);
    }

    #[tokio::test]
    async fn does_not_cache_results_with_errors() {
        let app = TestApp::new();
        let query = json!({ "query": "query X($unused: Int) { __typename }" });
        let response = app.send(post_graphql(query.clone())).await;
        assert!(response.json()["errors"].is_array());
        assert!(!response.headers.contains_key("etag"));
        for _ in 0..10 {
            tokio::task::yield_now().await;
        }
        assert!(
            app.store
                .keys()
                .iter()
                .all(|key| !key.starts_with("rs:graphql:response-cache:"))
        );
    }

    #[tokio::test]
    async fn answers_if_none_match_with_the_full_response_like_ts() {
        let app = TestApp::new();
        let first = app
            .send(post_graphql(json!({ "query": FORMS_QUERY })))
            .await;
        let mut request = post_graphql(json!({ "query": FORMS_QUERY }));
        request
            .headers_mut()
            .insert("if-none-match", first.headers["etag"].clone());
        let second = app.send(request).await;
        assert_eq!(second.status, StatusCode::OK);
        assert_eq!(second.body, first.body);
    }

    #[tokio::test]
    async fn serves_from_memory_when_redis_is_down() {
        let app = TestApp::new();
        app.store.set_failing(true);
        let first = app
            .send(post_graphql(json!({ "query": FORMS_QUERY })))
            .await;
        let second = app
            .send(post_graphql(json!({ "query": FORMS_QUERY })))
            .await;
        assert_eq!(
            (first.status, second.status),
            (StatusCode::OK, StatusCode::OK)
        );
        assert_eq!(
            second.headers["last-modified"],
            first.headers["last-modified"]
        );
    }

    #[tokio::test]
    async fn serves_entries_written_by_another_replica() {
        let store = Arc::new(MemoryStore::new("rs:"));
        let writer = TestApp::with_store(store.clone());
        let first = writer
            .send(post_graphql(json!({ "query": FORMS_QUERY })))
            .await;
        let etag = first.headers["etag"].to_str().unwrap().to_owned();
        wait_for_redis(&store, &etag).await;

        let reader = TestApp::with_store(store);
        let second = reader
            .send(post_graphql(json!({ "query": FORMS_QUERY })))
            .await;
        assert_eq!(second.headers["etag"], first.headers["etag"]);
        assert_eq!(
            second.headers["last-modified"],
            first.headers["last-modified"]
        );
        assert_eq!(second.body, first.body);
    }
}
