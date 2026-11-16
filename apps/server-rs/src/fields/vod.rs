//! `verseOfTheDayV2` (`apps/server/src/graphql/schema/scriptures/vod.ts`): the daily verse as
//! `Scripture | VodFetchError | VodNotFoundError`.
//!
//! Read path (`VodService.getDailyVerse` in `apps/server/src/effect/services/VodService.ts`, with
//! `vod/{cache,constants,firebase,transforms,types}.ts`): "today" is the `YYYY-MM-DD` date in
//! `VOD_TIMEZONE` (default `America/New_York`); the in-process entry (`vod:daily`, 30 s), then
//! Redis `vod:verseOfTheDay:v2` (`{data, cachedAt, date}`, 600 s) serve an entry only when it is
//! dated today; otherwise the Firestore document `dailyVerse/verseOfTheDay` is read and
//! normalized, and fills both caches. Cache errors are misses or skipped writes. Postgres is not
//! read (TS keeps its dated copy write-only for now), and the rotation, push and lock paths are
//! not ported: this server never writes to Firestore or Postgres.

use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use async_graphql::{Context, Object, SimpleObject, Union};
use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use tokio::time::Instant;

use crate::fields::Clock;
use crate::google::firestore::{Document, DocumentSource, FirestoreValue};
use crate::graphql::guards::Authorized;
use crate::graphql::response_cache::now_ms;
use crate::store::kv::KeyValueStore;
use crate::strapi::js;

/// `REDIS_CACHE_KEY`, under this server's prefix.
pub const REDIS_KEY: &str = "vod:verseOfTheDay:v2";
/// `LRU_TTL_MS`.
pub const MEMORY_TTL: Duration = Duration::from_secs(30);
/// `REDIS_TTL_SECONDS`.
pub const REDIS_TTL_SECONDS: u64 = 10 * 60;
/// `FBPaths.customVerse` / `FBPaths.verseOfTheDay`.
pub const VERSE_COLLECTION: &str = "dailyVerse";
pub const VERSE_DOCUMENT: &str = "verseOfTheDay";
/// The longest `stBook` (the `st_book` column is `varchar(20)`).
const ST_BOOK_LENGTH: usize = 20;

/// `ScriptureData`, also the cached JSON's `data` (`omitUndefined`: no `image` key without one).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScriptureData {
    pub book: String,
    pub date: String,
    #[serde(rename = "stBook")]
    pub st_book: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    #[serde(rename = "verseId", skip_serializing_if = "Option::is_none")]
    pub verse_id: Option<String>,
    pub nlt_translation: String,
}

/// `CachedVodEntry`.
#[derive(Clone, Debug, Serialize, Deserialize)]
struct CachedEntry {
    data: ScriptureData,
    #[serde(rename = "cachedAt")]
    cached_at: f64,
    date: String,
}

