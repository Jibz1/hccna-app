//! `core` (`apps/server/src/graphql/schema/cms/core.ts`): the app's section images and copy.
//!
//! Read path (`CMSService.getCoreSettings` in `apps/server/src/effect/services/CMSService.ts`,
//! with `cms/cache.ts`, `cms/repositories.ts`, `cms/transforms.ts` and `cms/constants.ts`): the
//! in-process entry (`cms:coreSettings`, 10 min), then Redis `cms:coreSettings:v1`
//! (`{data, cachedAt}`, 600 s), then `SELECT … FROM core_settings LIMIT 1` mapped by
//! `transformDbCoreSettings`; a database read fills both caches. Cache errors are misses or
//! skipped writes. A failed query or a missing row is not caught by the resolver, so the client
//! sees the masked `Unexpected error.` with `core: null`. The read never writes to Postgres (the
//! TS upsert runs only on CMS change notices).
//!
//! `more.links` is sorted by group, then title, only when the Statsig gate
//! `graphql_core_sort_more_links` passes for the caller; the gate is checked each time the field
//! resolves, as the TS field resolver does.

use std::cmp::Ordering;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use async_graphql::{Context, Object, SimpleObject};
use serde::{Deserialize, Serialize};
use sqlx::postgres::PgRow;
use sqlx::{PgPool, Row};
use tokio::time::Instant;

use crate::graphql::auth::Viewer;
use crate::graphql::guards::Authorized;
use crate::graphql::response_cache::now_ms;
use crate::statsig::{FeatureGates, GateUser};
use crate::store::kv::KeyValueStore;

/// `STATSIG_CORE_SORT_MORE_LINKS_GATE`.
pub const SORT_MORE_LINKS_GATE: &str = "graphql_core_sort_more_links";
/// `CORE_REDIS_CACHE_KEY`, under this server's prefix.
pub const REDIS_KEY: &str = "cms:coreSettings:v1";
/// `LRU_TTL_MS`.
pub const MEMORY_TTL: Duration = Duration::from_secs(10 * 60);
/// `REDIS_TTL_SECONDS`.
pub const REDIS_TTL_SECONDS: u64 = 10 * 60;
/// `FALLBACK_IMAGE`.
pub const FALLBACK_IMAGE: &str =
    "https://storage.googleapis.com/app-hccnj/Image/events_f7b00973f5/events_f7b00973f5.jpg";

/// drizzle's `db.select().from(coreSettings).limit(1)`, every column in table order.
const SELECT_CORE_SETTINGS: &str = r#"select "id", "giving_feature_image", "giving_copy", "profile_feature_image", "profile_copy", "sermons_feature_image", "sermons_copy", "hcc_expression_feature_image", "hcc_expression_copy", "events_feature_image", "events_copy", "more_feature_image", "more_copy", "created_at", "updated_at" from "core_settings" limit $1"#;

/// One `MORE_LINKS` entry.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoreLink {
    pub title: String,
    pub sub_title: String,
    pub icon_name: String,
    pub link: String,
    pub group: String,
}

/// `MORE_LINKS`, in their CMS-independent order.
pub fn more_links() -> Vec<MoreLink> {
    [
        (
            "I'm new here",
            "Get to know HCC NJ",
            "signature",
            "https://hccnj.ccbchurch.com/goto/forms/88/responses/new",
            "Get Connected",
        ),
        (
            "Serve",
            "Volunteer your skills at a department",
            "hand-holding-hand",
            "https://hccnj.ccbchurch.com/goto/forms/5/responses/new",
            "Get Connected",
        ),
        (
            "Join a small group",
            "Grow together spiritually",
            "people-group",
            "https://hccnj.ccbchurch.com/goto/forms/3/responses/new",
            "Get Connected",
        ),
        (
            "Share your testimony",
            "We'd love to celebrate with you",
            "people-arrows",
            "https://hccnj.ccbchurch.com/goto/forms/32/responses/new",
            "Other",
        ),
        (
            "Privacy Policy",
            "Read our privacy policy",
            "shield-halved",
            "https://hccnj.org/privacy-policy/",
            "Other",
        ),
    ]
    .into_iter()
    .map(|(title, sub_title, icon_name, link, group)| MoreLink {
        title: title.to_owned(),
        sub_title: sub_title.to_owned(),
        icon_name: icon_name.to_owned(),
        link: link.to_owned(),
        group: group.to_owned(),
    })
    .collect()
}

