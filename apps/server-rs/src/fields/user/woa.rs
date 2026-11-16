//! The member's Word of Activation: the `woa` request loader
//! (`apps/server/src/graphql/loaders/woaDataLoader.ts`) over `WordOfActivationService.getByEmail`
//! (`apps/server/src/effect/services/WordOfActivationService.ts`) and
//! `getOrAssignWordOfActivationEffect` (`apps/server/src/utils/wordOfActivation/wordOfActivation.ts`),
//! as TS has them after #241: subscriptions live in the secondary project.
//!
//! - **Caches.** The in-process LRU (200 entries, an entry dropped after an hour unread), then
//!   Redis `rs:woa-dataloader:2:woa-<key>` holding `{"value", "expiresAt"}` for two hours. Either is
//!   used only while its `month` is the current Eastern month, so a new month refetches. The key is
//!   `user:<encodeURIComponent(uid)>`, or `email-sha256:<hash>` for a blank uid.
//! - **Lookup.** The member's subscription (first match by email), with its verse; its `month` is
//!   the Eastern month of its `lastUpdate`, else the current one.
//! - **Subscribe.** Without a subscription (or when its verse is gone), a member with an
//!   `app-users` document is subscribed with a random verse and `monthlySub: true`, named
//!   `"<firstName> <lastName>"` (else their email). The add re-checks for a subscription first; if one
//!   appeared, it keeps that one, reading its verse, setting `monthlySub: true` when it differs, and
//!   filling an empty verse id.
//! - **Results.** A member without either document has no Word of Activation, and nothing is
//!   cached. A failed read, decode or write is logged with the cache key (never the email) and fails
//!   the field.
//!
//! Difference from TS: an LRU entry an hour unread is dropped here; TS serves it once more first.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use chrono::DateTime;
use chrono_tz::America::New_York;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::store::{Fields, WoaStore};
use crate::ccb::request::encode_uri_component;
use crate::fields::Clock;
use crate::google::firestore::{Document, FirestoreValue, QueryDocument};
use crate::store::kv::KeyValueStore;
use crate::strapi::js;

/// `createRedisCache`'s `${prefix}:${REDIS_CACHE_VERSION}`.
pub const REDIS_PREFIX: &str = "woa-dataloader:2";
/// `ttl`.
pub const TTL: Duration = Duration::from_secs(60 * 60);
/// Redis keeps an entry for `ttl + staleDuration`.
pub const REDIS_SECONDS: u64 = 2 * 60 * 60;
/// The LRU's `max`.
pub const MEMORY_MAX_ENTRIES: u64 = 200;

/// `WordOfActivationData`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WoaData {
    pub book: String,
    pub st_book: String,
    pub month: String,
    pub name: String,
    pub monthly_sub: bool,
    pub email: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verse_id: Option<String>,
}

/// A `createRedisCache` entry.
#[derive(Serialize, Deserialize)]
struct RedisEntry {
    value: WoaData,
    #[serde(rename = "expiresAt")]
    expires_at: i64,
}

/// `WordOfActivationLookupError`: its message names the step, never the member's email.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
#[error("Word of activation lookup ({operation}) failed{}", cause.as_ref().map(|cause| format!(": {cause}")).unwrap_or_default())]
pub struct WoaLookupError {
    pub operation: &'static str,
    pub cause: Option<String>,
}

fn lookup_error(operation: &'static str, cause: impl std::fmt::Display) -> WoaLookupError {
    WoaLookupError {
        operation,
        cause: Some(cause.to_string()),
    }
}

/// `VerseData`.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Verse {
    book: String,
    verse_id: String,
    img: Vec<String>,
    st_book: Vec<String>,
    nlt_translation: String,
}