impl CachedEntry {
    /// `isValidCacheEntry`: a book, a positive `cachedAt`, and today's date.
    fn is_fresh(&self, today: &str) -> bool {
        !self.data.book.is_empty() && self.cached_at > 0.0 && self.date == today
    }
}

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum VodError {
    /// `VodFetchError`'s message.
    #[error("VOD fetch: {0}")]
    Fetch(&'static str),
    /// `VodNotFoundError`'s message.
    #[error("VOD not found: verse of the day (Firebase)")]
    NotFound,
}

/// `getTodayDateString`: `Intl.DateTimeFormat("en-CA")` in the VOD time zone, `YYYY-MM-DD`.
pub fn today(now_ms: i64, timezone: Tz) -> String {
    DateTime::<Utc>::from_timestamp_millis(now_ms)
        .unwrap_or_default()
        .with_timezone(&timezone)
        .format("%Y-%m-%d")
        .to_string()
}

/// `readNonEmptyString`: a string, trimmed, if anything is left.
fn non_empty_string(value: Option<&FirestoreValue>) -> Option<String> {
    match value {
        Some(FirestoreValue::String(text)) => {
            let trimmed = js::trim(text);
            (!trimmed.is_empty()).then(|| trimmed.to_owned())
        }
        _ => None,
    }
}

/// `readOptionalImage`: a non-empty string, or the first entry of an array.
fn optional_image(value: Option<&FirestoreValue>) -> Option<String> {
    non_empty_string(value).or_else(|| match value {
        Some(FirestoreValue::Array(values)) => non_empty_string(values.first()),
        _ => None,
    })
}

/// JavaScript's `slice(0, end)` on a string: the first `end` UTF-16 code units. A surrogate pair
/// cut in half leaves a lone surrogate in JavaScript; here it becomes U+FFFD.
fn js_slice(text: &str, end: usize) -> String {
    let units: Vec<u16> = text.encode_utf16().take(end).collect();
    String::from_utf16_lossy(&units)
}

/// The vod/firebase.ts `getDailyVerse` normalization, then `toScriptureData`. `random_id` is the
/// `crypto.randomUUID().slice(0, 8)` part of the fallback verse id.
pub fn normalize(
    document: &Document,
    today: &str,
    random_id: impl FnOnce() -> String,
) -> Result<ScriptureData, VodError> {
    let book = non_empty_string(document.get("book"));
    let verse_id = non_empty_string(document.get("verseId"));
    let st_book = non_empty_string(document.get("stBook"))
        .or_else(|| verse_id.clone())
        .or_else(|| book.clone())
        .unwrap_or_else(|| "Unknown".to_owned());
    let nlt_translation = non_empty_string(document.get("nlt_translation"))
        .or_else(|| non_empty_string(document.get("text")));
    let text = non_empty_string(document.get("text")).or_else(|| nlt_translation.clone());
    let image = optional_image(document.get("image"));
    let (Some(book), Some(_text), Some(nlt_translation)) = (book, text, nlt_translation) else {
        return Err(VodError::Fetch(
            "Firebase verse of the day is missing required fields (book/text)",
        ));
    };
    let verse_id = verse_id.unwrap_or_else(|| format!("firebase-vod-{today}-{}", random_id()));
    Ok(ScriptureData {
        book,
        date: today.to_owned(),
        st_book: js_slice(&st_book, ST_BOOK_LENGTH),
        text: nlt_translation.clone(),
        image,
        verse_id: Some(verse_id),
        nlt_translation,
    })
}

struct MemoryEntry {
    entry: CachedEntry,
    expires: Instant,
}

/// `VodService.getDailyVerse` with its two cache tiers.
pub struct VodService {
    documents: Arc<dyn DocumentSource>,
    store: Arc<dyn KeyValueStore>,
    timezone: Tz,
    clock: Clock,
    memory: Mutex<Option<MemoryEntry>>,
}

impl VodService {
    pub fn new(
        documents: Arc<dyn DocumentSource>,
        store: Arc<dyn KeyValueStore>,
        timezone: Tz,
        clock: Clock,
    ) -> Self {
        Self {
            documents,
            store,
            timezone,
            clock,
            memory: Mutex::new(None),
        }
    }

    pub async fn daily_verse(&self) -> Result<ScriptureData, VodError> {
        self.daily_verse_at(self.clock.now_ms()).await
    }

    /// The verse for the VOD day containing `now_ms`.
    async fn daily_verse_at(&self, now_ms: i64) -> Result<ScriptureData, VodError> {
        let today = today(now_ms, self.timezone);
        if let Some(data) = self.memory_get(&today) {
            tracing::debug!(operation = "getDailyVerse", "LRU cache hit");
            return Ok(data);
        }
        if let Some(data) = self.redis_get(&today).await {
            tracing::debug!(operation = "getDailyVerse", "Redis cache hit");
            self.memory_set(&data, &today);
            return Ok(data);
        }
        tracing::debug!(
            operation = "getDailyVerse",
            "Cache miss, fetching from Firebase"
        );
        let data = self.fetch(&today).await?;
        self.memory_set(&data, &today);
        self.redis_set(&data, &today).await;
        Ok(data)
    }

    /// `firebase.getDailyVerse` and `toScriptureData`.
    async fn fetch(&self, today: &str) -> Result<ScriptureData, VodError> {
        let document = match self
            .documents
            .get_document(VERSE_COLLECTION, VERSE_DOCUMENT)
            .await
        {
            Ok(Some(document)) => document,
            Ok(None) => return Err(VodError::NotFound),
            Err(error) => {
                tracing::warn!(error = %error, "Failed to fetch verse of the day from Firebase");
                return Err(VodError::Fetch(
                    "Failed to fetch verse of the day from Firebase",
                ));
            }
        };
        normalize(&document, today, || {
            uuid::Uuid::new_v4().simple().to_string()[..8].to_owned()
        })
    }

    /// The lru-cache entry (30 s, no `updateAgeOnGet`), served only when dated today.
    fn memory_get(&self, today: &str) -> Option<ScriptureData> {
        let mut memory = self.memory.lock().unwrap_or_else(PoisonError::into_inner);
        match memory.as_ref() {
            Some(cached) if cached.expires <= Instant::now() => {
                *memory = None;
                None
            }
            Some(cached) if cached.entry.is_fresh(today) => Some(cached.entry.data.clone()),
            _ => None,
        }
    }

    fn memory_set(&self, data: &ScriptureData, today: &str) {
        *self.memory.lock().unwrap_or_else(PoisonError::into_inner) = Some(MemoryEntry {
            entry: entry(data, today),
            expires: Instant::now() + MEMORY_TTL,
        });
    }

    /// `getFromRedis`: errors, unreadable JSON and entries not dated today are misses.
    async fn redis_get(&self, today: &str) -> Option<ScriptureData> {
        let raw = self
            .store
            .get(&self.store.key(REDIS_KEY))
            .await
            .ok()
            .flatten()?;
        serde_json::from_str::<CachedEntry>(&raw)
            .ok()
            .filter(|entry| entry.is_fresh(today))
            .map(|entry| entry.data)
    }

    /// `setToRedis`: `SETEX` of `{data, cachedAt, date}`; errors are ignored.
    async fn redis_set(&self, data: &ScriptureData, today: &str) {
        let Ok(json) = serde_json::to_string(&entry(data, today)) else {
            return;
        };
        let _ = self
            .store
            .set_ex(&self.store.key(REDIS_KEY), REDIS_TTL_SECONDS, &json)
            .await;
    }
}

/// `toEntry`.
fn entry(data: &ScriptureData, today: &str) -> CachedEntry {
    CachedEntry {
        data: data.clone(),
        // A JavaScript number; milliseconds since the epoch are exact in an f64.
        cached_at: now_ms() as f64,
        date: today.to_owned(),
    }
}

// `Scripture`. (No doc comment: it would become a GraphQL description.)
#[derive(Clone, Debug, PartialEq, Eq, SimpleObject)]
#[graphql(name = "Scripture")]
pub struct Scripture {
    /// The book name of the Bible verse
    pub book: Option<String>,
    /// The date for this verse
    pub date: Option<String>,
    /// Optional image associated with the verse
    pub image: Option<String>,
    /// Short book name or reference
    pub st_book: Option<String>,
    /// The actual verse text
    pub text: Option<String>,
    /// Unique identifier for the verse
    pub verse_id: Option<String>,
}

impl From<ScriptureData> for Scripture {
    fn from(data: ScriptureData) -> Self {
        Self {
            book: Some(data.book),
            date: Some(data.date),
            image: data.image,
            st_book: Some(data.st_book),
            text: Some(data.text),
            verse_id: data.verse_id,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, SimpleObject)]
pub struct VodFetchError {
    /// Error message describing what went wrong
    pub message: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, SimpleObject)]
pub struct VodNotFoundError {
    /// Error message when verse is not found
    pub message: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Union)]