/// A section's image and copy (`Base`). `featureImge` is the schema's spelling.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Section {
    #[serde(rename = "featureImge")]
    pub feature_imge: String,
    pub copy: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MoreSection {
    #[serde(rename = "featureImge")]
    pub feature_imge: String,
    pub copy: String,
    pub links: Vec<MoreLink>,
}

/// `CoreData`, also the cached JSON's `data`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CoreData {
    pub giving: Section,
    pub profile: Section,
    pub sermons: Section,
    pub hccexpression: Section,
    pub events: Section,
    pub more: MoreSection,
}

/// The `core_settings` columns the transform reads (the query selects every column, as drizzle
/// does; the id and timestamps are not decoded).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CoreSettingsRow {
    pub giving_feature_image: Option<String>,
    pub giving_copy: Option<String>,
    pub profile_feature_image: Option<String>,
    pub profile_copy: Option<String>,
    pub sermons_feature_image: Option<String>,
    pub sermons_copy: Option<String>,
    pub hcc_expression_feature_image: Option<String>,
    pub hcc_expression_copy: Option<String>,
    pub events_feature_image: Option<String>,
    pub events_copy: Option<String>,
    pub more_feature_image: Option<String>,
    pub more_copy: Option<String>,
}

impl CoreSettingsRow {
    /// Reads the columns by name, as drizzle maps them.
    fn from_row(row: &PgRow) -> Result<Self, sqlx::Error> {
        Ok(Self {
            giving_feature_image: row.try_get("giving_feature_image")?,
            giving_copy: row.try_get("giving_copy")?,
            profile_feature_image: row.try_get("profile_feature_image")?,
            profile_copy: row.try_get("profile_copy")?,
            sermons_feature_image: row.try_get("sermons_feature_image")?,
            sermons_copy: row.try_get("sermons_copy")?,
            hcc_expression_feature_image: row.try_get("hcc_expression_feature_image")?,
            hcc_expression_copy: row.try_get("hcc_expression_copy")?,
            events_feature_image: row.try_get("events_feature_image")?,
            events_copy: row.try_get("events_copy")?,
            more_feature_image: row.try_get("more_feature_image")?,
            more_copy: row.try_get("more_copy")?,
        })
    }
}

/// `transformDbCoreSettings`: a null image is `FALLBACK_IMAGE`, a null copy the section's name
/// (`??`, so an empty string stays empty).
pub fn transform(row: CoreSettingsRow) -> CoreData {
    let section = |image: Option<String>, copy: Option<String>, name: &str| Section {
        feature_imge: image.unwrap_or_else(|| FALLBACK_IMAGE.to_owned()),
        copy: copy.unwrap_or_else(|| name.to_owned()),
    };
    CoreData {
        giving: section(row.giving_feature_image, row.giving_copy, "Giving"),
        profile: section(row.profile_feature_image, row.profile_copy, "Profile"),
        sermons: section(row.sermons_feature_image, row.sermons_copy, "Sermons"),
        hccexpression: section(
            row.hcc_expression_feature_image,
            row.hcc_expression_copy,
            "HCC Expression",
        ),
        events: section(row.events_feature_image, row.events_copy, "Events"),
        more: MoreSection {
            feature_imge: row
                .more_feature_image
                .unwrap_or_else(|| FALLBACK_IMAGE.to_owned()),
            copy: row.more_copy.unwrap_or_else(|| "More".to_owned()),
            links: more_links(),
        },
    }
}

/// `sortMoreLinks`: by group, then title, with `localeCompare`. The comparison is ICU's root
/// collation for the characters these titles use: letters compare case-insensitively first,
/// space and punctuation sort before letters and digits, and lowercase precedes uppercase only
/// when nothing else differs. That is exact for `MORE_LINKS`, the only links this field returns.
pub fn sort_more_links(links: &[MoreLink]) -> Vec<MoreLink> {
    let mut sorted = links.to_vec();
    sorted.sort_by(|left, right| {
        locale_compare(&left.group, &right.group)
            .then_with(|| locale_compare(&left.title, &right.title))
    });
    sorted
}

