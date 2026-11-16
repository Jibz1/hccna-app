//! `ccbFormsV2` (`apps/server/src/graphql/schema/cms/core.ts`) and its loader
//! (`apps/server/src/graphql/loaders/ccbFormsDataLoader.ts`, `utils/redisCache.ts`): an
//! in-process entry (15 min, refreshed on read, served once more when stale), then Redis
//! (`{value, expiresAt}`, kept 20 min and served even when stale), then the public CCB forms list.
//! Any failure yields an empty list, so the field always resolves to `CCBFormsSuccess`.

use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use async_graphql::{Context, Object, SimpleObject, Union};
use serde::de::IgnoredAny;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Number, json};
use tokio::time::Instant;

use crate::fields::RequestLoaders;
use crate::graphql::response_cache::now_ms;
use crate::metrics::Metrics;
use crate::store::kv::KeyValueStore;
use crate::text::capitalize_text;
use crate::upstream;

/// `CCB_FORMS_URL` in `ccbFormsDataLoader.ts`.
pub const DEFAULT_CCB_FORMS_URL: &str = "https://hccnj.ccbchurch.com/api/forms?publicly_listed=true&status=ACTIVE&name=&sort_by=DATE_CREATED&sort_direction=DESC&page=1";

pub const TTL: Duration = Duration::from_secs(15 * 60);
/// How long Redis keeps an entry past its TTL.
pub const STALE: Duration = Duration::from_secs(5 * 60);
/// `serviceRequest`'s default timeout.
pub const FETCH_TIMEOUT: Duration = Duration::from_secs(5);

const CACHE_KEY: &str = "ccbForms";

/// A form as cached (`CCBFormData`); the title is already capitalized.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CcbFormData {
    pub id: Number,
    pub title: String,
    pub url: String,
    pub campus_id: Number,
    pub status: String,
}

/// One entry of the CCB response, decoded as strictly as `CCBFormsSchema` (extra keys ignored).
#[derive(Deserialize)]
struct CcbFormRecord {
    id: Number,
    title: String,
    #[serde(rename = "description")]
    _description: String,
    url: String,
    campus_id: Number,
    #[serde(rename = "start", deserialize_with = "required_nullable")]
    _start: Option<String>,
    #[serde(rename = "end", deserialize_with = "required_nullable")]
    _end: Option<String>,
    #[serde(rename = "public")]
    _public: bool,
    status: String,
    #[serde(rename = "created")]
    _created: String,
    #[serde(rename = "actions")]
    _actions: FormActions,
}

#[derive(Deserialize)]
struct FormActions {
    #[serde(rename = "can_edit_form")]
    _can_edit_form: FormAction,
    #[serde(rename = "can_respond_to_form")]
    _can_respond_to_form: FormAction,
    #[serde(rename = "can_view_form")]
    _can_view_form: FormAction,
}

#[derive(Deserialize)]
struct FormAction {
    #[serde(rename = "allowed")]
    _allowed: bool,
    #[serde(rename = "reasons")]
    _reasons: Vec<IgnoredAny>,
}

/// `S.NullOr(S.String)`: the key must be present, the value may be null.
fn required_nullable<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    Option::deserialize(deserializer)
}

/// The Redis value written by `createRedisCache`.
#[derive(Serialize, Deserialize)]
struct RedisEntry {
    value: Option<Vec<CcbFormData>>,
    #[serde(rename = "expiresAt")]
    expires_at: u64,
}

struct MemoryEntry {
    forms: Arc<Vec<CcbFormData>>,
    fresh_until: Instant,
}

pub struct CcbFormsLoader {
    url: String,
    http: reqwest::Client,
    metrics: Metrics,
    store: Arc<dyn KeyValueStore>,
    ttl: Duration,
    memory: Mutex<Option<MemoryEntry>>,
}

impl CcbFormsLoader {
    pub fn new(
        url: String,
        http: reqwest::Client,
        metrics: Metrics,
        store: Arc<dyn KeyValueStore>,
    ) -> Self {
        Self {
            url,
            http,
            metrics,
            store,
            ttl: TTL,
            memory: Mutex::new(None),
        }
    }