/// Where a decoded verse's `verseId` comes from.
enum VerseId<'a> {
    /// `{ ...data, verseId: id }`: the document id wins.
    Id(&'a str),
    /// `{ verseId: id, ...data }` (`toVerseData`): a `verseId` field wins.
    Default(&'a str),
}

fn string(document: &Document, field: &str) -> Option<String> {
    match document.get(field) {
        Some(FirestoreValue::String(text)) => Some(text.clone()),
        _ => None,
    }
}

fn strings(document: &Document, field: &str) -> Option<Vec<String>> {
    let Some(FirestoreValue::Array(values)) = document.get(field) else {
        return None;
    };
    values
        .iter()
        .map(|value| match value {
            FirestoreValue::String(text) => Some(text.clone()),
            _ => None,
        })
        .collect()
}

/// `VerseDataSchema`: every field required (`text` too, although only `nlt_translation` is shown).
fn decode_verse(document: &Document, verse_id: VerseId<'_>) -> Option<Verse> {
    let verse_id = match verse_id {
        VerseId::Id(id) => id.to_owned(),
        VerseId::Default(id) => match document.get("verseId") {
            None => id.to_owned(),
            Some(FirestoreValue::String(text)) => text.clone(),
            Some(_) => return None,
        },
    };
    string(document, "text")?;
    Some(Verse {
        book: string(document, "book")?,
        verse_id,
        img: strings(document, "img")?,
        st_book: strings(document, "stBook")?,
        nlt_translation: string(document, "nlt_translation")?,
    })
}

/// `monthlySub`, which may be a boolean or a string.
#[derive(Clone, Debug, PartialEq, Eq)]
enum MonthlySub {
    Flag(bool),
    Text(String),
}

impl MonthlySub {
    /// `monthlySub === "true" || monthlySub === true`.
    fn subscribed(&self) -> bool {
        matches!(self, Self::Flag(true)) || matches!(self, Self::Text(text) if text == "true")
    }
}

/// `WordActivationSubSchema`, decoded from `{ profileID: doc.id, ...doc.data() }`.
#[derive(Clone, Debug, PartialEq)]
struct Subscription {
    profile_id: String,
    email: String,
    name: String,
    last_update: Option<f64>,
    monthly_sub: Option<MonthlySub>,
    word_activation_id: String,
}

fn decode_subscription(found: &QueryDocument) -> Option<Subscription> {
    let document = &found.document;
    let profile_id = match document.get("profileID") {
        None => found.id.clone(),
        Some(FirestoreValue::String(text)) => text.clone(),
        Some(_) => return None,
    };
    let last_update = match document.get("lastUpdate") {
        None => None,
        Some(FirestoreValue::Number(ms)) => Some(*ms),
        Some(_) => return None,
    };
    let monthly_sub = match document.get("monthlySub") {
        None => None,
        Some(FirestoreValue::Boolean(flag)) => Some(MonthlySub::Flag(*flag)),
        Some(FirestoreValue::String(text)) => Some(MonthlySub::Text(text.clone())),
        Some(_) => return None,
    };
    Some(Subscription {
        profile_id,
        email: string(document, "email")?,
        name: string(document, "Name")?,
        last_update,
        monthly_sub,
        word_activation_id: string(document, "wordActivationId")?,
    })
}

/// A path firebase-admin's `doc(id)` accepts: a single non-empty segment.
fn valid_document_id(id: &str) -> bool {
    !id.is_empty() && !id.contains('/')
}

/// Firestore's `autoId()`: 20 characters from `[A-Za-z0-9]`.
fn auto_id() -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let random = [uuid::Uuid::new_v4(), uuid::Uuid::new_v4()];
    random
        .iter()
        .flat_map(|uuid| uuid.as_bytes().iter())
        .take(20)
        .map(|byte| char::from(ALPHABET[usize::from(*byte) % ALPHABET.len()]))
        .collect()
}

/// `createWOADataLoaderKey(...).cacheKey`.
pub fn cache_key(email: &str, uid: &str) -> String {
    let uid = js::trim(uid);
    if uid.is_empty() {
        // `hashEmail`.
        let normalized = js::trim(&email.to_lowercase()).to_owned();
        format!("email-sha256:{}", hex::encode(Sha256::digest(normalized)))
    } else {
        format!("user:{}", encode_uri_component(uid))
    }
}