fn locale_compare(left: &str, right: &str) -> Ordering {
    let primary = |c: char| {
        let lower = c.to_lowercase().next().unwrap_or(c);
        // Space, then punctuation and symbols, then digits, then letters.
        let class = if c.is_whitespace() {
            0
        } else if c.is_alphabetic() {
            3
        } else if c.is_numeric() {
            2
        } else {
            1
        };
        (class, lower)
    };
    left.chars()
        .map(primary)
        .cmp(right.chars().map(primary))
        .then_with(|| {
            // Tertiary: lowercase before uppercase at the first case difference.
            left.chars()
                .map(char::is_uppercase)
                .cmp(right.chars().map(char::is_uppercase))
        })
}

#[derive(Debug, thiserror::Error)]
pub enum CoreSettingsError {
    /// `CMSFetchError`'s message.
    #[error("CMS fetch: Failed to fetch core settings from PostgreSQL")]
    Fetch(#[source] sqlx::Error),
    /// `CMSNotFoundError`'s message.
    #[error("CMS not found: core settings")]
    NotFound,
}

pub type RowFuture<'a> =
    Pin<Box<dyn Future<Output = Result<Option<CoreSettingsRow>, sqlx::Error>> + Send + 'a>>;

/// Where the core settings row comes from: Postgres, or a fake in tests.
pub trait CoreSettingsSource: Send + Sync {
    /// `fetchCoreSettingsRow` before its not-found check: the first row, if any.
    fn first_row(&self) -> RowFuture<'_>;
}

/// The `core_settings` table.
pub struct PgCoreSettings {
    pool: PgPool,
}

impl PgCoreSettings {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl CoreSettingsSource for PgCoreSettings {
    fn first_row(&self) -> RowFuture<'_> {
        Box::pin(async move {
            sqlx::query(SELECT_CORE_SETTINGS)
                .bind(1_i64)
                .fetch_optional(&self.pool)
                .await?
                .map(|row| CoreSettingsRow::from_row(&row))
                .transpose()
        })
    }
}

/// `CachedEntry<CoreData>`, in memory and in Redis.
#[derive(Serialize, Deserialize)]
struct CachedEntry {
    data: CoreData,
    #[serde(rename = "cachedAt")]
    cached_at: u64,
}

struct MemoryEntry {
    data: Arc<CoreData>,
    expires: Instant,
}

/// `CMSService.getCoreSettings` with its two cache tiers.
pub struct CoreSettings {
    source: Arc<dyn CoreSettingsSource>,
    store: Arc<dyn KeyValueStore>,
    memory: Mutex<Option<MemoryEntry>>,
}

impl CoreSettings {
    pub fn new(source: Arc<dyn CoreSettingsSource>, store: Arc<dyn KeyValueStore>) -> Self {
        Self {
            source,
            store,
            memory: Mutex::new(None),
        }
    }

    pub async fn get(&self) -> Result<Arc<CoreData>, CoreSettingsError> {
        if let Some(data) = self.memory_get() {
            tracing::debug!(operation = "getCoreSettings", "LRU cache hit");
            return Ok(data);
        }
        if let Some(data) = self.redis_get().await {
            tracing::debug!(operation = "getCoreSettings", "Redis cache hit");
            let data = Arc::new(data);
            self.memory_set(data.clone());
            return Ok(data);
        }
        tracing::debug!(
            operation = "getCoreSettings",
            "Cache miss, fetching from Postgres"
        );
        let row = self
            .source
            .first_row()
            .await
            .map_err(CoreSettingsError::Fetch)?
            .ok_or(CoreSettingsError::NotFound)?;
        let data = Arc::new(transform(row));
        self.memory_set(data.clone());
        self.redis_set(&data).await;
        Ok(data)
    }

    /// lru-cache with a per-entry TTL, no `updateAgeOnGet` and no `allowStale`.
    fn memory_get(&self) -> Option<Arc<CoreData>> {
        let mut memory = self.memory.lock().unwrap_or_else(PoisonError::into_inner);
        match memory.as_ref() {
            Some(entry) if entry.expires > Instant::now() => Some(entry.data.clone()),
            Some(_) => {
                *memory = None;
                None
            }
            None => None,
        }
    }

    fn memory_set(&self, data: Arc<CoreData>) {
        *self.memory.lock().unwrap_or_else(PoisonError::into_inner) = Some(MemoryEntry {
            data,
            expires: Instant::now() + MEMORY_TTL,
        });
    }