pub enum VerseOfTheDayResult {
    Scripture(Scripture),
    VodFetchError(VodFetchError),
    VodNotFoundError(VodNotFoundError),
}

#[derive(Default)]
pub struct VodQuery;

#[Object]
impl VodQuery {
    /// Get the daily Bible verse with typed error handling
    #[graphql(name = "verseOfTheDayV2", guard = "Authorized")]
    async fn verse_of_the_day_v2(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Option<VerseOfTheDayResult>> {
        let vod = ctx.data::<Arc<VodService>>()?;
        Ok(Some(match vod.daily_verse().await {
            Ok(data) => VerseOfTheDayResult::Scripture(data.into()),
            Err(error @ VodError::Fetch(_)) => VerseOfTheDayResult::VodFetchError(VodFetchError {
                message: Some(error.to_string()),
            }),
            Err(error @ VodError::NotFound) => {
                VerseOfTheDayResult::VodNotFoundError(VodNotFoundError {
                    message: Some(error.to_string()),
                })
            }
        }))
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;
    use crate::store::kv::MemoryStore;
    use crate::test_support::{
        FakeDocuments, TestServices, execute_with_variables, schema_from, viewer,
    };

    const QUERY: &str = "query VerseOfTheDayQuery { verseOfTheDayV2 {
        __typename
        ... on Scripture { book date stBook text image verseId }
        ... on VodFetchError { message }
        ... on VodNotFoundError { message }
    } }";

