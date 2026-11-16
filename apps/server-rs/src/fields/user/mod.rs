//! `user` and `User.woa` (`apps/server/src/graphql/schema/user/index.ts`, `woa.ts`). `user` needs
//! the `signedIn` scope and is never null, so a refused caller gets `data: null`. Of `User`, only
//! `woa` is answered here; the gateway forwards any other `User` field to TS
//! (`gateway::route::PARTIAL_FIELDS`).
//!
//! `woa` is the member's Word of Activation ([`woa::WoaService`]) once their `app-users` profile
//! decodes ([`profile`]); without a profile, or without a Word of Activation (logged as a warning
//! with the uid), it is `null`. A failed lookup fails the field with the masked `Unexpected error.`.
//! Both loads happen once per request, however often `woa` is selected. `User.woa`'s own
//! `signedIn` scope always passes once `user` has resolved, so it is not checked again.

pub mod profile;
pub mod store;
pub mod woa;

use std::sync::Arc;

use async_graphql::{Context, Object, SimpleObject};
use tokio::sync::OnceCell;

use crate::fields::RequestLoaders;
use crate::graphql::auth::Viewer;
use crate::graphql::guards::SignedIn;
use profile::UserProfile;
use woa::{WoaData, WoaLookupError, WoaService};

/// The per-request `userProfile` and `woa` loads.
#[derive(Default)]
pub struct UserLoaders {
    profile: OnceCell<Option<UserProfile>>,
    woa: OnceCell<Result<Option<Arc<WoaData>>, WoaLookupError>>,
}

/// Word of Activation for the current month
#[derive(Clone, Debug, PartialEq, SimpleObject)]
pub struct WordOfActivation {
    /// The book name of the Bible verse
    pub book: Option<String>,
    /// The email of the user
    pub email: Option<String>,
    /// Optional image associated with the verse
    pub image: Option<String>,
    /// The month for this verse
    pub month: Option<String>,
    /// The monthly subscription status
    pub monthly_sub: Option<bool>,
    /// The name of the user
    pub name: Option<String>,
    /// Short book name or reference
    pub st_book: Option<String>,
    /// The actual verse text
    pub text: Option<String>,
    /// Unique identifier for the verse
    pub verse_id: Option<String>,
}

impl WordOfActivation {
    /// `{ ...wordActivationData, email: currentUserEmail }`.
    fn new(data: &WoaData, email: &str) -> Self {
        Self {
            book: Some(data.book.clone()),
            email: Some(email.to_owned()),
            image: data.image.clone(),
            month: Some(data.month.clone()),
            monthly_sub: Some(data.monthly_sub),
            name: Some(data.name.clone()),
            st_book: Some(data.st_book.clone()),
            text: Some(data.text.clone()),
            verse_id: data.verse_id.clone(),
        }
    }
}

// `User`. (No doc comment: TS has no description.)
pub struct User;

#[Object]
impl User {
    async fn woa(&self, ctx: &Context<'_>) -> async_graphql::Result<Option<WordOfActivation>> {
        let Some(viewer) = ctx.data_opt::<Viewer>() else {
            return Ok(None);
        };
        let (Some(email), uid) = (
            viewer.email.as_deref().filter(|email| !email.is_empty()),
            viewer.uid.as_str(),
        ) else {
            return Ok(None);
        };
        if uid.is_empty() {
            return Ok(None);
        }
        let service = ctx.data::<Arc<WoaService>>()?;
        let loaders = &ctx.data::<RequestLoaders>()?.user;
        let profile = loaders
            .profile
            .get_or_init(|| profile::load(service.store(), uid))
            .await;
        if profile.is_none() {
            return Ok(None);
        }
        let woa = loaders
            .woa
            .get_or_init(|| service.load(email, uid))
            .await
            .clone()
            .map_err(|error| async_graphql::Error::new(error.to_string()))?;
        match woa.filter(|data| !data.text.is_empty()) {
            Some(data) => Ok(Some(WordOfActivation::new(&data, email))),
            None => {
                tracing::warn!(userUid = uid, "[UserSchema] Word of activation not found");
                Ok(None)
            }
        }
    }
}

#[derive(Default)]
pub struct UserQuery;