    /// `getFromRedis`: errors, unreadable JSON and entries without data are misses.
    async fn redis_get(&self) -> Option<CoreData> {
        let raw = self
            .store
            .get(&self.store.key(REDIS_KEY))
            .await
            .ok()
            .flatten()?;
        serde_json::from_str::<CachedEntry>(&raw)
            .ok()
            .map(|entry| entry.data)
    }

    /// `setToRedis`: `SETEX` of `{data, cachedAt}`; errors are ignored.
    async fn redis_set(&self, data: &CoreData) {
        let entry = CachedEntry {
            data: data.clone(),
            cached_at: now_ms(),
        };
        let Ok(json) = serde_json::to_string(&entry) else {
            return;
        };
        let _ = self
            .store
            .set_ex(&self.store.key(REDIS_KEY), REDIS_TTL_SECONDS, &json)
            .await;
    }
}

// `Base`. (A `///` comment would become a GraphQL description, which TS has none of.)
#[derive(Clone, Debug, PartialEq, Eq, SimpleObject)]
#[graphql(name = "Base")]
pub struct Base {
    pub copy: Option<String>,
    pub feature_imge: Option<String>,
}

impl From<&Section> for Base {
    fn from(section: &Section) -> Self {
        Self {
            copy: Some(section.copy.clone()),
            feature_imge: Some(section.feature_imge.clone()),
        }
    }
}

// `MoreLinks`. (No doc comment: it would become a GraphQL description.)
#[derive(Clone, Debug, PartialEq, Eq, SimpleObject)]
#[graphql(name = "MoreLinks")]
pub struct MoreLinks {
    pub group: Option<String>,
    pub icon_name: Option<String>,
    pub link: Option<String>,
    pub sub_title: Option<String>,
    pub title: Option<String>,
}

impl From<MoreLink> for MoreLinks {
    fn from(link: MoreLink) -> Self {
        Self {
            group: Some(link.group),
            icon_name: Some(link.icon_name),
            link: Some(link.link),
            sub_title: Some(link.sub_title),
            title: Some(link.title),
        }
    }
}

/// `MoreLinksRefType`.
pub struct MoreLinksRefType(Arc<CoreData>);

#[Object(name = "MoreLinksRefType")]
impl MoreLinksRefType {
    async fn copy(&self) -> Option<String> {
        Some(self.0.more.copy.clone())
    }

    async fn feature_imge(&self) -> Option<String> {
        Some(self.0.more.feature_imge.clone())
    }

    async fn links(&self, ctx: &Context<'_>) -> async_graphql::Result<Option<Vec<MoreLinks>>> {
        let gates = ctx.data::<Arc<dyn FeatureGates>>()?;
        let viewer = ctx.data_opt::<Viewer>();
        let user = GateUser {
            uid: viewer.map(|viewer| viewer.uid.as_str()),
            email: viewer.and_then(|viewer| viewer.email.as_deref()),
        };
        let links = if gates.check(SORT_MORE_LINKS_GATE, &user) {
            sort_more_links(&self.0.more.links)
        } else {
            self.0.more.links.clone()
        };
        Ok(Some(links.into_iter().map(MoreLinks::from).collect()))
    }
}

/// `Core`.
pub struct Core(Arc<CoreData>);

#[Object(name = "Core")]
impl Core {
    async fn events(&self) -> Option<Base> {
        Some(Base::from(&self.0.events))
    }

    async fn giving(&self) -> Option<Base> {
        Some(Base::from(&self.0.giving))
    }

    async fn hccexpression(&self) -> Option<Base> {
        Some(Base::from(&self.0.hccexpression))
    }

    async fn more(&self) -> Option<MoreLinksRefType> {
        Some(MoreLinksRefType(self.0.clone()))
    }

    async fn profile(&self) -> Option<Base> {
        Some(Base::from(&self.0.profile))
    }