    /// 2026-10-14T03:30:00Z: still 2026-10-13 in New York (EDT, UTC-4).
    const LATE_EVENING_MS: i64 = 1_791_948_600_000;

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

    /// A published verse (invented text), as the rotation writes it.
    fn published() -> Document {
        document(&[
            ("book", string("Example 1:1")),
            ("stBook", string("EXA.1.1")),
            ("text", string("Be kind to one another.")),
            ("image", string("https://example.com/example-1-1.jpg")),
            ("verseId", string("verse-example")),
            ("date", string("Tue Oct 13 2026")),
        ])
    }

    fn fixed_id() -> String {
        "0a1b2c3d".to_owned()
    }

    fn service(documents: Arc<FakeDocuments>, store: Arc<MemoryStore>) -> VodService {
        VodService::new(
            documents,
            store,
            chrono_tz::America::New_York,
            Clock::fixed(LATE_EVENING_MS),
        )
    }

    async fn run(services: &TestServices) -> Value {
        execute_with_variables(&schema_from(services), QUERY, Value::Null, Some(viewer())).await
    }

    #[test]
    fn dates_the_verse_in_the_vod_time_zone() {
        assert_eq!(
            today(LATE_EVENING_MS, chrono_tz::America::New_York),
            "2026-10-13"
        );
        assert_eq!(today(LATE_EVENING_MS, chrono_tz::UTC), "2026-10-14");
        assert_eq!(
            today(1_767_243_600_000, chrono_tz::America::New_York),
            "2026-01-01"
        );
    }

    #[test]
    fn normalizes_a_published_verse() {
        assert_eq!(
            normalize(&published(), "2026-10-13", fixed_id),
            Ok(ScriptureData {
                book: "Example 1:1".to_owned(),
                date: "2026-10-13".to_owned(),
                st_book: "EXA.1.1".to_owned(),
                text: "Be kind to one another.".to_owned(),
                image: Some("https://example.com/example-1-1.jpg".to_owned()),
                verse_id: Some("verse-example".to_owned()),
                nlt_translation: "Be kind to one another.".to_owned(),
            })
        );
    }

    #[test]
    fn prefers_the_nlt_translation_as_the_text() {
        let verse = normalize(
            &document(&[
                ("book", string("Example 2:2")),
                ("text", string("Older wording.")),
                ("nlt_translation", string("  Newer wording.  ")),
            ]),
            "2026-10-13",
            fixed_id,
        )
        .unwrap();
        assert_eq!(verse.text, "Newer wording.");
        assert_eq!(verse.nlt_translation, "Newer wording.");

        let only_translation = normalize(
            &document(&[
                ("book", string("Example 2:2")),
                ("nlt_translation", string("Newer wording.")),
            ]),
            "2026-10-13",
            fixed_id,
        )
        .unwrap();
        assert_eq!(only_translation.text, "Newer wording.");
    }