pub struct WoaService {
    store: Arc<dyn WoaStore>,
    kv: Arc<dyn KeyValueStore>,
    clock: Clock,
    memory: moka::sync::Cache<String, Arc<WoaData>>,
}

impl WoaService {
    pub fn new(store: Arc<dyn WoaStore>, kv: Arc<dyn KeyValueStore>, clock: Clock) -> Self {
        Self {
            store,
            kv,
            clock,
            memory: moka::sync::Cache::builder()
                .max_capacity(MEMORY_MAX_ENTRIES)
                .time_to_idle(TTL)
                .build(),
        }
    }

    pub fn store(&self) -> &dyn WoaStore {
        self.store.as_ref()
    }

    /// `wordOfActivationMonth`: `MMMM, yyyy` in Eastern time.
    fn month(ms: f64) -> String {
        DateTime::from_timestamp_millis(ms as i64)
            .unwrap_or_default()
            .with_timezone(&New_York)
            .format("%B, %Y")
            .to_string()
    }

    fn now(&self) -> f64 {
        self.clock.now_ms() as f64
    }

    /// The `woa` loader's batch function for one member.
    pub async fn load(
        &self,
        email: &str,
        uid: &str,
    ) -> Result<Option<Arc<WoaData>>, WoaLookupError> {
        let cache_key = cache_key(email, uid);
        let key = format!("woa-{cache_key}");
        let current_month = Self::month(self.now());
        if let Some(cached) = self
            .memory
            .get(&key)
            .filter(|cached| cached.month == current_month)
        {
            return Ok(Some(cached));
        }
        let redis_key = self.kv.key(&format!("{REDIS_PREFIX}:{key}"));
        if let Some(cached) = self
            .redis_get(&redis_key)
            .await
            .filter(|cached| cached.month == current_month)
        {
            let cached = Arc::new(cached);
            self.memory.insert(key, cached.clone());
            return Ok(Some(cached));
        }
        match self.get_by_email(email).await {
            Ok(Some(data)) => {
                let data = Arc::new(WoaData {
                    email: email.to_owned(),
                    ..data
                });
                self.redis_set(&redis_key, &data).await;
                self.memory.insert(key, data.clone());
                Ok(Some(data))
            }
            Ok(None) => Ok(None),
            Err(error) => {
                tracing::error!(cacheKey = %cache_key, error = %error, "WOA DataLoader fetch failed");
                Err(error)
            }
        }
    }

    async fn redis_get(&self, key: &str) -> Option<WoaData> {
        let cached = match self.kv.get(key).await {
            Ok(cached) => cached?,
            Err(error) => {
                tracing::warn!(prefix = REDIS_PREFIX, error = %error, "Redis cache getMultiple failed");
                return None;
            }
        };
        match serde_json::from_str::<RedisEntry>(&cached) {
            Ok(entry) => Some(entry.value),
            Err(error) => {
                tracing::warn!(prefix = REDIS_PREFIX, error = %error, "Redis cache getMultiple failed");
                None
            }
        }
    }

    async fn redis_set(&self, key: &str, data: &WoaData) {
        let entry = RedisEntry {
            value: data.clone(),
            expires_at: self.clock.now_ms() + TTL.as_millis() as i64,
        };
        let Ok(value) = serde_json::to_string(&entry) else {
            return;
        };
        if let Err(error) = self.kv.set_ex(key, REDIS_SECONDS, &value).await {
            tracing::warn!(prefix = REDIS_PREFIX, error = %error, "Redis cache setMultiple failed");
        }
    }

    /// `getByEmail`.
    async fn get_by_email(&self, email: &str) -> Result<Option<WoaData>, WoaLookupError> {
        if let Some(existing) = self.existing_subscription(email).await? {
            return Ok(Some(existing));
        }
        self.subscribe_new_user(email).await
    }