    async fn sermons(&self) -> Option<Base> {
        Some(Base::from(&self.0.sermons))
    }
}

#[derive(Default)]
pub struct CoreQuery;

#[Object]
impl CoreQuery {
    #[graphql(guard = "Authorized")]
    async fn core(&self, ctx: &Context<'_>) -> async_graphql::Result<Option<Core>> {
        let settings = ctx.data::<Arc<CoreSettings>>()?;
        Ok(Some(Core(settings.get().await?)))
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use serde_json::{Value, json};

    use super::*;
    use crate::statsig::testing::FixedGates;
    use crate::store::kv::MemoryStore;
    use crate::test_support::{
        FakeCoreSettings, TestServices, execute_with_variables, schema_from, viewer,
    };

    const QUERY: &str = "query CoreQuery { core {
        giving { featureImge copy } profile { featureImge copy } sermons { featureImge copy }
        hccexpression { featureImge copy } events { featureImge copy }
        more { featureImge copy links { title subTitle iconName link group } }
    } }";

    fn row() -> CoreSettingsRow {
        CoreSettingsRow {
            giving_feature_image: Some("https://example.com/giving.jpg".to_owned()),
            giving_copy: Some("Give generously".to_owned()),
            profile_feature_image: Some("https://example.com/profile.jpg".to_owned()),
            profile_copy: Some("Your profile".to_owned()),
            sermons_feature_image: Some("https://example.com/sermons.jpg".to_owned()),
            sermons_copy: Some("Listen again".to_owned()),
            hcc_expression_feature_image: Some("https://example.com/expression.jpg".to_owned()),
            hcc_expression_copy: Some("Express yourself".to_owned()),
            events_feature_image: Some("https://example.com/events.jpg".to_owned()),
            events_copy: Some("Join us".to_owned()),
            more_feature_image: Some("https://example.com/more.jpg".to_owned()),
            more_copy: Some("Everything else".to_owned()),
        }
    }

    fn settings(source: Arc<FakeCoreSettings>, store: Arc<MemoryStore>) -> CoreSettings {
        CoreSettings::new(source, store)
    }

    fn titles(links: &[MoreLink]) -> Vec<&str> {
        links.iter().map(|link| link.title.as_str()).collect()
    }

    async fn run(services: &TestServices) -> Value {
        execute_with_variables(&schema_from(services), QUERY, Value::Null, Some(viewer())).await
    }

    #[test]
    fn falls_back_to_the_default_image_and_section_names() {
        let data = transform(CoreSettingsRow::default());
        let fallback = |copy: &str| Section {
            feature_imge: FALLBACK_IMAGE.to_owned(),
            copy: copy.to_owned(),
        };
        assert_eq!(data.giving, fallback("Giving"));
        assert_eq!(data.profile, fallback("Profile"));
        assert_eq!(data.sermons, fallback("Sermons"));
        assert_eq!(data.hccexpression, fallback("HCC Expression"));
        assert_eq!(data.events, fallback("Events"));
        assert_eq!(data.more.feature_imge, FALLBACK_IMAGE);
        assert_eq!(data.more.copy, "More");
        assert_eq!(data.more.links, more_links());
    }

    #[test]
    fn keeps_stored_values_and_empty_strings() {
        let mut stored = row();
        stored.giving_copy = Some(String::new());
        stored.events_feature_image = Some(String::new());
        let data = transform(stored);
        assert_eq!(data.giving.copy, "");
        assert_eq!(data.giving.feature_imge, "https://example.com/giving.jpg");
        assert_eq!(data.events.feature_imge, "");
        assert_eq!(data.hccexpression.copy, "Express yourself");
        assert_eq!(data.more.copy, "Everything else");
    }

    #[test]
    fn lists_more_links_in_their_fixed_order() {
        assert_eq!(
            titles(&more_links()),
            [
                "I'm new here",
                "Serve",
                "Join a small group",
                "Share your testimony",
                "Privacy Policy"
            ]
        );
    }

    #[test]
    fn sorts_more_links_by_group_then_title() {
        assert_eq!(
            titles(&sort_more_links(&more_links())),
            [
                "I'm new here",
                "Join a small group",
                "Serve",
                "Privacy Policy",
                "Share your testimony"
            ]
        );
    }

    #[test]
    fn compares_like_locale_compare() {
        assert_eq!(locale_compare("apple", "Banana"), Ordering::Less);
        assert_eq!(locale_compare("Other", "Get Connected"), Ordering::Greater);
        assert_eq!(locale_compare("a", "A"), Ordering::Less);
        assert_eq!(locale_compare("I'm new", "Im"), Ordering::Less);
        assert_eq!(locale_compare("a b", "ab"), Ordering::Less);
        assert_eq!(locale_compare("same", "same"), Ordering::Equal);
    }

