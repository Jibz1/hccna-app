//! The cache `CCBService.get` (`apps/server/src/effect/services/CCBService.ts`) keeps in front of
//! CCB, with the windows of `packages/ccb/src/cache-config.ts` applied as the parity spec says:
//!
//! - an answer is fresh for `ttl`; for `swr` more it is served at once while one background
//!   refresh per key runs; after that it is a miss;
//! - the first tier is an in-process moka cache of 2,000 entries (the TS LRU's size), the second
//!   is Redis under `rs:ccb:1:<query>`, holding `{"data": <record>, "cachedAt": <ms>}` for
//!   `ttl + swr`;
//! - a Redis failure or timeout (500 ms, the store's command timeout) is logged and counts as a
//!   miss or a skipped write, as in the Strapi record cache, so an outage leaves the in-process
//!   tier working;
//! - a failed load is returned and cached nowhere; a failed refresh keeps the stale entry.
//!
//! Deliberate differences from TS, which never reads `swr`:
//! - TS's LRU has no expiry, so it serves a stale entry for as long as it holds one and starts a
//!   refresh on every stale hit; here entries expire at `ttl + swr` and one refresh per key runs
//!   at a time;
//! - TS keeps Redis entries for `ttl` and restarts an entry's age when it copies the entry from
//!   Redis into the LRU; here Redis keeps entries for `ttl + swr` and the copy keeps its age;
//! - TS writes Redis in the background after a load; here the write is awaited (at most 500 ms);
//! - logs name the CCB service, never the key, which can hold an email.

use std::collections::HashSet;
use std::future::Future;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use tokio::time::Instant;

use super::CcbError;
use super::request::{CachePolicy, CcbRequest};
use crate::graphql::response_cache::now_ms;
use crate::store::kv::KeyValueStore;

/// Bump whenever a record's shape changes, so old entries miss instead of misreading.
pub const KEY_PREFIX: &str = "ccb:1";
/// `LRU_CACHE_MAX_SIZE`.
pub const MEMORY_MAX_ENTRIES: u64 = 2_000;

/// Milliseconds since the Unix epoch: the wall clock when built, advanced by tokio's clock since.
/// On paused time it stands still until a test calls `tokio::time::advance`, which also expires
/// the in-memory test store's entries.
#[derive(Clone, Copy, Debug)]
pub struct CacheClock {
    epoch_ms: u64,
    origin: Instant,
}

impl CacheClock {
    pub fn system() -> Self {
        Self::starting_at(now_ms())
    }

    pub fn starting_at(epoch_ms: u64) -> Self {
        Self {
            epoch_ms,
            origin: Instant::now(),
        }
    }

    pub fn now_ms(&self) -> u64 {
        let elapsed = u64::try_from(self.origin.elapsed().as_millis()).unwrap_or(u64::MAX);
        self.epoch_ms.saturating_add(elapsed)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Freshness {
    Fresh,
    Stale,
    Expired,
}

/// `isStale`: an entry is stale once its age exceeds `ttl`.
fn freshness(policy: CachePolicy, cached_at: u64, now: u64) -> Freshness {
    let age = Duration::from_millis(now.saturating_sub(cached_at));
    if age <= policy.ttl {
        Freshness::Fresh
    } else if age <= policy.ttl + policy.swr {
        Freshness::Stale
    } else {
        Freshness::Expired
    }
}

/// `CachedCCBEntry`, as written.
#[derive(Serialize)]
struct EntryOut<'a, T> {
    data: &'a T,
    #[serde(rename = "cachedAt")]
    cached_at: u64,
}

/// `CachedCCBEntry`, as read: the record stays raw until its type is known.
#[derive(Deserialize)]
struct EntryIn {
    data: Box<RawValue>,
    #[serde(rename = "cachedAt")]
    cached_at: u64,
}

/// A stored entry's record and freshness; `None` when it does not decode as `T`, a miss.
fn read<T: DeserializeOwned>(raw: &str, policy: CachePolicy, now: u64) -> Option<(T, Freshness)> {
    let entry: EntryIn = serde_json::from_str(raw).ok()?;
    let value = serde_json::from_str(entry.data.get()).ok()?;
    Some((value, freshness(policy, entry.cached_at, now)))
}

/// Both tiers. Cloning is cheap; clones share everything.
#[derive(Clone)]
pub struct CcbCache {
    memory: moka::future::Cache<String, Arc<str>>,
    store: Arc<dyn KeyValueStore>,
    clock: CacheClock,
    /// Keys whose background refresh is running.
    refreshing: Arc<Mutex<HashSet<String>>>,
}

impl CcbCache {
    pub fn new(store: Arc<dyn KeyValueStore>, clock: CacheClock) -> Self {
        Self {
            memory: moka::future::Cache::builder()
                .max_capacity(MEMORY_MAX_ENTRIES)
                .build(),
            store,
            clock,
            refreshing: Arc::default(),
        }
    }