    #[test]
    fn requires_a_book_and_some_text() {
        let missing = Err(VodError::Fetch(
            "Firebase verse of the day is missing required fields (book/text)",
        ));
        for fields in [
            vec![("text", string("Be kind."))],
            vec![("book", string("   ")), ("text", string("Be kind."))],
            vec![("book", string("Example 3:3"))],
            vec![("book", string("Example 3:3")), ("text", string(" "))],
            // Non-string values are not strings to `readNonEmptyString`.
            vec![
                ("book", FirestoreValue::Other),
                ("text", string("Be kind.")),
            ],
            vec![
                ("book", string("Example 3:3")),
                ("text", FirestoreValue::Array(vec![string("Be kind.")])),
            ],
        ] {
            assert_eq!(
                normalize(&document(&fields), "2026-10-13", fixed_id),
                missing,
                "{fields:?}"
            );
        }
        assert_eq!(
            VodError::Fetch("Firebase verse of the day is missing required fields (book/text)")
                .to_string(),
            "VOD fetch: Firebase verse of the day is missing required fields (book/text)"
        );
    }

    #[test]
    fn falls_back_through_the_short_book_chain_and_cuts_it_to_twenty() {
        let st_book = |fields: Vec<(&str, FirestoreValue)>| {
            let mut fields = fields;
            fields.push(("text", string("Be kind.")));
            normalize(&document(&fields), "2026-10-13", fixed_id)
                .unwrap()
                .st_book
        };
        assert_eq!(
            st_book(vec![
                ("book", string("Example 4:4")),
                ("verseId", string("verse-4"))
            ]),
            "verse-4"
        );
        assert_eq!(
            st_book(vec![("book", string("Example 4:4"))]),
            "Example 4:4"
        );
        assert_eq!(
            st_book(vec![
                ("book", string("Example 4:4")),
                ("stBook", string("EXA.4.4 , EXA.4.5 , EXA.4.6"))
            ]),
            "EXA.4.4 , EXA.4.5 , "
        );
        assert_eq!(js_slice("short", 20), "short");
        // 19 ASCII units, then a surrogate pair cut after its first half.
        assert_eq!(
            js_slice("abcdefghijklmnopqrs\u{1F600}", 20),
            "abcdefghijklmnopqrs\u{FFFD}"
        );
    }

    #[test]
    fn reads_the_image_or_the_first_of_a_list() {
        let image = |value: FirestoreValue| {
            normalize(
                &document(&[
                    ("book", string("Example 5:5")),
                    ("text", string("Be kind.")),
                    ("image", value),
                ]),
                "2026-10-13",
                fixed_id,
            )
            .unwrap()
            .image
        };
        assert_eq!(
            image(FirestoreValue::Array(vec![
                string(" https://example.com/first.jpg "),
                string("https://example.com/second.jpg"),
            ])),
            Some("https://example.com/first.jpg".to_owned())
        );
        assert_eq!(
            image(FirestoreValue::Array(vec![
                string(""),
                string("https://example.com/second.jpg")
            ])),
            None
        );
        assert_eq!(image(FirestoreValue::Array(vec![])), None);
        assert_eq!(image(string("  ")), None);
        assert_eq!(image(FirestoreValue::Other), None);
    }

    #[test]
    fn makes_up_a_verse_id_when_the_document_has_none() {
        let verse = normalize(
            &document(&[
                ("book", string("Example 6:6")),
                ("text", string("Be kind.")),
            ]),
            "2026-10-13",
            fixed_id,
        )
        .unwrap();
        assert_eq!(
            verse.verse_id.as_deref(),
            Some("firebase-vod-2026-10-13-0a1b2c3d")
        );
    }