    #[tokio::test]
    async fn answers_the_sections_with_unsorted_links_when_the_gate_is_off() {
        let services = TestServices {
            core_settings: Arc::new(FakeCoreSettings::row(row())),
            ..TestServices::default()
        };
        let body = run(&services).await;
        assert_eq!(body.get("errors"), None, "{body}");
        let core = &body["data"]["core"];
        assert_eq!(
            core["giving"],
            json!({ "featureImge": "https://example.com/giving.jpg", "copy": "Give generously" })
        );
        assert_eq!(
            core["hccexpression"],
            json!({ "featureImge": "https://example.com/expression.jpg", "copy": "Express yourself" })
        );
        assert_eq!(core["more"]["copy"], "Everything else");
        assert_eq!(
            core["more"]["links"][0],
            json!({
                "title": "I'm new here",
                "subTitle": "Get to know HCC NJ",
                "iconName": "signature",
                "link": "https://hccnj.ccbchurch.com/goto/forms/88/responses/new",
                "group": "Get Connected",
            })
        );
        let answered: Vec<&str> = core["more"]["links"]
            .as_array()
            .unwrap()
            .iter()
            .map(|link| link["title"].as_str().unwrap())
            .collect();
        assert_eq!(answered, titles(&more_links()));
    }

    #[tokio::test]
    async fn sorts_the_links_for_callers_the_gate_passes() {
        let gates = Arc::new(FixedGates::passing(&[SORT_MORE_LINKS_GATE]));
        let services = TestServices {
            core_settings: Arc::new(FakeCoreSettings::row(row())),
            gates: gates.clone(),
            ..TestServices::default()
        };
        let body = run(&services).await;
        let answered: Vec<&str> = body["data"]["core"]["more"]["links"]
            .as_array()
            .unwrap()
            .iter()
            .map(|link| link["title"].as_str().unwrap())
            .collect();
        let sorted = sort_more_links(&more_links());
        assert_eq!(answered, titles(&sorted));
        assert_eq!(
            *gates.checks.lock().unwrap(),
            [(
                SORT_MORE_LINKS_GATE.to_owned(),
                Some("ada-example-uid".to_owned()),
                Some("ada@example.com".to_owned())
            )]
        );
    }