    /// `getExistingSubscription`.
    async fn existing_subscription(&self, email: &str) -> Result<Option<WoaData>, WoaLookupError> {
        let found = self
            .store
            .subscription_by_email(email)
            .await
            .map_err(|error| lookup_error("findSubscriptionByEmail", error))?;
        let Some(found) = found else {
            return Ok(None);
        };
        let subscription = decode_subscription(&found).ok_or(WoaLookupError {
            operation: "parseSubscription",
            cause: None,
        })?;
        let verse_id = &subscription.word_activation_id;
        if !valid_document_id(verse_id) {
            return Err(lookup_error("getScriptureById", "not a document path"));
        }
        let document = self
            .store
            .verse(verse_id)
            .await
            .map_err(|error| lookup_error("getScriptureById", error))?;
        let Some(document) = document else {
            return Ok(None);
        };
        let verse = decode_verse(&document, VerseId::Id(verse_id)).ok_or(WoaLookupError {
            operation: "parseScripture",
            cause: None,
        })?;
        let month = Self::month(subscription.last_update.unwrap_or_else(|| self.now()));
        Ok(Some(WoaData {
            book: verse.book,
            month,
            st_book: verse.st_book.join(", "),
            text: verse.nlt_translation,
            image: verse.img.into_iter().next(),
            verse_id: Some(verse.verse_id),
            name: subscription.name,
            monthly_sub: subscription
                .monthly_sub
                .as_ref()
                .is_some_and(MonthlySub::subscribed),
            email: subscription.email,
        }))
    }

    /// `subscribeNewUser`.
    async fn subscribe_new_user(&self, email: &str) -> Result<Option<WoaData>, WoaLookupError> {
        let user = self
            .store
            .user_by_email(email)
            .await
            .map_err(|error| lookup_error("findUserByEmail", error))?;
        let Some(user) = user else {
            return Ok(None);
        };
        let part = |field: &str| match user.get(field) {
            Some(FirestoreValue::String(text)) => text.clone(),
            Some(FirestoreValue::Number(number)) => js::number_to_string(*number),
            Some(FirestoreValue::Boolean(flag)) => flag.to_string(),
            _ => String::new(),
        };
        let full_name = format!("{} {}", part("firstName"), part("lastName"));
        let display_name = match js::trim(&full_name) {
            "" => email.to_owned(),
            trimmed => trimmed.to_owned(),
        };
        let verse = self
            .get_or_assign(email, &display_name)
            .await
            .map_err(|cause| lookup_error("getWordOfTheMonth", cause))?;
        Ok(Some(WoaData {
            book: verse.book,
            month: Self::month(self.now()),
            st_book: verse.st_book.join(", "),
            text: verse.nlt_translation,
            image: verse.img.into_iter().next(),
            verse_id: Some(verse.verse_id),
            name: display_name,
            monthly_sub: true,
            email: email.to_owned(),
        }))
    }

    /// `getOrAssignWordOfActivationEffect({ email, Name, sub: true })`; errors name the step as
    /// `WordActivationFirestoreError` does.
    async fn get_or_assign(&self, email: &str, name: &str) -> Result<Verse, String> {
        let failed = |operation: &str, cause: &dyn std::fmt::Display| {
            format!("Word activation Firestore ({operation}) failed: {cause}")
        };
        let found = self
            .store
            .subscription_by_email(email)
            .await
            .map_err(|error| failed("findSubscribeEmail", &error))?;
        let Some(found) = found else {
            let verse = self.verse_by_id(None).await?;
            let fields: Fields = HashMap::from([
                ("Name".to_owned(), FirestoreValue::String(name.to_owned())),
                ("email".to_owned(), FirestoreValue::String(email.to_owned())),
                ("monthlySub".to_owned(), FirestoreValue::Boolean(true)),
                (
                    "wordActivationId".to_owned(),
                    FirestoreValue::String(verse.verse_id.clone()),
                ),
            ]);
            self.store
                .add_subscription(&fields)
                .await
                .map_err(|error| failed("addProfile", &error))?;
            return Ok(verse);
        };
        let subscription = decode_subscription(&found)
            .ok_or_else(|| failed("parseSubscription", &"invalid subscription"))?;
        let verse = self
            .verse_by_id(Some(&subscription.word_activation_id))
            .await?;
        // `doc(profileID)` throws on a path that is not one segment, before either update.
        let resubscribe = subscription
            .monthly_sub
            .as_ref()
            .is_some_and(|monthly_sub| *monthly_sub != MonthlySub::Flag(true));
        let needs_update = resubscribe || subscription.word_activation_id.is_empty();
        if needs_update && !valid_document_id(&subscription.profile_id) {
            return Err(failed("updateMonthlySub", &"not a document path"));
        }
        if resubscribe {
            let fields = HashMap::from([("monthlySub".to_owned(), FirestoreValue::Boolean(true))]);
            self.store
                .update_subscription(&subscription.profile_id, &fields)
                .await
                .map_err(|error| failed("updateMonthlySub", &error))?;
        }
        if subscription.word_activation_id.is_empty() {
            let fields = HashMap::from([(
                "wordActivationId".to_owned(),
                FirestoreValue::String(verse.verse_id.clone()),
            )]);
            self.store
                .update_subscription(&subscription.profile_id, &fields)
                .await
                .map_err(|error| failed("updateWordActivationId", &error))?;
        }
        Ok(verse)
    }