    /// The answer to `request` from memory, else Redis, else `load`. A stale hit is returned at
    /// once and handed to [`Self::refresh`].
    pub async fn get<T, F, Fut>(&self, request: &CcbRequest, load: F) -> Result<T, CcbError>
    where
        T: Serialize + DeserializeOwned + Send + Sync + 'static,
        F: FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = Result<T, CcbError>> + Send + 'static,
    {
        let key = format!("{KEY_PREFIX}:{}", request.query());
        let policy = request.service().cache_policy();
        let action = request.service().srv();
        let now = self.clock.now_ms();

        if let Some(raw) = self.memory.get(&key).await {
            match read::<T>(&raw, policy, now) {
                Some((value, Freshness::Fresh)) => return Ok(value),
                Some((value, Freshness::Stale)) => {
                    self.refresh(key, policy, action, load);
                    return Ok(value);
                }
                Some((_, Freshness::Expired)) | None => self.memory.invalidate(&key).await,
            }
        }

        if let Some(raw) = self.redis_get(&key, action).await
            && let Some((value, freshness)) = read::<T>(&raw, policy, now)
            && freshness != Freshness::Expired
        {
            self.memory.insert(key.clone(), raw).await;
            if freshness == Freshness::Stale {
                self.refresh(key, policy, action, load);
            }
            return Ok(value);
        }

        let value = load().await?;
        self.put(&key, policy, action, &value).await;
        Ok(value)
    }

    /// Runs `load` in the background and stores what it returns, unless a refresh of `key` is
    /// already running. A failure is logged; the stale entry stays.
    fn refresh<T, F, Fut>(&self, key: String, policy: CachePolicy, action: &'static str, load: F)
    where
        T: Serialize + DeserializeOwned + Send + Sync + 'static,
        F: FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = Result<T, CcbError>> + Send + 'static,
    {
        let first = self
            .refreshing
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(key.clone());
        if !first {
            return;
        }
        let cache = self.clone();
        tokio::spawn(async move {
            let _running = Running {
                refreshing: cache.refreshing.clone(),
                key: key.clone(),
            };
            match load().await {
                Ok(value) => cache.put(&key, policy, action, &value).await,
                Err(error) => {
                    tracing::warn!(action, error = %error, "CCB background refresh failed");
                }
            }
        });
    }

    async fn redis_get(&self, key: &str, action: &'static str) -> Option<Arc<str>> {
        match self.store.get(&self.store.key(key)).await {
            Ok(raw) => raw.map(Arc::from),
            Err(error) => {
                tracing::warn!(action, error = %error, "CCB Redis cache read failed");
                None
            }
        }
    }

    /// Stores `value` in both tiers, cached now. Redis keeps it for `ttl + swr`.
    async fn put<T: Serialize>(
        &self,
        key: &str,
        policy: CachePolicy,
        action: &'static str,
        value: &T,
    ) {
        let entry = EntryOut {
            data: value,
            cached_at: self.clock.now_ms(),
        };
        let raw = match serde_json::to_string(&entry) {
            Ok(raw) => raw,
            Err(error) => {
                tracing::warn!(action, error = %error, "CCB cache encode failed");
                return;
            }
        };
        self.memory
            .insert(key.to_owned(), Arc::from(raw.as_str()))
            .await;
        let seconds = (policy.ttl + policy.swr).as_secs().max(1);
        if let Err(error) = self.store.set_ex(&self.store.key(key), seconds, &raw).await {
            tracing::warn!(action, error = %error, "CCB Redis cache write failed");
        }
    }
}

/// Clears a key's in-flight mark when its refresh ends, even if the refresh panics.
struct Running {
    refreshing: Arc<Mutex<HashSet<String>>>,
    key: String,
}

impl Drop for Running {
    fn drop(&mut self) {
        self.refreshing
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&self.key);
    }
}

#[cfg(test)]
mod tests {
    use std::pin::Pin;