    /// A shorter in-process TTL, for tests.
    pub fn with_ttl(mut self, ttl: Duration) -> Self {
        self.ttl = ttl;
        self
    }

    fn redis_key(&self) -> String {
        self.store
            .key(&format!("ccb-forms-dataloader:2:{CACHE_KEY}"))
    }

    /// The forms, from the first tier that has them; never fails.
    pub async fn load(&self) -> Arc<Vec<CcbFormData>> {
        if let Some(forms) = self.memory_get() {
            return forms;
        }
        if let Some(forms) = self.redis_get().await {
            self.memory_set(forms.clone());
            return forms;
        }
        match self.fetch().await {
            Ok(forms) => {
                let forms = Arc::new(forms);
                self.redis_set(&forms).await;
                self.memory_set(forms.clone());
                forms
            }
            Err(FetchError::Decode(error)) => {
                tracing::error!(cache_key = CACHE_KEY, cause = %error, "CCB Forms DataLoader response parsing failed");
                Arc::new(Vec::new())
            }
            Err(error) => {
                tracing::error!(cache_key = CACHE_KEY, error = %error, "CCB Forms DataLoader fetch failed");
                Arc::new(Vec::new())
            }
        }
    }

    /// lru-cache with `ttl`, `allowStale` and `updateAgeOnGet`: a fresh read restarts the TTL; a
    /// stale entry is returned once and dropped.
    fn memory_get(&self) -> Option<Arc<Vec<CcbFormData>>> {
        let mut memory = self.memory.lock().unwrap_or_else(PoisonError::into_inner);
        let entry = memory.as_mut()?;
        let now = Instant::now();
        if entry.fresh_until > now {
            entry.fresh_until = now + self.ttl;
            return Some(entry.forms.clone());
        }
        memory.take().map(|entry| entry.forms)
    }

    fn memory_set(&self, forms: Arc<Vec<CcbFormData>>) {
        *self.memory.lock().unwrap_or_else(PoisonError::into_inner) = Some(MemoryEntry {
            forms,
            fresh_until: Instant::now() + self.ttl,
        });
    }

    /// `redisCache.get`: any stored value, stale or not. Errors are misses.
    async fn redis_get(&self) -> Option<Arc<Vec<CcbFormData>>> {
        let raw = match self.store.get(&self.redis_key()).await {
            Ok(raw) => raw?,
            Err(error) => {
                tracing::warn!(prefix = "ccb-forms-dataloader", error = %error, "Redis cache getMultiple failed");
                return None;
            }
        };
        match serde_json::from_str::<RedisEntry>(&raw) {
            Ok(entry) => entry.value.map(Arc::new),
            Err(error) => {
                tracing::warn!(prefix = "ccb-forms-dataloader", error = %error, "Redis cache getMultiple failed");
                None
            }
        }
    }

    /// `redisCache.set`: `{value, expiresAt}` for TTL + stale seconds. Errors are logged only.
    async fn redis_set(&self, forms: &[CcbFormData]) {
        let ttl_ms = u64::try_from(TTL.as_millis()).unwrap_or(u64::MAX);
        let entry = json!({ "value": forms, "expiresAt": now_ms().saturating_add(ttl_ms) });
        let seconds = (TTL + STALE).as_secs().max(1);
        if let Err(error) = self
            .store
            .set_ex(&self.redis_key(), seconds, &entry.to_string())
            .await
        {
            tracing::warn!(prefix = "ccb-forms-dataloader", error = %error, "Redis cache setMultiple failed");
        }
    }

