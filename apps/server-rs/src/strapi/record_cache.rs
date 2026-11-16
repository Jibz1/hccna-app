//! Two-tier cache of finished records (not raw CMS JSON), ported from
//! `apps/server/src/effect/services/cms/content/recordCache.ts`: an in-process cache (500
//! entries, 10 minutes) holding each record's JSON, then Redis, then the load. Every hit decodes
//! the JSON again, as the TS cache does. Redis read and write failures and timeouts (500 ms) are
//! logged and count as misses, so a Redis outage never fails or stalls a read.
//!
//! A load is cached only when the area's shared generation (bumped in Redis by a CMS change
//! notice) did not move while it ran; the TS cache's per-instance clear count and `clear` itself
//! are not ported, because no change notice or mutation reaches this server.
//!
//! Unlike the TS cache, concurrent misses for one key share a load: the first goes to Redis and
//! the source, and the rest wait for it and read what it cached (the parity spec's differences
//! table).

use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use serde::Serialize;
use serde::de::DeserializeOwned;

use crate::store::RedisStore;

/// Bump the version whenever a record's shape changes: old entries then miss instead of
/// misreading.
pub const KEY_PREFIX: &str = "cms-v5:3";
/// Each area's clear count across instances. Outside `KEY_PREFIX`, so a clear never deletes it.
pub const GENERATION_PREFIX: &str = "cms-v5:generation";
pub const MEMORY_MAX_ENTRIES: u64 = 500;
pub const MEMORY_TTL: Duration = Duration::from_secs(10 * 60);
pub const REDIS_TTL_SECONDS: u64 = 70 * 60;
/// A Redis that stops answering must not stall CMS reads: past this, a read is a miss and a
/// write is skipped, both logged like a Redis failure.
pub const REDIS_TIMEOUT: Duration = Duration::from_millis(500);

/// `CmsCacheArea`, for the areas this server reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CacheArea {
    Campuses,
    Events,
    Sermons,
    ThoughtOfGod,
}

impl CacheArea {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Campuses => "campuses",
            Self::Events => "events",
            Self::Sermons => "sermons",
            Self::ThoughtOfGod => "thoughtOfGod",
        }
    }
}

/// `RecordCacheKey`: a record's memory key (and, under the store's prefix, its Redis key), with
/// the area whose generation it follows.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecordCacheKey {
    pub area: CacheArea,
    pub key: String,
}

/// `recordCacheKey(area, parts)`: `cms-v5:3:<area>:<parts joined by "|">`, a missing part empty.
pub fn record_cache_key(area: CacheArea, parts: &[Option<&str>]) -> RecordCacheKey {
    let parts: Vec<&str> = parts.iter().map(|part| part.unwrap_or_default()).collect();
    RecordCacheKey {
        area,
        key: format!("{KEY_PREFIX}:{}:{}", area.as_str(), parts.join("|")),
    }
}

fn generation_key(area: CacheArea) -> String {
    format!("{GENERATION_PREFIX}:{}", area.as_str())
}

/// A shared-tier failure, logged as the `error` of a cache warning.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct StoreError(pub String);

/// The shared tier: Redis in production, an in-memory stand-in in tests.
pub trait SharedStore: Send + Sync + 'static {
    /// The full key for `suffix`, under this server's prefix (`RedisStore::key`).
    fn key(&self, suffix: &str) -> String;
    fn mget(
        &self,
        keys: Vec<String>,
    ) -> impl Future<Output = Result<Vec<Option<String>>, StoreError>> + Send;
    fn get(&self, key: String) -> impl Future<Output = Result<Option<String>, StoreError>> + Send;
    fn set_ex(
        &self,
        key: String,
        value: String,
        seconds: u64,
    ) -> impl Future<Output = Result<(), StoreError>> + Send;
}

impl SharedStore for RedisStore {
    fn key(&self, suffix: &str) -> String {
        RedisStore::key(self, suffix)
    }

    async fn mget(&self, keys: Vec<String>) -> Result<Vec<Option<String>>, StoreError> {
        let mut connection = self.connection().await.map_err(store_error)?;
        redis::cmd("MGET")
            .arg(keys)
            .query_async(&mut connection)
            .await
            .map_err(store_error)
    }