    #[tokio::test]
    async fn generates_eight_hex_digits_for_the_fallback_id() {
        let documents = Arc::new(FakeDocuments::default().with(
            VERSE_COLLECTION,
            VERSE_DOCUMENT,
            document(&[
                ("book", string("Example 6:6")),
                ("text", string("Be kind.")),
            ]),
        ));
        let verse = service(documents, Arc::new(MemoryStore::new("rs:")))
            .daily_verse()
            .await
            .unwrap();
        let id = verse.verse_id.unwrap();
        let suffix = id.strip_prefix("firebase-vod-2026-10-13-").unwrap();
        assert_eq!(suffix.len(), 8);
        assert!(suffix.chars().all(|c| c.is_ascii_hexdigit()));
    }

    // VodService.test.ts: "reads the verse from Firestore on a cold cache and never queries
    // Postgres" (Rust has no Postgres path at all).
    #[tokio::test]
    async fn reads_the_verse_from_firestore_on_a_cold_cache() {
        let documents =
            Arc::new(FakeDocuments::default().with(VERSE_COLLECTION, VERSE_DOCUMENT, published()));
        let verse = service(documents.clone(), Arc::new(MemoryStore::new("rs:")))
            .daily_verse()
            .await
            .unwrap();
        assert_eq!(verse.book, "Example 1:1");
        assert_eq!(verse.date, "2026-10-13");
        assert_eq!(documents.reads(), 1);
    }

    // VodService.test.ts: "serves repeat reads from the LRU, and other replicas from Redis".
    #[tokio::test]
    async fn serves_repeat_reads_from_memory_and_other_replicas_from_redis() {
        let documents =
            Arc::new(FakeDocuments::default().with(VERSE_COLLECTION, VERSE_DOCUMENT, published()));
        let store = Arc::new(MemoryStore::new("rs:"));
        let first = service(documents.clone(), store.clone());
        first.daily_verse().await.unwrap();
        let commands = store.commands();
        first.daily_verse().await.unwrap();
        assert_eq!(
            store.commands(),
            commands,
            "the repeat read stayed in memory"
        );
        let other = service(documents.clone(), store.clone());
        assert_eq!(other.daily_verse().await.unwrap().book, "Example 1:1");
        assert_eq!(documents.reads(), 1);

        let cached: Value =
            serde_json::from_str(&store.raw("rs:vod:verseOfTheDay:v2").unwrap()).unwrap();
        assert_eq!(cached["date"], "2026-10-13");
        assert!(cached["cachedAt"].as_f64().unwrap() > 0.0);
        assert_eq!(
            cached["data"],
            json!({
                "book": "Example 1:1",
                "date": "2026-10-13",
                "stBook": "EXA.1.1",
                "text": "Be kind to one another.",
                "nlt_translation": "Be kind to one another.",
                "verseId": "verse-example",
                "image": "https://example.com/example-1-1.jpg",
            })
        );
    }

    // VodService.test.ts: "ignores a cached verse from an earlier day".
    #[tokio::test]
    async fn ignores_a_redis_verse_from_an_earlier_day() {
        let documents =
            Arc::new(FakeDocuments::default().with(VERSE_COLLECTION, VERSE_DOCUMENT, published()));
        let store = Arc::new(MemoryStore::new("rs:"));
        store.insert_raw(
            "rs:vod:verseOfTheDay:v2",
            &json!({
                "data": {
                    "book": "Example 9:9", "date": "2000-01-01", "stBook": "EXA.9.9",
                    "text": "Old.", "nlt_translation": "Old.", "verseId": "verse-old"
                },
                "cachedAt": 1,
                "date": "2000-01-01",
            })
            .to_string(),
        );
        let verse = service(documents.clone(), store)
            .daily_verse()
            .await
            .unwrap();
        assert_eq!(verse.date, "2026-10-13");
        assert_eq!(verse.book, "Example 1:1");
        assert_eq!(documents.reads(), 1);
    }