#[Object]
impl UserQuery {
    #[graphql(guard = "SignedIn")]
    async fn user(&self) -> User {
        User
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;
    use std::sync::atomic::Ordering;

    use serde_json::{Value, json};

    use super::store::testing::FakeWoaStore;
    use crate::fields::Clock;
    use crate::google::firestore::{Document, FirestoreValue};
    use crate::graphql::auth::{AuthKind, Viewer};
    use crate::store::kv::{KeyValueStore, MemoryStore};
    use crate::strapi::record_cache::testing::LogCapture;
    use crate::test_support::{TestServices, execute_like_handler, schema_from, viewer};

    /// Friday 2026-10-16 12:00 UTC.
    const NOW: i64 = 1_792_152_000_000;
    /// 2026-10-01 11:30 UTC, this month's rotation.
    const OCTOBER_ROTATION: f64 = 1_790_854_200_000.0;
    /// The app's `UserWoaQuery`.
    const USER_WOA_QUERY: &str = "query UserWoaQuery { user { woa { book email image month monthlySub name stBook text verseId } } }";
    const REDIS_KEY: &str = "rs:woa-dataloader:2:woa-user:ada-example-uid";

    fn string(text: &str) -> FirestoreValue {
        FirestoreValue::String(text.to_owned())
    }

    fn document(fields: &[(&str, FirestoreValue)]) -> Document {
        Document::new(
            fields
                .iter()
                .map(|(name, value)| ((*name).to_owned(), value.clone())),
        )
    }

    fn profile() -> Document {
        document(&[
            ("uid", string("ada-example-uid")),
            ("email", string("ada@example.com")),
            ("firstName", string("Ada")),
            ("lastName", string("Example")),
            ("img", string("https://example.com/ada.png")),
            ("provider", string("google.com")),
            ("isVerified", FirestoreValue::Boolean(true)),
        ])
    }

    fn verse() -> Document {
        document(&[
            ("book", string("Isaiah 60:1")),
            (
                "img",
                FirestoreValue::Array(vec![
                    string("https://example.com/verse-1.png"),
                    string("https://example.com/verse-1b.png"),
                ]),
            ),
            (
                "stBook",
                FirestoreValue::Array(vec![string("Isaiah"), string("60:1")]),
            ),
            ("text", string("Arise, shine; for your light has come.")),
            (
                "nlt_translation",
                string("Arise, Jerusalem! Let your light shine for all to see."),
            ),
        ])
    }

    fn subscription(monthly_sub: FirestoreValue, last_update: Option<f64>) -> Document {
        let mut fields = vec![
            ("email", string("ada@example.com")),
            ("Name", string("Ada Example")),
            ("monthlySub", monthly_sub),
            ("wordActivationId", string("verse-1")),
        ];
        if let Some(ms) = last_update {
            fields.push(("lastUpdate", FirestoreValue::Number(ms)));
        }
        document(&fields)
    }

    /// Ada's profile and one verse; `subscribed` adds her subscription.
    fn store(subscribed: bool) -> FakeWoaStore {
        let store = FakeWoaStore::default();
        store
            .users
            .lock()
            .unwrap()
            .insert("ada-example-uid".to_owned(), profile());
        store
            .verses
            .lock()
            .unwrap()
            .insert("verse-1".to_owned(), verse());
        if subscribed {
            store.subscriptions.lock().unwrap().insert(
                "sub-1".to_owned(),
                subscription(string("true"), Some(OCTOBER_ROTATION)),
            );
        }
        store
    }

    struct Fixture {
        store: Arc<FakeWoaStore>,
        redis: Arc<MemoryStore>,
        schema: crate::graphql::AppSchema,
    }

    fn fixture(store: FakeWoaStore) -> Fixture {
        fixture_with_redis(store, Arc::new(MemoryStore::new("rs:")))
    }

    fn fixture_with_redis(store: FakeWoaStore, redis: Arc<MemoryStore>) -> Fixture {
        let store = Arc::new(store);
        let schema = schema_from(&TestServices {
            clock: Clock::fixed(NOW),
            store: redis.clone(),
            woa_store: store.clone(),
            ..TestServices::default()
        });
        Fixture {
            store,
            redis,
            schema,
        }
    }

    async fn query(fixture: &Fixture, query: &str) -> Value {
        execute_like_handler(&fixture.schema, query, Some(viewer())).await
    }

    fn woa(month: &str, monthly_sub: bool, name: &str) -> Value {
        json!({ "data": { "user": { "woa": {
            "book": "Isaiah 60:1",
            "email": "ada@example.com",
            "image": "https://example.com/verse-1.png",
            "month": month,
            "monthlySub": monthly_sub,
            "name": name,
            "stBook": "Isaiah, 60:1",
            "text": "Arise, Jerusalem! Let your light shine for all to see.",
            "verseId": "verse-1",
        } } } })
    }

    #[tokio::test]
    async fn answers_the_subscription_and_caches_it_for_the_month() {
        let fixture = fixture(store(true));

        let body = query(&fixture, USER_WOA_QUERY).await;

        assert_eq!(body, woa("October, 2026", true, "Ada Example"));
        let cached: Value = serde_json::from_str(&fixture.redis.raw(REDIS_KEY).unwrap()).unwrap();
        assert_eq!(cached["value"]["verseId"], "verse-1");
        assert_eq!(cached["expiresAt"], NOW + 60 * 60 * 1000);
        assert_eq!(fixture.redis.ttl(REDIS_KEY).await.unwrap(), 7200);

        // Memory answers the next request: only the profile is read again.
        let calls = fixture.store.calls();
        assert_eq!(query(&fixture, USER_WOA_QUERY).await, body);
        assert_eq!(fixture.store.calls(), calls + 1);
    }

    #[tokio::test]
    async fn reads_a_cached_month_from_redis_and_refetches_a_past_one() {
        let redis = Arc::new(MemoryStore::new("rs:"));
        let cached = |month: &str| {
            json!({ "value": {
                "book": "Cached Book", "stBook": "Cached", "month": month, "name": "Ada Example",
                "monthlySub": true, "email": "ada@example.com", "text": "Cached text",
            }, "expiresAt": NOW })
            .to_string()
        };
        redis.insert_raw(REDIS_KEY, &cached("October, 2026"));
        let fixture = fixture_with_redis(store(true), redis.clone());
        let body = query(&fixture, USER_WOA_QUERY).await;
        assert_eq!(body["data"]["user"]["woa"]["book"], "Cached Book");
        // An entry without an image or verse id answers null for both.
        assert_eq!(body["data"]["user"]["woa"]["image"], Value::Null);

        redis.insert_raw(REDIS_KEY, &cached("September, 2026"));
        let fixture = fixture_with_redis(store(true), redis);
        assert_eq!(
            query(&fixture, USER_WOA_QUERY).await,
            woa("October, 2026", true, "Ada Example")
        );
    }

    #[tokio::test]
    async fn subscribes_a_member_without_a_subscription() {
        // The member's `app-users` document is also found by email.
        let fixture = fixture(store(false));

        let body = query(&fixture, USER_WOA_QUERY).await;

        assert_eq!(body, woa("October, 2026", true, "Ada Example"));
        let subscriptions = fixture.store.subscriptions();
        assert_eq!(subscriptions.len(), 1);
        let added = subscriptions.values().next().unwrap();
        assert_eq!(
            added.fields(),
            &HashMap::from([
                ("Name".to_owned(), string("Ada Example")),
                ("email".to_owned(), string("ada@example.com")),
                ("monthlySub".to_owned(), FirestoreValue::Boolean(true)),
                ("wordActivationId".to_owned(), string("verse-1")),
            ])
        );
    }

    #[tokio::test]
    async fn answers_null_without_a_profile_or_a_word_of_activation() {
        let logs = LogCapture::default();
        let _guard = logs.install();
        let no_profile = fixture(FakeWoaStore::default());
        assert_eq!(
            query(&no_profile, USER_WOA_QUERY).await,
            json!({ "data": { "user": { "woa": null } } })
        );
        assert_eq!(no_profile.store.calls(), 1);

        // A profile, but no subscription and no `app-users` document by that email.
        let store = store(false);
        let mut renamed = profile().fields().clone();
        renamed.insert("email".to_owned(), string("grace@example.com"));
        store
            .users
            .lock()
            .unwrap()
            .insert("ada-example-uid".to_owned(), Document::new(renamed));
        let unknown_email = fixture(store);
        assert_eq!(
            query(&unknown_email, USER_WOA_QUERY).await,
            json!({ "data": { "user": { "woa": null } } })
        );
        assert!(unknown_email.redis.keys().is_empty());
        assert!(
            logs.lines().iter().any(|line| line
                .starts_with("Warn [UserSchema] Word of activation not found")
                && line.contains(r#""userUid":"ada-example-uid""#)),
            "{:#?}",
            logs.lines()
        );
    }

    #[tokio::test]
    async fn fails_the_field_when_the_lookup_fails_without_logging_the_email() {
        let logs = LogCapture::default();
        let _guard = logs.install();
        let store = store(true);
        store.failing_subscriptions.store(true, Ordering::SeqCst);
        let fixture = fixture(store);

        let body = query(&fixture, USER_WOA_QUERY).await;

        assert_eq!(body["data"], json!({ "user": { "woa": null } }));
        assert_eq!(body["errors"][0]["message"], "Unexpected error.");
        assert_eq!(body["errors"][0]["path"], json!(["user", "woa"]));
        let lines = logs.lines();
        let failure = lines
            .iter()
            .find(|line| line.starts_with("Error WOA DataLoader fetch failed"))
            .unwrap_or_else(|| panic!("{lines:#?}"));
        assert!(
            failure.contains(r#""cacheKey":"user:ada-example-uid""#),
            "{failure}"
        );
        assert!(
            failure.contains("Word of activation lookup (findSubscriptionByEmail) failed"),
            "{failure}"
        );
        assert!(
            lines.iter().all(|line| !line.contains("ada@example.com")),
            "{lines:#?}"
        );
    }

    #[tokio::test]
    async fn loads_once_per_request_however_often_woa_is_selected() {
        let fixture = fixture(store(true));
        let body = query(
            &fixture,
            "query Q { user { woa { text } again: woa { month } } me: user { woa { name } } }",
        )
        .await;
        assert_eq!(body["data"]["me"]["woa"]["name"], "Ada Example");
        // The profile, the subscription and its verse.
        assert_eq!(fixture.store.calls(), 3);
    }

    #[tokio::test]
    async fn refuses_callers_without_a_full_sign_in() {
        let fixture = fixture(store(true));
        let anonymous = Viewer {
            uid: "ada-example-uid".to_owned(),
            email: None,
            kind: AuthKind::FirebaseAnonymous,
        };
        let body = execute_like_handler(&fixture.schema, USER_WOA_QUERY, Some(anonymous)).await;
        assert_eq!(body["data"], Value::Null);
        assert_eq!(
            body["errors"][0]["message"],
            "Not authorized to resolve Query.user"
        );
        assert_eq!(fixture.store.calls(), 0);
    }
}