    async fn get(&self, key: String) -> Result<Option<String>, StoreError> {
        let mut connection = self.connection().await.map_err(store_error)?;
        redis::cmd("GET")
            .arg(key)
            .query_async(&mut connection)
            .await
            .map_err(store_error)
    }

    async fn set_ex(&self, key: String, value: String, seconds: u64) -> Result<(), StoreError> {
        let mut connection = self.connection().await.map_err(store_error)?;
        redis::cmd("SETEX")
            .arg(key)
            .arg(seconds)
            .arg(value)
            .query_async::<()>(&mut connection)
            .await
            .map_err(store_error)
    }
}

fn store_error(error: redis::RedisError) -> StoreError {
    StoreError(error.to_string())
}

/// One shared-tier call, bounded by `REDIS_TIMEOUT`: a failure or a timeout is logged as
/// `message` and is `None` (`tryRedis`).
async fn try_shared<T>(
    call: impl Future<Output = Result<T, StoreError>>,
    message: &'static str,
    key: &str,
) -> Option<T> {
    let error = match tokio::time::timeout(REDIS_TIMEOUT, call).await {
        Ok(Ok(value)) => return Some(value),
        Ok(Err(error)) => error.0,
        // Effect's `timeout` message, so both servers log the same text.
        Err(_) => format!(
            "Operation timed out after '{}ms'",
            REDIS_TIMEOUT.as_millis()
        ),
    };
    tracing::warn!(key, error, "{message}");
    None
}

/// One async lock per key that has a miss in progress.
#[derive(Default)]
struct KeyedLocks(Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>);

impl KeyedLocks {
    /// Waits until no other caller holds `key`, then holds it until the guard drops.
    async fn lock(&self, key: &str) -> KeyLock<'_> {
        let lock = self
            .0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .entry(key.to_owned())
            .or_default()
            .clone();
        KeyLock {
            locks: self,
            key: key.to_owned(),
            _held: lock.lock_owned().await,
        }
    }
}

/// A held key. Dropping it releases the key and forgets its lock when nobody waits for it.
struct KeyLock<'a> {
    locks: &'a KeyedLocks,
    key: String,
    _held: tokio::sync::OwnedMutexGuard<()>,
}

impl Drop for KeyLock<'_> {
    fn drop(&mut self) {
        // The map holds one reference to each lock, and every holder or waiter one more. This
        // key's lock goes when only this guard is left; another key's goes when only the map is
        // left, as after a waiter was cancelled.
        self.locks
            .0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .retain(|key, lock| Arc::strong_count(lock) > if *key == self.key { 2 } else { 1 });
    }
}

pub struct RecordCache<S: SharedStore = RedisStore> {
    memory: moka::future::Cache<String, Arc<str>>,
    shared: S,
    misses: KeyedLocks,
}

impl<S: SharedStore> RecordCache<S> {
    pub fn new(shared: S) -> Self {
        Self {
            memory: moka::future::Cache::builder()
                .max_capacity(MEMORY_MAX_ENTRIES)
                .time_to_live(MEMORY_TTL)
                .build(),
            shared,
            misses: KeyedLocks::default(),
        }
    }

    /// The memory tier's entry for `key`, if it decodes as `T`. Every hit decodes the stored JSON
    /// again, as the TS cache's Schema decode does.
    async fn memory_hit<T: DeserializeOwned>(&self, key: &str) -> Option<T> {
        let raw = self.memory.get(key).await?;
        serde_json::from_str(&raw).ok()
    }