    #[tokio::test]
    async fn serves_a_redis_entry_dated_today_without_reading_firestore() {
        let documents = Arc::new(FakeDocuments::default());
        let store = Arc::new(MemoryStore::new("rs:"));
        store.insert_raw(
            "rs:vod:verseOfTheDay:v2",
            &json!({
                "data": {
                    "book": "Example 7:7", "date": "2026-10-13", "stBook": "EXA.7.7",
                    "text": "Today.", "nlt_translation": "Today."
                },
                "cachedAt": 1,
                "date": "2026-10-13",
            })
            .to_string(),
        );
        let verse = service(documents.clone(), store)
            .daily_verse()
            .await
            .unwrap();
        assert_eq!(verse.book, "Example 7:7");
        assert_eq!(verse.verse_id, None);
        assert_eq!(documents.reads(), 0);
    }

    #[tokio::test]
    async fn treats_unreadable_or_incomplete_redis_entries_as_misses() {
        for raw in [
            "not json",
            "null",
            r#"{"data":{"book":"","date":"2026-10-13","stBook":"x","text":"t","nlt_translation":"t"},"cachedAt":1,"date":"2026-10-13"}"#,
            r#"{"data":{"book":"Example","date":"2026-10-13","stBook":"x","text":"t","nlt_translation":"t"},"cachedAt":0,"date":"2026-10-13"}"#,
        ] {
            let documents = Arc::new(FakeDocuments::default().with(
                VERSE_COLLECTION,
                VERSE_DOCUMENT,
                published(),
            ));
            let store = Arc::new(MemoryStore::new("rs:"));
            store.insert_raw("rs:vod:verseOfTheDay:v2", raw);
            let verse = service(documents.clone(), store)
                .daily_verse()
                .await
                .unwrap();
            assert_eq!(verse.book, "Example 1:1", "{raw}");
            assert_eq!(documents.reads(), 1, "{raw}");
        }
    }

    #[tokio::test]
    async fn ignores_a_memory_entry_from_an_earlier_day() {
        let documents =
            Arc::new(FakeDocuments::default().with(VERSE_COLLECTION, VERSE_DOCUMENT, published()));
        let store = Arc::new(MemoryStore::new("rs:"));
        let vod = service(documents.clone(), store.clone());
        vod.daily_verse().await.unwrap();
        // Half an hour later by the VOD clock it is past midnight in New York. The memory entry
        // has not expired (tokio's clock did not move) and Redis holds the same entry, but both
        // are dated the day before, so Firestore is read again.
        let next_day = vod
            .daily_verse_at(LATE_EVENING_MS + 30 * 60 * 1000)
            .await
            .unwrap();
        assert_eq!(next_day.date, "2026-10-14");
        assert_eq!(documents.reads(), 2);
    }

    // VodService.test.ts: "caches briefly, so replicas and hosts the rotation skips catch up".
    #[tokio::test(start_paused = true)]
    async fn caches_for_thirty_seconds_in_memory_and_ten_minutes_in_redis() {
        let documents =
            Arc::new(FakeDocuments::default().with(VERSE_COLLECTION, VERSE_DOCUMENT, published()));
        let store = Arc::new(MemoryStore::new("rs:"));
        let vod = service(documents.clone(), store.clone());
        vod.daily_verse().await.unwrap();
        assert_eq!(store.ttl("rs:vod:verseOfTheDay:v2").await.unwrap(), 600);

        let commands = store.commands();
        tokio::time::advance(MEMORY_TTL - Duration::from_millis(1)).await;
        vod.daily_verse().await.unwrap();
        assert_eq!(store.commands(), commands);
        tokio::time::advance(Duration::from_millis(1)).await;
        vod.daily_verse().await.unwrap();
        // The memory entry expired; one Redis GET (still fresh there) answered.
        assert_eq!(store.commands(), commands + 1);
        assert_eq!(documents.reads(), 1);
    }

    #[tokio::test]
    async fn falls_through_to_firestore_when_redis_is_down() {
        let documents =
            Arc::new(FakeDocuments::default().with(VERSE_COLLECTION, VERSE_DOCUMENT, published()));
        let store = Arc::new(MemoryStore::new("rs:"));
        store.set_failing(true);
        let vod = service(documents.clone(), store);
        assert_eq!(vod.daily_verse().await.unwrap().book, "Example 1:1");
        assert_eq!(vod.daily_verse().await.unwrap().book, "Example 1:1");
        assert_eq!(documents.reads(), 1);
    }