    #[tokio::test]
    async fn checks_the_gate_only_when_links_are_selected() {
        let gates = Arc::new(FixedGates::passing(&[SORT_MORE_LINKS_GATE]));
        let services = TestServices {
            core_settings: Arc::new(FakeCoreSettings::row(row())),
            gates: gates.clone(),
            ..TestServices::default()
        };
        let body = execute_with_variables(
            &schema_from(&services),
            "query CoreQuery { core { more { copy } giving { copy } } }",
            Value::Null,
            Some(viewer()),
        )
        .await;
        assert_eq!(
            body,
            json!({ "data": { "core": { "more": { "copy": "Everything else" }, "giving": { "copy": "Give generously" } } } })
        );
        assert!(gates.checks.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn masks_a_missing_row() {
        let services = TestServices {
            core_settings: Arc::new(FakeCoreSettings::missing()),
            ..TestServices::default()
        };
        let body = run(&services).await;
        assert_eq!(
            body,
            json!({
                "data": { "core": null },
                "errors": [{
                    "message": "Unexpected error.",
                    "locations": [{ "line": 1, "column": 19 }],
                    "path": ["core"],
                    "extensions": { "code": "INTERNAL_SERVER_ERROR" },
                }],
            })
        );
    }

    #[tokio::test]
    async fn masks_a_failed_query_and_caches_nothing() {
        let services = TestServices {
            core_settings: Arc::new(FakeCoreSettings::failing()),
            ..TestServices::default()
        };
        let body = run(&services).await;
        assert_eq!(body["data"], json!({ "core": null }));
        assert_eq!(body["errors"][0]["message"], "Unexpected error.");
        assert!(services.store.keys().is_empty());
    }

    #[tokio::test]
    async fn requires_an_authorized_caller() {
        let services = TestServices {
            core_settings: Arc::new(FakeCoreSettings::row(row())),
            ..TestServices::default()
        };
        let body = execute_with_variables(&schema_from(&services), QUERY, Value::Null, None).await;
        assert_eq!(body["data"], json!({ "core": null }));
        assert_eq!(
            body["errors"][0]["message"],
            "Not authorized to resolve Query.core"
        );
    }

    #[tokio::test]
    async fn reads_postgres_once_then_memory() {
        let source = Arc::new(FakeCoreSettings::row(row()));
        let store = Arc::new(MemoryStore::new("rs:"));
        let core = settings(source.clone(), store.clone());
        let first = core.get().await.unwrap();
        let second = core.get().await.unwrap();
        assert_eq!(first, second);
        assert_eq!(source.reads(), 1);
        // One GET (miss) and one SETEX; the second read never reaches Redis.
        assert_eq!(store.commands(), 2);
        let cached: Value =
            serde_json::from_str(&store.raw("rs:cms:coreSettings:v1").unwrap()).unwrap();
        assert_eq!(cached["data"], serde_json::to_value(&*first).unwrap());
        assert!(cached["cachedAt"].as_u64().unwrap() > 0);
    }

    #[tokio::test(start_paused = true)]
    async fn caches_in_redis_for_ten_minutes() {
        let source = Arc::new(FakeCoreSettings::row(row()));
        let store = Arc::new(MemoryStore::new("rs:"));
        settings(source.clone(), store.clone()).get().await.unwrap();
        assert_eq!(
            store.ttl("rs:cms:coreSettings:v1").await.unwrap(),
            i64::try_from(REDIS_TTL_SECONDS).unwrap()
        );
    }

    #[tokio::test]
    async fn serves_another_replica_from_redis_and_fills_its_memory() {
        let source = Arc::new(FakeCoreSettings::row(row()));
        let store = Arc::new(MemoryStore::new("rs:"));
        settings(source.clone(), store.clone()).get().await.unwrap();

        let other = settings(source.clone(), store.clone());
        let before = store.commands();
        other.get().await.unwrap();
        other.get().await.unwrap();
        assert_eq!(source.reads(), 1);
        // Only the first read on the other replica went to Redis.
        assert_eq!(store.commands() - before, 1);
    }

    #[tokio::test(start_paused = true)]
    async fn expires_the_memory_entry_after_ten_minutes() {
        let source = Arc::new(FakeCoreSettings::row(row()));
        let store = Arc::new(MemoryStore::new("rs:"));
        let core = settings(source.clone(), store.clone());
        core.get().await.unwrap();
        let before = store.commands();
        tokio::time::advance(MEMORY_TTL - Duration::from_millis(1)).await;
        core.get().await.unwrap();
        assert_eq!(store.commands(), before);
        tokio::time::advance(Duration::from_millis(1)).await;
        core.get().await.unwrap();
        // Both tiers were written together with the same 10 minutes, so both have expired: a
        // Redis GET (miss), Postgres, and a new SETEX.
        assert_eq!(store.commands(), before + 2);
        assert_eq!(source.reads(), 2);
    }

    #[tokio::test]
    async fn falls_through_to_postgres_when_redis_is_down() {
        let source = Arc::new(FakeCoreSettings::row(row()));
        let store = Arc::new(MemoryStore::new("rs:"));
        store.set_failing(true);
        let core = settings(source.clone(), store.clone());
        assert_eq!(core.get().await.unwrap().giving.copy, "Give generously");
        assert_eq!(core.get().await.unwrap().giving.copy, "Give generously");
        // The failed SETEX did not stop the memory tier.
        assert_eq!(source.reads(), 1);
    }

    #[tokio::test]
    async fn treats_unreadable_redis_entries_as_misses() {
        let source = Arc::new(FakeCoreSettings::row(row()));
        let store = Arc::new(MemoryStore::new("rs:"));
        store.insert_raw("rs:cms:coreSettings:v1", "not json");
        let core = settings(source.clone(), store.clone());
        assert_eq!(core.get().await.unwrap().events.copy, "Join us");
        assert_eq!(source.reads(), 1);

        let other_store = Arc::new(MemoryStore::new("rs:"));
        other_store.insert_raw("rs:cms:coreSettings:v1", r#"{"cachedAt":1}"#);
        settings(source.clone(), other_store).get().await.unwrap();
        assert_eq!(source.reads(), 2);
    }

    #[tokio::test]
    async fn reads_an_entry_written_in_the_ts_shape() {
        let source = Arc::new(FakeCoreSettings::missing());
        let store = Arc::new(MemoryStore::new("rs:"));
        let data = transform(row());
        store.insert_raw(
            "rs:cms:coreSettings:v1",
            &json!({ "data": data, "cachedAt": 1_760_000_000_000_u64 }).to_string(),
        );
        let core = settings(source.clone(), store);
        assert_eq!(*core.get().await.unwrap(), data);
        assert_eq!(source.reads(), 0);
    }

    #[tokio::test]
    async fn retries_postgres_after_a_failure() {
        let source = Arc::new(FakeCoreSettings::failing());
        let core = settings(source.clone(), Arc::new(MemoryStore::new("rs:")));
        assert!(matches!(core.get().await, Err(CoreSettingsError::Fetch(_))));
        assert!(matches!(core.get().await, Err(CoreSettingsError::Fetch(_))));
        assert_eq!(source.reads(), 2);
        assert_eq!(
            CoreSettingsError::NotFound.to_string(),
            "CMS not found: core settings"
        );
    }

    #[tokio::test]
    async fn resolves_through_the_router_with_injected_settings_and_gates() {
        use crate::google::GoogleAuth;
        use crate::graphql::auth::testing::{GoogleMock, anonymous_claims, sign};
        use crate::test_support::{TestApp, post_graphql_as};

        let mock = GoogleMock::start().await;
        mock.mount_jwks(1).await;
        mock.mount_account(1).await;
        let gates = Arc::new(FixedGates::passing(&[SORT_MORE_LINKS_GATE]));
        let app = TestApp::with_dependencies(
            &mock,
            GoogleAuth::fixed("example-access-token"),
            |dependencies| {
                dependencies.core_settings = Some(Arc::new(FakeCoreSettings::row(row())));
                dependencies.gates = Some(gates.clone());
            },
        );
        let response = app
            .send(post_graphql_as(
                json!({ "query": "query CoreQuery { core { sermons { copy } more { links { title } } } }" }),
                &sign(&anonymous_claims()),
            ))
            .await;
        let body = response.json();
        assert_eq!(
            body["data"]["core"]["sermons"],
            json!({ "copy": "Listen again" })
        );
        assert_eq!(
            body["data"]["core"]["more"]["links"][1],
            json!({ "title": "Join a small group" })
        );
        assert_eq!(gates.checks.lock().unwrap().len(), 1);
        assert!(app.store.raw("rs:cms:coreSettings:v1").is_some());
    }

    /// `PgCoreSettings` against `TEST_DATABASE_URL` (skipped without it). It never touches a real
    /// `core_settings`: a one-connection pool creates a session-scoped temporary table of the
    /// same shape, which Postgres resolves before any permanent one.
    #[tokio::test]
    async fn reads_the_first_core_settings_row_from_postgres() {
        let Ok(url) = std::env::var("TEST_DATABASE_URL") else {
            eprintln!("skipped: TEST_DATABASE_URL is not set");
            return;
        };
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await
            .unwrap();
        sqlx::query(
            "create temporary table core_settings (
                id text primary key, giving_feature_image text, giving_copy text,
                profile_feature_image text, profile_copy text, sermons_feature_image text,
                sermons_copy text, hcc_expression_feature_image text, hcc_expression_copy text,
                events_feature_image text, events_copy text, more_feature_image text,
                more_copy text, created_at timestamp not null default now(),
                updated_at timestamp not null default now()
            )",
        )
        .execute(&pool)
        .await
        .unwrap();
        let source = PgCoreSettings::new(pool.clone());
        assert_eq!(source.first_row().await.unwrap(), None);
        sqlx::query(
            "insert into pg_temp.core_settings (id, giving_copy, more_feature_image)
             values ('core-settings-example', 'Give generously', 'https://example.com/more.jpg')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let found = source.first_row().await.unwrap().unwrap();
        assert_eq!(found.giving_copy.as_deref(), Some("Give generously"));
        assert_eq!(
            found.more_feature_image.as_deref(),
            Some("https://example.com/more.jpg")
        );
        assert_eq!(found.events_copy, None);
        pool.close().await;
    }
}