    /// `cached(key, schema, load)`: the record from memory, else Redis, else `load`. A cached value
    /// that does not decode as `T` is a miss. A failed load is returned and cached nowhere.
    ///
    /// A miss waits for any miss on the same key already in progress, then checks memory again,
    /// so concurrent requests for a cold record make one load. A waiter whose predecessor cached
    /// nothing (a failed load, or a generation that moved) goes on to Redis and the source itself.
    pub async fn cached<T, E, F, Fut>(&self, key: &RecordCacheKey, load: F) -> Result<T, E>
    where
        T: Serialize + DeserializeOwned,
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<T, E>>,
    {
        if let Some(hit) = self.memory_hit(&key.key).await {
            return Ok(hit);
        }
        let _miss = self.misses.lock(&key.key).await;
        if let Some(hit) = self.memory_hit(&key.key).await {
            return Ok(hit);
        }

        let generation = generation_key(key.area);
        // One round trip: the entry, and the area's shared generation before any load.
        let read = try_shared(
            self.shared.mget(vec![
                self.shared.key(&key.key),
                self.shared.key(&generation),
            ]),
            "Strapi 5 cache read failed",
            &key.key,
        )
        .await;
        // `None` when the read failed; a missing counter means no clear yet: "0".
        let (from_redis, shared_before) = match read {
            Some(values) => {
                let mut values = values.into_iter();
                let entry = values.next().flatten();
                let counter = values.next().flatten().unwrap_or_else(|| "0".to_owned());
                (entry, Some(counter))
            }
            None => (None, None),
        };
        if let Some(raw) = from_redis
            && let Ok(hit) = serde_json::from_str(&raw)
        {
            self.memory.insert(key.key.clone(), Arc::from(raw)).await;
            return Ok(hit);
        }

        let fresh = load().await?;

        // The shared check runs only when both of its readings arrived.
        if let Some(before) = shared_before {
            let after = try_shared(
                self.shared.get(self.shared.key(&generation)),
                "Strapi 5 cache generation read failed",
                &generation,
            )
            .await;
            if after.is_some_and(|after| after.unwrap_or_else(|| "0".to_owned()) != before) {
                // A CMS change landed during the load, which may predate it: cache it nowhere.
                return Ok(fresh);
            }
        }
        let Ok(raw) = serde_json::to_string(&fresh) else {
            return Ok(fresh);
        };
        self.memory
            .insert(key.key.clone(), Arc::from(raw.as_str()))
            .await;
        try_shared(
            self.shared
                .set_ex(self.shared.key(&key.key), raw, REDIS_TTL_SECONDS),
            "Strapi 5 cache write failed",
            &key.key,
        )
        .await;
        Ok(fresh)
    }
}

#[cfg(test)]
pub(crate) mod testing {
    //! An in-memory shared store that can fail or stall, and a log capture.