    #[tokio::test]
    async fn answers_the_scripture_through_the_union() {
        let services = TestServices {
            documents: Arc::new(FakeDocuments::default().with(
                VERSE_COLLECTION,
                VERSE_DOCUMENT,
                published(),
            )),
            clock: Clock::fixed(LATE_EVENING_MS),
            ..TestServices::default()
        };
        assert_eq!(
            run(&services).await,
            json!({ "data": { "verseOfTheDayV2": {
                "__typename": "Scripture",
                "book": "Example 1:1",
                "date": "2026-10-13",
                "stBook": "EXA.1.1",
                "text": "Be kind to one another.",
                "image": "https://example.com/example-1-1.jpg",
                "verseId": "verse-example",
            } } })
        );
    }

    // VodService.test.ts: "fails with VodNotFoundError when the Firestore document is missing".
    #[tokio::test]
    async fn answers_vod_not_found_error_without_the_document() {
        let services = TestServices::default();
        assert_eq!(
            run(&services).await,
            json!({ "data": { "verseOfTheDayV2": {
                "__typename": "VodNotFoundError",
                "message": "VOD not found: verse of the day (Firebase)",
            } } })
        );
        assert!(services.store.keys().is_empty());
    }

    #[tokio::test]
    async fn answers_vod_fetch_error_when_firestore_fails() {
        let services = TestServices {
            documents: Arc::new(FakeDocuments::failing()),
            ..TestServices::default()
        };
        assert_eq!(
            run(&services).await,
            json!({ "data": { "verseOfTheDayV2": {
                "__typename": "VodFetchError",
                "message": "VOD fetch: Failed to fetch verse of the day from Firebase",
            } } })
        );
        assert!(services.store.keys().is_empty());
    }

    #[tokio::test]
    async fn answers_vod_fetch_error_for_an_incomplete_document() {
        let services = TestServices {
            documents: Arc::new(FakeDocuments::default().with(
                VERSE_COLLECTION,
                VERSE_DOCUMENT,
                document(&[("book", string("Example 8:8"))]),
            )),
            ..TestServices::default()
        };
        assert_eq!(
            run(&services).await["data"]["verseOfTheDayV2"],
            json!({
                "__typename": "VodFetchError",
                "message": "VOD fetch: Firebase verse of the day is missing required fields (book/text)",
            })
        );
    }

    #[tokio::test]
    async fn requires_an_authorized_caller() {
        let services = TestServices::default();
        let body = execute_with_variables(&schema_from(&services), QUERY, Value::Null, None).await;
        assert_eq!(body["data"], json!({ "verseOfTheDayV2": null }));
        assert_eq!(
            body["errors"][0]["message"],
            "Not authorized to resolve Query.verseOfTheDayV2"
        );
    }

    #[tokio::test]
    async fn resolves_through_the_router_with_injected_documents() {
        use crate::google::GoogleAuth;
        use crate::graphql::auth::testing::{GoogleMock, anonymous_claims, sign};
        use crate::test_support::{TestApp, post_graphql_as};

        let mock = GoogleMock::start().await;
        mock.mount_jwks(1).await;
        mock.mount_account(1).await;
        let documents =
            Arc::new(FakeDocuments::default().with(VERSE_COLLECTION, VERSE_DOCUMENT, published()));
        let app = TestApp::with_dependencies(
            &mock,
            GoogleAuth::fixed("example-access-token"),
            |dependencies| dependencies.documents = Some(documents.clone()),
        );
        let response = app
            .send(post_graphql_as(
                json!({ "query": "query VerseOfTheDayQuery { verseOfTheDayV2 { ... on Scripture { book } } }" }),
                &sign(&anonymous_claims()),
            ))
            .await;
        assert_eq!(
            response.json(),
            json!({ "data": { "verseOfTheDayV2": { "book": "Example 1:1" } } })
        );
        assert_eq!(documents.reads(), 1);
        assert!(app.store.raw("rs:vod:verseOfTheDay:v2").is_some());
    }
}