    /// The CCB request (5 s), measured like `serviceRequest` up to the response headers, then
    /// decoded with the TS schema's strictness. Titles are capitalized.
    async fn fetch(&self) -> Result<Vec<CcbFormData>, FetchError> {
        let response = upstream::observe(&self.metrics, "ccb", "get_ccb_forms", async {
            self.http.get(&self.url).timeout(FETCH_TIMEOUT).send().await
        })
        .await?;
        let body = response.bytes().await?;
        // `response.json()` failing is a fetch failure in TS; a schema mismatch is a decode one.
        let records: Vec<CcbFormRecord> =
            serde_json::from_slice(&body).map_err(|error| match error.classify() {
                serde_json::error::Category::Data => FetchError::Decode(error),
                _ => FetchError::Json(error),
            })?;
        Ok(records
            .into_iter()
            .map(|record| CcbFormData {
                id: record.id,
                title: capitalize_text(&record.title),
                url: record.url,
                campus_id: record.campus_id,
                status: record.status,
            })
            .collect())
    }
}

#[derive(Debug, thiserror::Error)]
enum FetchError {
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error("the CCB response is not JSON: {0}")]
    Json(serde_json::Error),
    #[error("the CCB response does not match the forms schema: {0}")]
    Decode(serde_json::Error),
}

#[derive(Clone, Debug, PartialEq, Eq, SimpleObject)]
#[graphql(name = "CCBForm")]
pub struct CcbForm {
    #[graphql(name = "campus_id")]
    pub campus_id: Option<i32>,
    pub id: Option<i32>,
    pub status: Option<String>,
    pub title: Option<String>,
    pub url: Option<String>,
}

impl From<&CcbFormData> for CcbForm {
    /// GraphQL `Int` is 32-bit; a number outside it (or not an integer) becomes `null`.
    fn from(form: &CcbFormData) -> Self {
        let int = |number: &Number| number.as_i64().and_then(|n| i32::try_from(n).ok());
        Self {
            campus_id: int(&form.campus_id),
            id: int(&form.id),
            status: Some(form.status.clone()),
            title: Some(form.title.clone()),
            url: Some(form.url.clone()),
        }
    }
}

#[derive(Clone, Debug, SimpleObject)]
#[graphql(name = "CCBFormsSuccess")]
pub struct CcbFormsSuccess {
    /// Active publicly listed CCB forms
    pub forms: Option<Vec<CcbForm>>,
}

#[derive(Clone, Debug, SimpleObject)]
#[graphql(name = "CCBFormsFetchError")]
pub struct CcbFormsFetchError {
    /// Error message describing what went wrong
    pub message: Option<String>,
}

#[derive(Clone, Debug, SimpleObject)]
#[graphql(name = "CCBFormsNotFoundError")]
pub struct CcbFormsNotFoundError {
    /// Error message when CCB forms cannot be found
    pub message: Option<String>,
}

#[derive(Clone, Debug, Union)]
#[graphql(name = "CCBFormsResult")]
pub enum CcbFormsResult {
    FetchError(CcbFormsFetchError),
    NotFoundError(CcbFormsNotFoundError),
    Success(CcbFormsSuccess),
}

#[derive(Default)]
pub struct CcbFormsQuery;