    use super::*;
    use serde_json::{Map, Value};
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};
    use tracing::field::{Field, Visit};
    use tracing::subscriber::Interest;
    use tracing_subscriber::Layer;
    use tracing_subscriber::layer::{Context, SubscriberExt};

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub(crate) enum Mode {
        Working,
        /// Every call fails, like a Redis that refuses connections.
        Failing,
        /// The listed calls never answer.
        Stalled(&'static [&'static str]),
    }

    #[derive(Clone)]
    pub(crate) struct MemoryStore {
        pub(crate) entries: Arc<Mutex<HashMap<String, String>>>,
        mode: Mode,
    }

    impl MemoryStore {
        pub(crate) fn new(mode: Mode) -> Self {
            Self {
                entries: Arc::default(),
                mode,
            }
        }

        pub(crate) fn entry(&self, key: &str) -> Option<String> {
            self.entries.lock().unwrap().get(key).cloned()
        }

        pub(crate) fn set(&self, key: &str, value: &str) {
            self.entries
                .lock()
                .unwrap()
                .insert(key.to_owned(), value.to_owned());
        }

        async fn call<T>(&self, command: &str, run: impl FnOnce() -> T) -> Result<T, StoreError> {
            match self.mode {
                Mode::Failing => Err(StoreError(format!("Redis {command} failed"))),
                Mode::Stalled(commands) if commands.contains(&command) => {
                    std::future::pending().await
                }
                _ => Ok(run()),
            }
        }
    }

    impl SharedStore for MemoryStore {
        fn key(&self, suffix: &str) -> String {
            format!("rs:{suffix}")
        }

        async fn mget(&self, keys: Vec<String>) -> Result<Vec<Option<String>>, StoreError> {
            self.call("mget", || keys.iter().map(|key| self.entry(key)).collect())
                .await
        }

        async fn get(&self, key: String) -> Result<Option<String>, StoreError> {
            self.call("get", || self.entry(&key)).await
        }

        async fn set_ex(
            &self,
            key: String,
            value: String,
            _seconds: u64,
        ) -> Result<(), StoreError> {
            self.call("setex", || self.set(&key, &value)).await
        }
    }

    /// Captures this crate's events as `<Level> <message> <fields as JSON>`, like the TS tests'
    /// `captureLogs`. One global subscriber, installed once and interested only in this crate's
    /// events, writes to the capture each test thread sets: thread-scoped subscribers would race
    /// with tracing's per-callsite interest cache across parallel tests.
    #[derive(Clone, Default)]
    pub(crate) struct LogCapture(Arc<Mutex<Vec<String>>>);

    thread_local! {
        static SINK: RefCell<Option<Arc<Mutex<Vec<String>>>>> = const { RefCell::new(None) };
    }

    static GLOBAL: OnceLock<()> = OnceLock::new();

    /// Stops capturing on this thread when dropped.
    pub(crate) struct CaptureGuard;

    impl Drop for CaptureGuard {
        fn drop(&mut self) {
            SINK.with(|sink| sink.borrow_mut().take());
        }
    }

    impl LogCapture {
        /// Captures this thread's events until the guard drops.
        pub(crate) fn install(&self) -> CaptureGuard {
            GLOBAL.get_or_init(|| {
                tracing::subscriber::set_global_default(
                    tracing_subscriber::registry().with(ThreadSink),
                )
                .expect("no other test installs a global subscriber");
            });
            SINK.with(|sink| *sink.borrow_mut() = Some(self.0.clone()));
            CaptureGuard
        }

        pub(crate) fn lines(&self) -> Vec<String> {
            self.0.lock().unwrap().clone()
        }
    }

    struct ThreadSink;

    fn is_ours(metadata: &tracing::Metadata<'_>) -> bool {
        metadata.target().starts_with(env!("CARGO_CRATE_NAME"))
    }

    #[derive(Default)]
    struct Fields {
        message: String,
        fields: Map<String, Value>,
    }

    impl Visit for Fields {
        fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
            let text = format!("{value:?}");
            if field.name() == "message" {
                self.message = text;
            } else {
                self.fields
                    .insert(field.name().to_owned(), Value::String(text));
            }
        }

        fn record_str(&mut self, field: &Field, value: &str) {
            if field.name() == "message" {
                self.message = value.to_owned();
            } else {
                self.fields
                    .insert(field.name().to_owned(), Value::from(value));
            }
        }
    }

    impl<S: tracing::Subscriber> Layer<S> for ThreadSink {
        fn register_callsite(&self, metadata: &tracing::Metadata<'_>) -> Interest {
            if is_ours(metadata) {
                Interest::always()
            } else {
                Interest::never()
            }
        }

        fn enabled(&self, metadata: &tracing::Metadata<'_>, _: Context<'_, S>) -> bool {
            is_ours(metadata)
        }

        fn on_event(&self, event: &tracing::Event<'_>, _: Context<'_, S>) {
            if !is_ours(event.metadata()) {
                return;
            }
            let Some(sink) = SINK.with(|sink| sink.borrow().clone()) else {
                return;
            };
            let mut fields = Fields::default();
            event.record(&mut fields);
            let level = match *event.metadata().level() {
                tracing::Level::ERROR => "Error",
                tracing::Level::WARN => "Warn",
                tracing::Level::INFO => "Info",
                _ => "Debug",
            };
            sink.lock().unwrap().push(format!(
                "{level} {} {}",
                fields.message,
                Value::Object(fields.fields)
            ));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::testing::{LogCapture, MemoryStore, Mode};
    use super::*;
    use serde::Deserialize;
    use std::sync::Mutex;
    use tokio::time::Instant;

    #[derive(Debug, PartialEq, Serialize, Deserialize)]
    struct Value {
        n: u32,
    }

    const CAMPUSES_KEY: &str = "cms-v5:3:campuses:";
    const REDIS_CAMPUSES_KEY: &str = "rs:cms-v5:3:campuses:";
    const REDIS_GENERATION_KEY: &str = "rs:cms-v5:generation:campuses";

    fn campuses() -> RecordCacheKey {
        record_cache_key(CacheArea::Campuses, &[])
    }

    /// A load that counts its calls and returns `{ n: <call number> }`.
    #[derive(Clone, Default)]
    struct Counting(Arc<Mutex<u32>>);

    impl Counting {
        fn load(&self) -> impl Future<Output = Result<Value, String>> + use<> {
            let calls = self.0.clone();
            async move {
                let mut calls = calls.lock().unwrap();
                *calls += 1;
                Ok(Value { n: *calls })
            }
        }

        fn calls(&self) -> u32 {
            *self.0.lock().unwrap()
        }
    }

    #[test]
    fn builds_versioned_keys() {
        assert_eq!(
            campuses(),
            RecordCacheKey {
                area: CacheArea::Campuses,
                key: CAMPUSES_KEY.to_owned()
            }
        );
        assert_eq!(
            record_cache_key(
                CacheArea::Events,
                &[Some("house-of-stars"), None, Some("x"), Some("2")]
            )
            .key,
            "cms-v5:3:events:house-of-stars||x|2"
        );
        assert_eq!(
            record_cache_key(CacheArea::ThoughtOfGod, &[]).key,
            "cms-v5:3:thoughtOfGod:"
        );
    }

    #[tokio::test]
    async fn loads_once_then_serves_memory() {
        let store = MemoryStore::new(Mode::Working);
        let cache = RecordCache::new(store.clone());
        let source = Counting::default();

        let first = cache.cached(&campuses(), || source.load()).await;
        let second = cache.cached(&campuses(), || source.load()).await;

        assert_eq!((first, second), (Ok(Value { n: 1 }), Ok(Value { n: 1 })));
        assert_eq!(source.calls(), 1);
        assert_eq!(
            store.entry(REDIS_CAMPUSES_KEY).as_deref(),
            Some(r#"{"n":1}"#)
        );
    }

    /// `source`'s load, finishing after `millis` of (paused) time.
    fn slow_load(
        source: &Counting,
        millis: u64,
    ) -> impl Future<Output = Result<Value, String>> + use<> {
        let load = source.load();
        async move {
            tokio::time::sleep(Duration::from_millis(millis)).await;
            load.await
        }
    }

    #[tokio::test(start_paused = true)]
    async fn merges_concurrent_misses_for_one_key_into_one_load() {
        let cache = RecordCache::new(MemoryStore::new(Mode::Working));
        let source = Counting::default();
        let key = campuses();

        let (first, second) = tokio::join!(
            cache.cached(&key, || slow_load(&source, 100)),
            cache.cached(&key, || slow_load(&source, 100)),
        );

        assert_eq!((first, second), (Ok(Value { n: 1 }), Ok(Value { n: 1 })));
        assert_eq!(source.calls(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn forgets_a_keys_lock_once_its_misses_are_done() {
        let cache = RecordCache::new(MemoryStore::new(Mode::Working));
        let source = Counting::default();
        let key = campuses();

        // The second request gives up while it waits for the first one's load.
        let (first, abandoned) = tokio::join!(
            cache.cached(&key, || slow_load(&source, 100)),
            tokio::time::timeout(
                Duration::from_millis(50),
                cache.cached(&key, || slow_load(&source, 100)),
            ),
        );

        assert!(first.is_ok() && abandoned.is_err());
        assert!(cache.misses.0.lock().unwrap().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn loads_different_keys_at_the_same_time() {
        let cache = RecordCache::new(MemoryStore::new(Mode::Working));
        let source = Counting::default();
        let (campuses, events) = (
            campuses(),
            record_cache_key(CacheArea::Events, &[Some("house-of-stars")]),
        );
        let started = Instant::now();

        let (first, second) = tokio::join!(
            cache.cached(&campuses, || slow_load(&source, 100)),
            cache.cached(&events, || slow_load(&source, 100)),
        );

        assert!(first.is_ok() && second.is_ok());
        assert_eq!(source.calls(), 2);
        assert_eq!(started.elapsed(), Duration::from_millis(100));
    }

    #[tokio::test(start_paused = true)]
    async fn a_request_waiting_on_a_failed_load_loads_for_itself() {
        let cache = RecordCache::new(MemoryStore::new(Mode::Working));
        let source = Counting::default();
        let failing = || async {
            tokio::time::sleep(Duration::from_millis(100)).await;
            Err::<Value, String>("Strapi answered 500".to_owned())
        };
        let key = campuses();

        let (first, second) = tokio::join!(
            cache.cached(&key, failing),
            cache.cached(&key, || slow_load(&source, 100)),
        );

        assert_eq!(first, Err("Strapi answered 500".to_owned()));
        assert_eq!(second, Ok(Value { n: 1 }));
    }

    #[tokio::test]
    async fn serves_an_entry_another_instance_wrote_to_redis_and_keeps_it_in_memory() {
        let store = MemoryStore::new(Mode::Working);
        store.set(REDIS_CAMPUSES_KEY, r#"{"n":42}"#);
        let cache = RecordCache::new(store.clone());
        let source = Counting::default();

        let first = cache.cached(&campuses(), || source.load()).await;
        // Memory now holds it: a vanished Redis entry no longer matters.
        store.entries.lock().unwrap().clear();
        let second = cache.cached(&campuses(), || source.load()).await;

        assert_eq!((first, second), (Ok(Value { n: 42 }), Ok(Value { n: 42 })));
        assert_eq!(source.calls(), 0);
    }

    #[tokio::test]
    async fn treats_an_unreadable_cached_value_as_a_miss() {
        #[derive(Serialize, Deserialize)]
        struct Other {
            other: String,
        }
        let store = MemoryStore::new(Mode::Working);
        let cache = RecordCache::new(store.clone());
        let source = Counting::default();

        let _: Result<Other, String> = cache
            .cached(&campuses(), || async {
                Ok(Other {
                    other: "x".to_owned(),
                })
            })
            .await;
        let read = cache.cached(&campuses(), || source.load()).await;

        assert_eq!(read, Ok(Value { n: 1 }));
        assert_eq!(
            store.entry(REDIS_CAMPUSES_KEY).as_deref(),
            Some(r#"{"n":1}"#)
        );
    }

    #[tokio::test]
    async fn does_not_cache_a_failed_load() {
        let store = MemoryStore::new(Mode::Working);
        let cache = RecordCache::new(store.clone());
        let source = Counting::default();

        let failed: Result<Value, String> = cache
            .cached(&campuses(), || async { Err("Strapi is down".to_owned()) })
            .await;
        assert_eq!(store.entry(REDIS_CAMPUSES_KEY), None);
        let next = cache.cached(&campuses(), || source.load()).await;

        assert_eq!(failed, Err("Strapi is down".to_owned()));
        assert_eq!(next, Ok(Value { n: 1 }));
    }

    // Review Focus: Redis down on Railway must still serve CMS data.
    #[tokio::test]
    async fn serves_from_the_source_when_redis_fails_then_from_memory_logging_each_failure() {
        let logs = LogCapture::default();
        let _guard = logs.install();
        let cache = RecordCache::new(MemoryStore::new(Mode::Failing));
        let source = Counting::default();

        let first = cache.cached(&campuses(), || source.load()).await;
        let second = cache.cached(&campuses(), || source.load()).await;

        assert_eq!((first, second), (Ok(Value { n: 1 }), Ok(Value { n: 1 })));
        assert_eq!(source.calls(), 1);
        assert_eq!(
            logs.lines(),
            [
                format!(
                    r#"Warn Strapi 5 cache read failed {{"key":"{CAMPUSES_KEY}","error":"Redis mget failed"}}"#
                ),
                format!(
                    r#"Warn Strapi 5 cache write failed {{"key":"{CAMPUSES_KEY}","error":"Redis setex failed"}}"#
                ),
            ]
        );
    }

    /// Reads campuses with a load that bumps `generation_key`'s counter in Redis while it runs, as
    /// a CMS change notice handled by the TS server would. Returns the read's value, what Redis
    /// then holds, and a second read's value with the number of loads both reads made.
    async fn read_across_a_bump(
        bumped: &'static str,
        start: Option<&str>,
    ) -> (
        Result<Value, String>,
        Option<String>,
        Result<Value, String>,
        u32,
    ) {
        let store = MemoryStore::new(Mode::Working);
        if let Some(start) = start {
            store.set(bumped, start);
        }
        let cache = RecordCache::new(store.clone());
        let source = Counting::default();
        let during = store.clone();
        let first = cache
            .cached(&campuses(), || {
                let next = during
                    .entry(bumped)
                    .map_or(1, |value| value.parse::<u32>().unwrap() + 1);
                during.set(bumped, &next.to_string());
                source.load()
            })
            .await;
        let in_redis = store.entry(REDIS_CAMPUSES_KEY);
        let next = cache.cached(&campuses(), || source.load()).await;
        (first, in_redis, next, source.calls())
    }

    // Review Focus: a load that started before a CMS change must not be cached after it.
    #[tokio::test]
    async fn returns_the_loads_data_but_caches_it_nowhere_when_its_generation_moves() {
        assert_eq!(
            read_across_a_bump(REDIS_GENERATION_KEY, None).await,
            (Ok(Value { n: 1 }), None, Ok(Value { n: 2 }), 2)
        );
        assert_eq!(
            read_across_a_bump(REDIS_GENERATION_KEY, Some("4")).await,
            (Ok(Value { n: 1 }), None, Ok(Value { n: 2 }), 2)
        );
    }

    #[tokio::test]
    async fn caches_the_load_when_another_areas_generation_moves() {
        assert_eq!(
            read_across_a_bump("rs:cms-v5:generation:events", None).await,
            (
                Ok(Value { n: 1 }),
                Some(r#"{"n":1}"#.to_owned()),
                Ok(Value { n: 1 }),
                1
            )
        );
    }

    const TIMED_OUT: &str = "Operation timed out after '500ms'";

    /// A cold read and then a warm read on paused time against a store stalling `commands`: each
    /// read's virtual duration and value, the loads, and the logs.
    async fn read_on_paused_time(
        commands: &'static [&'static str],
    ) -> ((Duration, Value), (Duration, Value), u32, Vec<String>) {
        let logs = LogCapture::default();
        let _guard = logs.install();
        let cache = RecordCache::new(MemoryStore::new(Mode::Stalled(commands)));
        let source = Counting::default();
        let timed = async || {
            let start = Instant::now();
            let value = cache.cached(&campuses(), || source.load()).await.unwrap();
            (start.elapsed(), value)
        };
        let cold = timed().await;
        let warm = timed().await;
        (cold, warm, source.calls(), logs.lines())
    }

    fn read_timed_out() -> String {
        format!(
            r#"Warn Strapi 5 cache read failed {{"key":"{CAMPUSES_KEY}","error":"{TIMED_OUT}"}}"#
        )
    }

    fn write_timed_out() -> String {
        format!(
            r#"Warn Strapi 5 cache write failed {{"key":"{CAMPUSES_KEY}","error":"{TIMED_OUT}"}}"#
        )
    }

    // Review Focus: a Redis that stops answering (rather than failing) must not stall CMS reads.
    #[tokio::test(start_paused = true)]
    async fn stops_waiting_for_a_redis_read_after_500_ms_and_loads_from_the_source() {
        assert_eq!(
            read_on_paused_time(&["mget"]).await,
            (
                (Duration::from_millis(500), Value { n: 1 }),
                (Duration::ZERO, Value { n: 1 }),
                1,
                vec![read_timed_out()]
            )
        );
    }

    #[tokio::test(start_paused = true)]
    async fn stops_waiting_for_a_redis_write_after_500_ms_and_still_returns_the_data() {
        assert_eq!(
            read_on_paused_time(&["setex"]).await,
            (
                (Duration::from_millis(500), Value { n: 1 }),
                (Duration::ZERO, Value { n: 1 }),
                1,
                vec![write_timed_out()]
            )
        );
    }

    #[tokio::test(start_paused = true)]
    async fn bounds_a_cold_read_at_1_s_when_redis_stops_answering_entirely() {
        assert_eq!(
            read_on_paused_time(&["mget", "get", "setex"]).await,
            (
                (Duration::from_millis(1000), Value { n: 1 }),
                (Duration::ZERO, Value { n: 1 }),
                1,
                vec![read_timed_out(), write_timed_out()]
            )
        );
    }

    #[tokio::test(start_paused = true)]
    async fn still_caches_when_the_generation_read_after_the_load_stalls() {
        // The generation read after the load times out: no reading means no move, so the load
        // is cached (the shared check runs only when both readings arrived).
        let ((cold, _), (warm, _), loads, logs) = read_on_paused_time(&["get"]).await;
        assert_eq!(
            (cold, warm, loads),
            (Duration::from_millis(500), Duration::ZERO, 1)
        );
        assert_eq!(
            logs,
            [format!(
                r#"Warn Strapi 5 cache generation read failed {{"key":"cms-v5:generation:campuses","error":"{TIMED_OUT}"}}"#
            )]
        );
    }
}