    /// `getWordOfActivationByIdEffect(id)`: a random verse without an id.
    async fn verse_by_id(&self, id: Option<&str>) -> Result<Verse, String> {
        let Some(id) = id.filter(|id| !id.is_empty()) else {
            return self.random_verse().await;
        };
        let failed = |cause: &dyn std::fmt::Display| {
            format!("Word activation Firestore (getWordOfActivationByIdEffect) failed: {cause}")
        };
        if !valid_document_id(id) {
            return Err(failed(&"not a document path"));
        }
        let document = self
            .store
            .verse(id)
            .await
            .map_err(|error| failed(&error))?
            .ok_or_else(|| {
                "Word activation Firestore (getWordOfActivationByIdEffect.notFound) failed"
                    .to_owned()
            })?;
        let verse = decode_verse(&document, VerseId::Default(id))
            .ok_or_else(|| failed(&"invalid verse"))?;
        Ok(Verse {
            verse_id: id.to_owned(),
            ..verse
        })
    }

    /// `getRandomIdFromWordActivationCollectionEffect`: the first verse at or after a random id,
    /// else the first before it.
    async fn random_verse(&self) -> Result<Verse, String> {
        let failed = |cause: &dyn std::fmt::Display| {
            format!("Word activation Firestore (getQuotes) failed: {cause}")
        };
        let key = auto_id();
        for at_or_after in [true, false] {
            let found = self
                .store
                .verse_near(&key, at_or_after)
                .await
                .map_err(|error| failed(&error))?;
            if let Some(found) = found {
                return decode_verse(&found.document, VerseId::Default(&found.id))
                    .ok_or_else(|| failed(&"invalid verse"));
            }
        }
        Err(
            "Word activation Firestore (getRandomIdFromWordActivationCollectionEffect.noVerses) failed"
                .to_owned(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::super::store::testing::FakeWoaStore;
    use super::*;
    use crate::store::kv::MemoryStore;

    fn string(text: &str) -> FirestoreValue {
        FirestoreValue::String(text.to_owned())
    }

    fn verse_document() -> Document {
        Document::new([
            ("book".to_owned(), string("Isaiah 60:1")),
            ("img".to_owned(), FirestoreValue::Array(vec![])),
            (
                "stBook".to_owned(),
                FirestoreValue::Array(vec![string("Isaiah")]),
            ),
            ("text".to_owned(), string("Arise, shine.")),
            ("nlt_translation".to_owned(), string("Arise, Jerusalem!")),
        ])
    }

    fn service(store: Arc<FakeWoaStore>) -> WoaService {
        WoaService::new(
            store,
            Arc::new(MemoryStore::new("rs:")),
            Clock::fixed(1_792_152_000_000),
        )
    }

    #[test]
    fn months_are_eastern() {
        // 2026-11-01 03:00 UTC is still October 31 in New York; 05:00 UTC is November.
        assert_eq!(WoaService::month(1_793_502_000_000.0), "October, 2026");
        assert_eq!(WoaService::month(1_793_509_200_000.0), "November, 2026");
    }

    #[test]
    fn keys_members_by_uid_or_by_their_hashed_email() {
        assert_eq!(
            cache_key("ada@example.com", "ada uid/1"),
            "user:ada%20uid%2F1"
        );
        assert_eq!(
            cache_key(" Ada@Example.com ", "  "),
            "email-sha256:b5fc85e55755f9e0d030a10ab4429b6b2944855f9a0d60077fe832becbc41d72"
        );
    }

    #[test]
    fn auto_ids_are_twenty_alphanumerics() {
        let id = auto_id();
        assert_eq!(id.len(), 20);
        assert!(id.bytes().all(|byte| byte.is_ascii_alphanumeric()), "{id}");
        assert_ne!(auto_id(), id);
    }

    #[test]
    fn reads_monthly_sub_flags_and_text() {
        assert!(MonthlySub::Flag(true).subscribed());
        assert!(MonthlySub::Text("true".to_owned()).subscribed());
        assert!(!MonthlySub::Flag(false).subscribed());
        assert!(!MonthlySub::Text("yes".to_owned()).subscribed());
    }

    /// A subscription that appeared between the lookup and the add is kept: re-subscribed and
    /// given a verse.
    #[tokio::test]
    async fn keeps_a_subscription_that_appeared_before_the_add() {
        let store = Arc::new(FakeWoaStore::default());
        store
            .verses
            .lock()
            .unwrap()
            .insert("verse-1".to_owned(), verse_document());
        store.subscriptions.lock().unwrap().insert(
            "sub-1".to_owned(),
            Document::new([
                ("email".to_owned(), string("ada@example.com")),
                ("Name".to_owned(), string("Ada Example")),
                ("monthlySub".to_owned(), FirestoreValue::Boolean(false)),
                ("wordActivationId".to_owned(), string("")),
            ]),
        );

        let verse = service(store.clone())
            .get_or_assign("ada@example.com", "Ada Example")
            .await
            .unwrap();

        assert_eq!(verse.verse_id, "verse-1");
        let subscriptions = store.subscriptions();
        let updated = &subscriptions["sub-1"];
        assert_eq!(
            updated.get("monthlySub"),
            Some(&FirestoreValue::Boolean(true))
        );
        assert_eq!(updated.get("wordActivationId"), Some(&string("verse-1")));
        assert_eq!(subscriptions.len(), 1);
    }

    #[tokio::test]
    async fn fails_to_assign_without_verses() {
        let store = Arc::new(FakeWoaStore::default());
        let error = service(store)
            .get_or_assign("ada@example.com", "Ada Example")
            .await
            .unwrap_err();
        assert!(error.contains("noVerses"), "{error}");
    }

    #[test]
    fn decodes_verses_like_their_two_ts_spreads() {
        let mut fields = verse_document().fields().clone();
        fields.insert("verseId".to_owned(), string("from-data"));
        let with_id = Document::new(fields.clone());
        let verse_id = |verse: Option<Verse>| verse.map(|verse| verse.verse_id);
        assert_eq!(
            verse_id(decode_verse(&with_id, VerseId::Id("doc-id"))),
            Some("doc-id".to_owned())
        );
        assert_eq!(
            verse_id(decode_verse(&with_id, VerseId::Default("doc-id"))),
            Some("from-data".to_owned())
        );
        fields.insert("verseId".to_owned(), FirestoreValue::Number(1.0));
        let bad_id = Document::new(fields.clone());
        assert!(decode_verse(&bad_id, VerseId::Default("doc-id")).is_none());
        assert!(decode_verse(&bad_id, VerseId::Id("doc-id")).is_some());
        fields.remove("text");
        assert!(decode_verse(&Document::new(fields), VerseId::Id("doc-id")).is_none());
    }
}