#[Object]
impl CcbFormsQuery {
    /// Get CCB forms with typed success and error responses
    #[graphql(name = "ccbFormsV2")]
    async fn ccb_forms_v2(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Option<CcbFormsResult>> {
        let loader = ctx.data::<Arc<CcbFormsLoader>>()?;
        // Like the TS DataLoader, a request loads the forms once however often it selects them.
        let forms = match ctx.data_opt::<RequestLoaders>() {
            Some(loaders) => loaders
                .ccb_forms
                .get_or_init(|| loader.load())
                .await
                .clone(),
            None => loader.load().await,
        };
        Ok(Some(CcbFormsResult::Success(CcbFormsSuccess {
            forms: Some(forms.iter().map(CcbForm::from).collect()),
        })))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::Duration;

    use serde_json::{Value, json};
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::store::kv::MemoryStore;
    use crate::test_support::{TestApp, post_graphql};

    const REDIS_KEY: &str = "rs:ccb-forms-dataloader:2:ccbForms";

    fn form(id: i64, title: &str) -> Value {
        json!({
            "id": id,
            "title": title,
            "description": "An example form",
            "url": format!("https://example.com/forms/{id}"),
            "campus_id": 1,
            "start": null,
            "end": "2026-12-31",
            "public": true,
            "status": "ACTIVE",
            "created": "2026-01-01 10:00:00",
            "actions": {
                "can_edit_form": { "allowed": false, "reasons": [] },
                "can_respond_to_form": { "allowed": true, "reasons": [] },
                "can_view_form": { "allowed": true, "reasons": ["EXAMPLE"] },
            },
            "owner": { "name": "Ada Example" },
        })
    }

    async fn ccb(response: ResponseTemplate, expected_calls: u64) -> MockServer {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/forms"))
            .and(query_param("publicly_listed", "true"))
            .and(query_param("status", "ACTIVE"))
            .respond_with(response)
            .expect(expected_calls)
            .mount(&server)
            .await;
        server
    }

    fn url(server: &MockServer) -> String {
        format!(
            "{}/api/forms?publicly_listed=true&status=ACTIVE&name=&sort_by=DATE_CREATED&sort_direction=DESC&page=1",
            server.uri()
        )
    }

    fn loader(server: &MockServer, store: Arc<MemoryStore>) -> CcbFormsLoader {
        CcbFormsLoader::new(
            url(server),
            upstream::http_client().unwrap(),
            Metrics::new(),
            store,
        )
    }

    fn data(id: i64, title: &str) -> CcbFormData {
        CcbFormData {
            id: id.into(),
            title: title.to_owned(),
            url: format!("https://example.com/forms/{id}"),
            campus_id: 1.into(),
            status: "ACTIVE".to_owned(),
        }
    }

    #[tokio::test]
    async fn maps_forms_and_capitalizes_titles() {
        let server = ccb(
            ResponseTemplate::new(200).set_body_json(json!([
                form(101, "youth GROUP signup"),
                form(102, "VOLUNTEER form")
            ])),
            1,
        )
        .await;
        let store = Arc::new(MemoryStore::new("rs:"));
        let forms = loader(&server, store.clone()).load().await;
        assert_eq!(
            *forms,
            vec![data(101, "Youth Group Signup"), data(102, "Volunteer Form")]
        );

        let cached: Value = serde_json::from_str(&store.raw(REDIS_KEY).unwrap()).unwrap();
        assert_eq!(cached["value"], serde_json::to_value(&*forms).unwrap());
        let expires_at = cached["expiresAt"].as_u64().unwrap();
        assert!(expires_at > now_ms() + 890_000 && expires_at <= now_ms() + 900_000);
        assert_eq!(store.ttl(REDIS_KEY).await.unwrap(), 1200);
    }

    #[tokio::test]
    async fn returns_no_forms_when_ccb_fails() {
        for response in [
            ResponseTemplate::new(500).set_body_string("<html>Server Error</html>"),
            // Valid JSON that does not match the schema: a missing `start` key.
            ResponseTemplate::new(200).set_body_json(json!([{
                "id": 1, "title": "x", "description": "", "url": "https://example.com", "campus_id": 1,
                "end": null, "public": true, "status": "ACTIVE", "created": "",
                "actions": {
                    "can_edit_form": { "allowed": false, "reasons": [] },
                    "can_respond_to_form": { "allowed": false, "reasons": [] },
                    "can_view_form": { "allowed": false, "reasons": [] },
                },
            }])),
            ResponseTemplate::new(200).set_body_json(json!({ "forms": [] })),
        ] {
            let server = ccb(response, 1).await;
            let store = Arc::new(MemoryStore::new("rs:"));
            assert!(loader(&server, store.clone()).load().await.is_empty());
            // Failures are not cached.
            assert!(store.raw(REDIS_KEY).is_none());
        }
    }

    #[tokio::test]
    async fn returns_no_forms_when_ccb_is_unreachable() {
        let loader = CcbFormsLoader::new(
            "http://127.0.0.1:1/api/forms".to_owned(),
            upstream::http_client().unwrap(),
            Metrics::new(),
            Arc::new(MemoryStore::new("rs:")),
        );
        assert!(loader.load().await.is_empty());
        let metrics = loader.metrics.render();
        assert!(metrics.contains(r#"service_error_total{action="get_ccb_forms",service="ccb"} 1"#));
    }

    #[tokio::test]
    async fn serves_repeat_loads_from_memory() {
        let server = ccb(
            ResponseTemplate::new(200).set_body_json(json!([form(101, "youth group")])),
            1,
        )
        .await;
        let store = Arc::new(MemoryStore::new("rs:"));
        let loader = loader(&server, store.clone());
        loader.load().await;
        let commands = store.commands();
        assert_eq!(loader.load().await.len(), 1);
        assert_eq!(store.commands(), commands);
    }

    #[tokio::test]
    async fn serves_redis_entries_even_when_stale() {
        let server = ccb(ResponseTemplate::new(500), 0).await;
        let store = Arc::new(MemoryStore::new("rs:"));
        store.insert_raw(
            REDIS_KEY,
            &json!({ "value": [data(7, "Cached Form")], "expiresAt": now_ms() - 1 }).to_string(),
        );
        assert_eq!(
            *loader(&server, store).load().await,
            vec![data(7, "Cached Form")]
        );
    }

    #[tokio::test]
    async fn serves_a_stale_memory_entry_once() {
        let server = ccb(
            ResponseTemplate::new(200).set_body_json(json!([form(101, "youth group")])),
            1,
        )
        .await;
        let store = Arc::new(MemoryStore::new("rs:"));
        let loader = loader(&server, store.clone()).with_ttl(Duration::from_millis(50));
        loader.load().await;
        tokio::time::sleep(Duration::from_millis(80)).await;
        // Stale: served without a Redis read, then dropped.
        let commands = store.commands();
        assert_eq!(loader.load().await.len(), 1);
        assert_eq!(store.commands(), commands);
        // Next load reads Redis (still holding the entry) instead of CCB.
        assert_eq!(loader.load().await.len(), 1);
        assert_eq!(store.commands(), commands + 1);
    }

    #[tokio::test]
    async fn loads_from_ccb_when_redis_is_down() {
        let server = ccb(
            ResponseTemplate::new(200).set_body_json(json!([form(101, "youth group")])),
            1,
        )
        .await;
        let store = Arc::new(MemoryStore::new("rs:"));
        store.set_failing(true);
        let loader = loader(&server, store);
        assert_eq!(loader.load().await.len(), 1);
        assert_eq!(loader.load().await.len(), 1);
    }

    #[tokio::test]
    async fn resolves_ccb_forms_v2() {
        let server = ccb(
            ResponseTemplate::new(200).set_body_json(json!([form(101, "youth GROUP signup")])),
            1,
        )
        .await;
        let ccb_url = url(&server);
        let app = TestApp::with_env(&[("CCB_FORMS_URL", ccb_url.as_str())]);
        let query = "query CCBFormsV2Query { ccbFormsV2 { __typename ... on CCBFormsSuccess { forms { id title url campus_id status } } } again: ccbFormsV2 { __typename } }";
        let response = app.send(post_graphql(json!({ "query": query }))).await;
        assert_eq!(
            response.json(),
            json!({ "data": {
                "ccbFormsV2": {
                    "__typename": "CCBFormsSuccess",
                    "forms": [{
                        "id": 101,
                        "title": "Youth Group Signup",
                        "url": "https://example.com/forms/101",
                        "campus_id": 1,
                        "status": "ACTIVE",
                    }],
                },
                "again": { "__typename": "CCBFormsSuccess" },
            } })
        );
    }

    #[test]
    fn writes_null_for_ids_outside_graphql_int() {
        let form = CcbFormData {
            id: Number::from(1_i64 << 40),
            ..data(1, "Example")
        };
        assert_eq!(CcbForm::from(&form).id, None);
    }
}