    use super::*;
    use crate::store::kv::MemoryStore;
    use crate::strapi::record_cache::testing::LogCapture;

    #[derive(Debug, PartialEq, Serialize, Deserialize)]
    struct Value {
        n: u32,
    }

    /// 2026-09-21T14:13:20Z.
    const START: u64 = 1_790_000_000_000;
    const KEY: &str = "rs:ccb:1:srv=individual_search&email=ada%40example.com";
    /// `individual_search`'s windows.
    const TTL: Duration = Duration::from_secs(20 * 60);
    const SWR: Duration = Duration::from_secs(30 * 60);
    const MS: Duration = Duration::from_millis(1);

    type LoadFuture = Pin<Box<dyn Future<Output = Result<Value, CcbError>> + Send>>;

    /// Counts loads; each returns `{ n: <its call number> }` or fails.
    #[derive(Clone, Default)]
    struct Loads(Arc<Mutex<u32>>);

    impl Loads {
        fn start(&self) -> u32 {
            let mut calls = self.0.lock().unwrap();
            *calls += 1;
            *calls
        }

        /// A load that succeeds after `delay`.
        fn ok(&self, delay: Duration) -> impl FnOnce() -> LoadFuture + Send + 'static {
            let loads = self.clone();
            move || -> LoadFuture {
                Box::pin(async move {
                    let n = loads.start();
                    tokio::time::sleep(delay).await;
                    Ok(Value { n })
                })
            }
        }

        /// A load that fails like a CCB outage.
        fn failing(&self) -> impl FnOnce() -> LoadFuture + Send + 'static {
            let loads = self.clone();
            move || -> LoadFuture {
                Box::pin(async move {
                    loads.start();
                    Err(CcbError::Status { status: 503 })
                })
            }
        }

        fn calls(&self) -> u32 {
            *self.0.lock().unwrap()
        }
    }

    fn cache() -> (CcbCache, Arc<MemoryStore>) {
        let store = Arc::new(MemoryStore::new("rs:"));
        (
            CcbCache::new(store.clone(), CacheClock::starting_at(START)),
            store,
        )
    }

    fn request() -> CcbRequest {
        CcbRequest::individual_search("ada@example.com")
    }

    /// Lets spawned refreshes run: on paused time, the clock only moves once every task waits.
    async fn settle(for_at_least: Duration) {
        tokio::time::sleep(for_at_least + MS).await;
    }

    #[tokio::test(start_paused = true)]
    async fn loads_once_then_serves_memory_while_fresh() {
        let (cache, store) = cache();
        let loads = Loads::default();

        assert_eq!(
            cache.get(&request(), loads.ok(Duration::ZERO)).await,
            Ok(Value { n: 1 })
        );
        let commands = store.commands();
        tokio::time::advance(TTL).await;
        assert_eq!(
            cache.get(&request(), loads.ok(Duration::ZERO)).await,
            Ok(Value { n: 1 })
        );

        assert_eq!(loads.calls(), 1);
        assert_eq!(store.commands(), commands);
        assert_eq!(
            store.raw(KEY).as_deref(),
            Some(r#"{"data":{"n":1},"cachedAt":1790000000000}"#)
        );
        // Kept for ttl + swr (50 min), 20 of which have passed.
        assert_eq!(store.ttl(KEY).await.unwrap(), 30 * 60);
    }

    #[tokio::test(start_paused = true)]
    async fn serves_a_stale_entry_at_once_and_refreshes_it_in_the_background() {
        let (cache, store) = cache();
        let loads = Loads::default();
        cache
            .get(&request(), loads.ok(Duration::ZERO))
            .await
            .unwrap();

        tokio::time::advance(TTL + MS).await;
        assert_eq!(
            cache.get(&request(), loads.ok(Duration::ZERO)).await,
            Ok(Value { n: 1 })
        );
        settle(Duration::ZERO).await;

        assert_eq!(loads.calls(), 2);
        assert_eq!(
            cache.get(&request(), loads.ok(Duration::ZERO)).await,
            Ok(Value { n: 2 })
        );
        assert!(store.raw(KEY).unwrap().starts_with(r#"{"data":{"n":2},"#));
        assert_eq!(loads.calls(), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn loads_again_once_ttl_plus_swr_has_passed() {
        let (cache, _store) = cache();
        let loads = Loads::default();
        cache
            .get(&request(), loads.ok(Duration::ZERO))
            .await
            .unwrap();

        tokio::time::advance(TTL + SWR + MS).await;

        assert_eq!(
            cache.get(&request(), loads.ok(Duration::ZERO)).await,
            Ok(Value { n: 2 })
        );
        assert_eq!(loads.calls(), 2);
    }

    // Review Focus: concurrent stale hits for the same key start one refresh.
    #[tokio::test(start_paused = true)]
    async fn runs_one_refresh_per_key_for_concurrent_stale_hits() {
        let (cache, _store) = cache();
        let loads = Loads::default();
        cache
            .get(&request(), loads.ok(Duration::ZERO))
            .await
            .unwrap();
        tokio::time::advance(TTL + MS).await;

        let slow = Duration::from_millis(100);
        let ada = request();
        let (first, second) = tokio::join!(
            cache.get(&ada, loads.ok(slow)),
            cache.get(&ada, loads.ok(slow))
        );
        settle(slow / 2).await;
        // The refresh is still running: another stale hit starts nothing.
        let third = cache.get(&request(), loads.ok(slow)).await;
        settle(slow).await;

        assert_eq!(
            (first, second, third),
            (Ok(Value { n: 1 }), Ok(Value { n: 1 }), Ok(Value { n: 1 }))
        );
        assert_eq!(loads.calls(), 2);
        assert_eq!(
            cache.get(&request(), loads.ok(slow)).await,
            Ok(Value { n: 2 })
        );
    }

    #[tokio::test(start_paused = true)]
    async fn serves_an_entry_another_instance_wrote_to_redis_keeping_its_age() {
        let (cache, store) = cache();
        let loads = Loads::default();
        let age = (TTL + Duration::from_secs(60)).as_millis() as u64;
        store.insert_raw(
            KEY,
            &format!(r#"{{"data":{{"n":7}},"cachedAt":{}}}"#, START - age),
        );

        assert_eq!(
            cache.get(&request(), loads.ok(Duration::ZERO)).await,
            Ok(Value { n: 7 })
        );
        settle(Duration::ZERO).await;

        // 21 minutes old is stale: the copy kept its age, so a refresh ran.
        assert_eq!(loads.calls(), 1);
        assert_eq!(
            cache.get(&request(), loads.ok(Duration::ZERO)).await,
            Ok(Value { n: 1 })
        );
    }

    #[tokio::test(start_paused = true)]
    async fn keeps_a_fresh_redis_entry_in_memory() {
        let (cache, store) = cache();
        let loads = Loads::default();
        store.insert_raw(KEY, &format!(r#"{{"data":{{"n":7}},"cachedAt":{START}}}"#));

        assert_eq!(
            cache.get(&request(), loads.ok(Duration::ZERO)).await,
            Ok(Value { n: 7 })
        );
        store.set_failing(true);
        assert_eq!(
            cache.get(&request(), loads.ok(Duration::ZERO)).await,
            Ok(Value { n: 7 })
        );
        assert_eq!(loads.calls(), 0);
    }

    #[tokio::test(start_paused = true)]
    async fn treats_an_unreadable_entry_as_a_miss() {
        let (cache, store) = cache();
        let loads = Loads::default();
        store.insert_raw(KEY, r#"{"data":{"other":true},"cachedAt":1790000000000}"#);

        assert_eq!(
            cache.get(&request(), loads.ok(Duration::ZERO)).await,
            Ok(Value { n: 1 })
        );
        assert!(store.raw(KEY).unwrap().starts_with(r#"{"data":{"n":1},"#));
    }

    #[tokio::test(start_paused = true)]
    async fn caches_no_failed_load() {
        let (cache, store) = cache();
        let loads = Loads::default();

        assert_eq!(
            cache.get(&request(), loads.failing()).await,
            Err(CcbError::Status { status: 503 })
        );
        assert_eq!(store.raw(KEY), None);
        assert_eq!(
            cache.get(&request(), loads.ok(Duration::ZERO)).await,
            Ok(Value { n: 2 })
        );
    }

    /// A record that cannot be encoded, which no derived record can be.
    #[derive(Debug, PartialEq, Deserialize)]
    struct Unencodable;

    impl Serialize for Unencodable {
        fn serialize<S: serde::Serializer>(&self, _: S) -> Result<S::Ok, S::Error> {
            use serde::ser::Error as _;
            Err(S::Error::custom("cannot encode"))
        }
    }

    #[tokio::test(start_paused = true)]
    async fn logs_a_record_that_fails_to_encode_and_caches_it_nowhere() {
        let logs = LogCapture::default();
        let _guard = logs.install();
        let (cache, store) = cache();

        assert_eq!(
            cache.get(&request(), || async { Ok(Unencodable) }).await,
            Ok(Unencodable)
        );

        assert!(store.keys().is_empty());
        assert_eq!(
            logs.lines(),
            [
                r#"Warn CCB cache encode failed {"action":"individual_search","error":"cannot encode"}"#
            ]
        );
    }

    #[tokio::test(start_paused = true)]
    async fn keeps_serving_the_stale_entry_when_a_refresh_fails() {
        let logs = LogCapture::default();
        let _guard = logs.install();
        let (cache, _store) = cache();
        let loads = Loads::default();
        cache
            .get(&request(), loads.ok(Duration::ZERO))
            .await
            .unwrap();
        tokio::time::advance(TTL + MS).await;

        assert_eq!(
            cache.get(&request(), loads.failing()).await,
            Ok(Value { n: 1 })
        );
        settle(Duration::ZERO).await;
        assert_eq!(
            logs.lines(),
            [
                r#"Warn CCB background refresh failed {"action":"individual_search","error":"CCB API error: 503"}"#
            ]
        );

        // The failed refresh cleared its mark, so the next stale hit refreshes again.
        assert_eq!(
            cache.get(&request(), loads.ok(Duration::ZERO)).await,
            Ok(Value { n: 1 })
        );
        settle(Duration::ZERO).await;
        assert_eq!(loads.calls(), 3);
        assert_eq!(
            cache.get(&request(), loads.ok(Duration::ZERO)).await,
            Ok(Value { n: 3 })
        );
    }

    // Review Focus: a Redis outage degrades to the in-process cache.
    #[tokio::test(start_paused = true)]
    async fn serves_from_memory_when_redis_fails_logging_each_failure() {
        let logs = LogCapture::default();
        let _guard = logs.install();
        let (cache, store) = cache();
        store.set_failing(true);
        let loads = Loads::default();

        assert_eq!(
            cache.get(&request(), loads.ok(Duration::ZERO)).await,
            Ok(Value { n: 1 })
        );
        assert_eq!(
            cache.get(&request(), loads.ok(Duration::ZERO)).await,
            Ok(Value { n: 1 })
        );

        assert_eq!(loads.calls(), 1);
        assert_eq!(
            logs.lines(),
            [
                r#"Warn CCB Redis cache read failed {"action":"individual_search","error":"store unavailable"}"#,
                r#"Warn CCB Redis cache write failed {"action":"individual_search","error":"store unavailable"}"#,
            ]
        );
    }

    // Review Focus: a Redis outage in the middle of a refresh still refreshes memory.
    #[tokio::test(start_paused = true)]
    async fn refreshes_memory_when_redis_fails_during_the_refresh() {
        let (cache, store) = cache();
        let loads = Loads::default();
        cache
            .get(&request(), loads.ok(Duration::ZERO))
            .await
            .unwrap();
        store.set_failing(true);
        tokio::time::advance(TTL + MS).await;

        assert_eq!(
            cache.get(&request(), loads.ok(Duration::ZERO)).await,
            Ok(Value { n: 1 })
        );
        settle(Duration::ZERO).await;

        assert_eq!(
            cache.get(&request(), loads.ok(Duration::ZERO)).await,
            Ok(Value { n: 2 })
        );
        assert_eq!(loads.calls(), 2);
    }

    #[test]
    fn classifies_ages_against_the_windows() {
        let policy = CachePolicy {
            ttl: Duration::from_secs(5),
            swr: Duration::from_secs(10),
        };
        let at = |age_ms: u64| freshness(policy, START, START + age_ms);
        assert_eq!(
            [at(0), at(5_000), at(5_001), at(15_000), at(15_001)],
            [
                Freshness::Fresh,
                Freshness::Fresh,
                Freshness::Stale,
                Freshness::Stale,
                Freshness::Expired
            ]
        );
        // A clock behind the writer's counts as age zero.
        assert_eq!(freshness(policy, START, START - 1), Freshness::Fresh);
    }
}
