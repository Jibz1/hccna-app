//! `GivingService` (`apps/server/src/effect/services/GivingService.ts`): a member's giving for the
//! current year and the four before it, each year read from the first tier that has it.
//!
//! 1. The in-process LRU (1,000 entries).
//! 2. Redis, `rs:donations-v3:<user id>:<family id>:<ccb id>:<year>`.
//! 3. Postgres: the year's summary in `donation_yearly_summaries` and its `donations` rows. A
//!    summary is a miss when it is missing, recorded for another CCB individual, flagged stale, or
//!    synced before the latest weekly refresh; rows that disagree with their summary flag it stale.
//! 4. CCB, read past the CCB client's own cache, with the year then rewritten in Postgres and
//!    cached in Redis in the background (2 minutes each at most).
//!
//! Every tier keeps a year until the next weekly refresh (`refresh.rs`). A tier hit warms the tiers
//! above it. Cached values that do not decode, or whose gifts disagree with their count or total,
//! are deleted and read as misses. Redis errors are misses or skipped writes; a Postgres read error,
//! a CCB failure or invalid CCB data fails the request.
//!
//! Differences from TS: the LRU holds only giving (TS shares its 1,000 entries across features);
//! Redis keys and values are this server's own (`rs:` prefix, no `source` or `cachedAt` fields);
//! the current year is the UTC year (TS reads the process time zone, UTC on Railway).

use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Datelike};
use serde::{Deserialize, Serialize};

use super::parse::{Gift, ParseGivingError, parse_giving};
use super::refresh::{last_giving_refresh, redis_ttl_seconds, until_next_giving_refresh};
use super::store::{DonationRow, GivingStore, GivingStoreError, GivingUser, SummaryRow, YearSync};
use crate::ccb::{CcbClient, CcbError};
use crate::fields::Clock;
use crate::store::kv::KeyValueStore;
use crate::strapi::js;

/// `REDIS_PREFIX`. v3: v2 payloads could hold gifts from other years.
pub const REDIS_PREFIX: &str = "donations-v3";
/// The TS `LRUService`'s default size (`LRU_CACHE_MAX`).
pub const MEMORY_MAX_ENTRIES: u64 = 1_000;
/// `BACKGROUND_CACHE_TIMEOUT`.
pub const BACKGROUND_TIMEOUT: Duration = Duration::from_secs(2 * 60);
/// The current year and the four before it.
pub const YEARS: usize = 5;

/// `DonationCacheResult` without `source` and `cachedAt`, which no field exposes.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YearGiving {
    pub giving: Vec<Gift>,
    pub total: f64,
    pub number_of_giving: u32,
    pub ccb_id: String,
    pub year: i32,
}

#[derive(Debug, thiserror::Error)]
pub enum GivingError {
    #[error("CCB is not configured")]
    CcbNotConfigured,
    #[error(transparent)]
    Ccb(#[from] CcbError),
    #[error("Invalid giving data received from CCB: {0}")]
    InvalidCcbData(#[from] ParseGivingError),
    #[error("DB {query} query failed: {source}")]
    Store {
        query: &'static str,
        source: GivingStoreError,
    },
}

/// The member and year a cached result belongs to (`DonationCacheIdentity`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GivingIdentity {
    pub user_id: String,
    pub ccb_family_id: String,
    pub ccb_id: String,
    pub year: i32,
}

impl GivingIdentity {
    /// `getCacheKey`, before this server's prefix.
    fn cache_key(&self) -> String {
        format!(
            "{REDIS_PREFIX}:{}:{}:{}:{}",
            self.user_id, self.ccb_family_id, self.ccb_id, self.year
        )
    }
}

struct MemoryEntry {
    year: YearGiving,
    expires_ms: i64,
}

pub struct GivingService {
    store: Arc<dyn GivingStore>,
    kv: Arc<dyn KeyValueStore>,
    ccb: Option<CcbClient>,
    clock: Clock,
    memory: moka::sync::Cache<String, Arc<MemoryEntry>>,
}

impl GivingService {
    pub fn new(
        store: Arc<dyn GivingStore>,
        kv: Arc<dyn KeyValueStore>,
        ccb: Option<CcbClient>,
        clock: Clock,
    ) -> Self {
        Self {
            store,
            kv,
            ccb,
            clock,
            memory: moka::sync::Cache::builder()
                .max_capacity(MEMORY_MAX_ENTRIES)
                .build(),
        }
    }

    /// `getCurrentGivingUser`.
    pub async fn giving_user(&self, firebase_uid: &str) -> Result<Option<GivingUser>, GivingError> {
        self.store
            .giving_user(firebase_uid)
            .await
            .map_err(|source| GivingError::Store {
                query: "user",
                source,
            })
    }

    /// `getPreviousFiveYears`: this year first. The years load concurrently; the first failure
    /// fails the whole answer and drops the others' reads.
    pub async fn previous_five_years(
        &self,
        user_id: &str,
        ccb_family_id: &str,
        ccb_id: &str,
    ) -> Result<Vec<YearGiving>, GivingError> {
        tracing::info!(yearCount = YEARS, "Starting getPreviousFiveYearsGivingV2");
        let current_year =
            DateTime::from_timestamp_millis(self.clock.now_ms()).map_or(1970, |now| now.year());
        let [a, b, c, d, e] = [0, 1, 2, 3, 4].map(|back| {
            self.yearly(GivingIdentity {
                user_id: user_id.to_owned(),
                ccb_family_id: ccb_family_id.to_owned(),
                ccb_id: ccb_id.to_owned(),
                year: current_year - back,
            })
        });
        let (a, b, c, d, e) = tokio::try_join!(a, b, c, d, e)?;
        tracing::info!(yearCount = YEARS, "Completed getPreviousFiveYearsGivingV2");
        Ok(vec![a, b, c, d, e])
    }

    /// `getYearlyDonations`.
    async fn yearly(&self, identity: GivingIdentity) -> Result<YearGiving, GivingError> {
        let key = identity.cache_key();
        if let Some(year) = self.memory_get(&key, identity.year) {
            return Ok(year);
        }
        if let Some(year) = self.redis_get(&key, identity.year).await {
            self.memory_set(&key, &year);
            return Ok(year);
        }
        if let Some(year) = self.db_get(&identity).await? {
            self.memory_set(&key, &year);
            self.spawn_redis_set(key, &year, false);
            return Ok(year);
        }
        let year = self.fetch_and_persist(&identity).await?;
        self.memory_set(&key, &year);
        Ok(year)
    }

    /// `checkLruCache`.
    fn memory_get(&self, key: &str, year: i32) -> Option<YearGiving> {
        let entry = self.memory.get(key)?;
        if entry.expires_ms <= self.clock.now_ms() {
            self.memory.invalidate(key);
            return None;
        }
        tracing::debug!(layer = "lru-cache", year, "LRU cache hit");
        if !is_consistent(&entry.year) {
            tracing::warn!(
                layer = "lru-cache",
                year,
                "Invalid LRU donations cache payload"
            );
            self.memory.invalidate(key);
            return None;
        }
        Some(entry.year.clone())
    }

    /// `setLruCache`: until the next weekly refresh.
    fn memory_set(&self, key: &str, year: &YearGiving) {
        let now = self.clock.now_ms();
        let ttl = i64::try_from(until_next_giving_refresh(now).as_millis()).unwrap_or(i64::MAX);
        self.memory.insert(
            key.to_owned(),
            Arc::new(MemoryEntry {
                year: year.clone(),
                expires_ms: now.saturating_add(ttl),
            }),
        );
    }

    /// `checkRedis`.
    async fn redis_get(&self, key: &str, year: i32) -> Option<YearGiving> {
        let key = self.kv.key(key);
        let cached = self.kv.get(&key).await.ok().flatten()?;
        let Ok(value) = serde_json::from_str::<YearGiving>(&cached) else {
            let _ = self.kv.del(&key).await;
            tracing::warn!(
                layer = "redis",
                cachedSize = cached.len(),
                "Invalid Redis donations cache value"
            );
            return None;
        };
        tracing::debug!(layer = "redis", year, "Redis cache hit");
        if !is_consistent(&value) {
            tracing::warn!(
                layer = "redis",
                year,
                "Invalid Redis donations cache payload"
            );
            let _ = self.kv.del(&key).await;
            return None;
        }
        Some(value)
    }

    /// Writes `year` to Redis in the background; `log_failure` as on the CCB path (the DB path's
    /// warm-up fails silently).
    fn spawn_redis_set(&self, key: String, year: &YearGiving, log_failure: bool) {
        let Ok(value) = serde_json::to_string(year) else {
            return;
        };
        let kv = self.kv.clone();
        let ttl_seconds = redis_ttl_seconds(self.clock.now_ms());
        let year = year.year;
        tokio::spawn(async move {
            let key = kv.key(&key);
            let write =
                tokio::time::timeout(BACKGROUND_TIMEOUT, kv.set_ex(&key, ttl_seconds, &value));
            match write.await {
                Ok(Ok(())) => {
                    tracing::debug!(
                        layer = "redis",
                        year,
                        ttlSeconds = ttl_seconds,
                        "Cached to Redis"
                    );
                }
                Ok(Err(error)) if log_failure => tracing::error!(
                    layer = "redis",
                    year,
                    ttlSeconds = ttl_seconds,
                    error = %error,
                    "Failed to cache giving result to Redis"
                ),
                Err(_) if log_failure => tracing::error!(
                    layer = "redis",
                    year,
                    ttlSeconds = ttl_seconds,
                    error = "timed out",
                    "Failed to cache giving result to Redis"
                ),
                _ => {}
            }
        });
    }

    /// `checkDb`.
    async fn db_get(&self, identity: &GivingIdentity) -> Result<Option<YearGiving>, GivingError> {
        let GivingIdentity {
            user_id,
            ccb_id,
            year,
            ..
        } = identity;
        let summary =
            self.store
                .summary(user_id, *year)
                .await
                .map_err(|source| GivingError::Store {
                    query: "summary",
                    source,
                })?;
        let now = self.clock.now_ms();
        // Rows cached for another CCB individual (before a relink, or before ccb_id was recorded)
        // are not this member's giving.
        let Some(summary) = summary.filter(|summary| {
            summary.ccb_id.as_deref() == Some(ccb_id.as_str())
                && !summary.is_stale
                && summary.last_synced_at_ms >= last_giving_refresh(now)
        }) else {
            tracing::debug!(layer = "db", year, "DB cache miss or stale/invalidated");
            return Ok(None);
        };
        let rows = self
            .store
            .donations(user_id, *year)
            .await
            .map_err(|source| GivingError::Store {
                query: "donations",
                source,
            })?;
        tracing::debug!(
            layer = "db",
            year,
            donationCount = rows.len(),
            "DB cache hit"
        );
        if !summary_matches(&summary, &rows) {
            tracing::warn!(
                layer = "db",
                year,
                "DB donation summary mismatch detected, forcing CCB refetch"
            );
            if let Err(error) = self.store.mark_stale(user_id, *year, now).await {
                tracing::error!(layer = "db", year, error = %error, "Failed to mark DB cache as stale");
            }
            return Ok(None);
        }
        Ok(Some(YearGiving {
            giving: rows.iter().map(gift_from_row).collect(),
            total: js_number(&summary.total_amount),
            number_of_giving: u32::try_from(summary.number_of_donations).unwrap_or(0),
            ccb_id: ccb_id.clone(),
            year: *year,
        }))
    }

    /// `fetchAndPersist`.
    async fn fetch_and_persist(
        &self,
        identity: &GivingIdentity,
    ) -> Result<YearGiving, GivingError> {
        let GivingIdentity {
            user_id,
            ccb_family_id,
            ccb_id,
            year,
        } = identity;
        let started = self.clock.now_ms();
        tracing::info!(layer = "ccb", year, "Fetching from CCB API");
        let ccb = self.ccb.as_ref().ok_or(GivingError::CcbNotConfigured)?;
        let answer = ccb
            .transactions_by_family_uncached(ccb_family_id, *year)
            .await?;
        let rows = dedupe(
            parse_giving(&answer, ccb_id, *year)?
                .into_iter()
                .map(row_from_gift)
                .collect(),
        );
        let cents: i64 = rows
            .iter()
            .map(|row| to_cents(js_number(&row.amount)))
            .sum();
        let total_amount = fixed_two(cents);
        let result = YearGiving {
            giving: rows.iter().map(gift_from_row).collect(),
            total: js_number(&total_amount),
            number_of_giving: u32::try_from(rows.len()).unwrap_or(u32::MAX),
            ccb_id: ccb_id.clone(),
            year: *year,
        };
        let donation_count = rows.len();

        let synced_at_ms = self.clock.now_ms();
        let sync = YearSync {
            user_id: user_id.clone(),
            year: *year,
            ccb_id: ccb_id.clone(),
            rows,
            total_amount,
            synced_at_ms,
            duration_ms: i32::try_from(synced_at_ms - started).unwrap_or(i32::MAX),
        };
        let store = self.store.clone();
        let year_number = *year;
        tokio::spawn(async move {
            match tokio::time::timeout(BACKGROUND_TIMEOUT, store.replace_year(&sync)).await {
                Ok(Ok(())) => {
                    tracing::debug!(
                        layer = "db",
                        year = year_number,
                        donationCount = donation_count,
                        "Persisted to DB"
                    );
                }
                Ok(Err(error)) => tracing::error!(
                    layer = "db",
                    year = year_number,
                    donationCount = donation_count,
                    error = %error,
                    "Failed to persist giving cache to DB"
                ),
                Err(_) => tracing::error!(
                    layer = "db",
                    year = year_number,
                    donationCount = donation_count,
                    error = "timed out",
                    "Failed to persist giving cache to DB"
                ),
            }
        });
        self.spawn_redis_set(identity.cache_key(), &result, true);

        tracing::info!(
            layer = "ccb",
            year,
            donationCount = result.giving.len(),
            total = result.total,
            durationMs = self.clock.now_ms() - started,
            "CCB fetch complete"
        );
        Ok(result)
    }
}

/// `Number(text)` for the numeric text Postgres and `String(number)` produce.
fn js_number(text: &str) -> f64 {
    text.trim().parse().unwrap_or(f64::NAN)
}

/// `toCents`: `Math.round(amount * 100)`, ties toward +∞.
fn to_cents(amount: f64) -> i64 {
    let scaled = amount * 100.0;
    let floor = scaled.floor();
    (if scaled - floor >= 0.5 {
        floor + 1.0
    } else {
        floor
    }) as i64
}

/// `(cents / 100).toFixed(2)`.
fn fixed_two(cents: i64) -> String {
    let sign = if cents < 0 { "-" } else { "" };
    let magnitude = cents.unsigned_abs();
    format!("{sign}{}.{:02}", magnitude / 100, magnitude % 100)
}

/// `getResultConsistency(...).isConsistent`: the gifts add up to the count and total.
fn is_consistent(year: &YearGiving) -> bool {
    let cents: i64 = year.giving.iter().map(|gift| to_cents(gift.amount)).sum();
    year.giving.len() == year.number_of_giving as usize && cents == to_cents(year.total)
}

/// `getDbSummaryConsistency(...).isConsistent`.
fn summary_matches(summary: &SummaryRow, rows: &[DonationRow]) -> bool {
    let cents: i64 = rows
        .iter()
        .map(|row| to_cents(js_number(&row.amount)))
        .sum();
    i32::try_from(rows.len()).is_ok_and(|count| count == summary.number_of_donations)
        && cents == to_cents(js_number(&summary.total_amount))
}

/// `mapDonationToGiving`.
fn gift_from_row(row: &DonationRow) -> Gift {
    Gift {
        amount: js_number(&row.amount),
        date: row.date.clone(),
        name: row.name.clone(),
        transaction_id: row.ccb_transaction_id.clone(),
        tax_deductible: row.tax_deductible,
        payment_type: row.payment_type.clone().filter(|kind| !kind.is_empty()),
        campus: row.campus.clone().unwrap_or_default(),
        campus_id: row.campus_id.clone().unwrap_or_default(),
    }
}

/// `fetchAndPersist`'s row for a parsed gift: an empty campus is `null`, the amount is
/// `String(amount)`.
fn row_from_gift(gift: Gift) -> DonationRow {
    DonationRow {
        ccb_transaction_id: gift.transaction_id,
        amount: js::number_to_string(gift.amount),
        date: gift.date,
        name: gift.name,
        campus: Some(gift.campus).filter(|campus| !campus.is_empty()),
        campus_id: Some(gift.campus_id).filter(|campus_id| !campus_id.is_empty()),
        payment_type: gift.payment_type,
        tax_deductible: gift.tax_deductible,
    }
}

/// The first row for each transaction id, so one upsert batch never names a row twice.
fn dedupe(rows: Vec<DonationRow>) -> Vec<DonationRow> {
    let mut seen = std::collections::HashSet::new();
    rows.into_iter()
        .filter(|row| seen.insert(row.ccb_transaction_id.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::super::store::testing::FakeGivingStore;
    use super::*;
    use crate::store::kv::MemoryStore;

    /// Friday 2026-10-16 12:00 UTC; the next refresh is Monday 2026-10-19 10:00 UTC.
    const NOW: i64 = 1_792_152_000_000;
    const NEXT_REFRESH: i64 = 1_792_404_000_000;

    fn identity(year: i32) -> GivingIdentity {
        GivingIdentity {
            user_id: "user-ada".to_owned(),
            ccb_family_id: "2001".to_owned(),
            ccb_id: "1001".to_owned(),
            year,
        }
    }

    fn year_giving(amounts: &[f64], total: f64, count: u32) -> YearGiving {
        YearGiving {
            giving: amounts
                .iter()
                .map(|amount| Gift {
                    amount: *amount,
                    date: "2026-01-04".to_owned(),
                    name: "General Fund".to_owned(),
                    transaction_id: "5001".to_owned(),
                    tax_deductible: true,
                    payment_type: None,
                    campus: String::new(),
                    campus_id: String::new(),
                })
                .collect(),
            total,
            number_of_giving: count,
            ccb_id: "1001".to_owned(),
            year: 2026,
        }
    }

    fn service(redis: Arc<MemoryStore>) -> GivingService {
        GivingService::new(
            Arc::new(FakeGivingStore::default()),
            redis,
            None,
            Clock::fixed(NOW),
        )
    }

    const KEY: &str = "rs:donations-v3:user-ada:2001:1001:2026";

    #[tokio::test]
    async fn serves_a_consistent_redis_value_and_warms_memory() {
        let redis = Arc::new(MemoryStore::new("rs:"));
        let cached = year_giving(&[50.0, 25.5], 75.5, 2);
        redis.insert_raw(KEY, &serde_json::to_string(&cached).unwrap());
        let service = service(redis.clone());

        assert_eq!(service.yearly(identity(2026)).await.unwrap(), cached);
        redis.insert_raw(KEY, "not json");
        // Memory answers now, until the next weekly refresh.
        assert_eq!(service.yearly(identity(2026)).await.unwrap(), cached);
        let entry = service.memory.get(&identity(2026).cache_key()).unwrap();
        assert_eq!(entry.expires_ms, NEXT_REFRESH);
    }

    #[tokio::test]
    async fn deletes_redis_values_that_do_not_decode_or_add_up() {
        for value in [
            "not json".to_owned(),
            r#"{"giving":[],"total":0,"numberOfGiving":-1,"ccbId":"1001","year":2026}"#.to_owned(),
            serde_json::to_string(&year_giving(&[50.0], 75.5, 1)).unwrap(),
            serde_json::to_string(&year_giving(&[50.0], 50.0, 2)).unwrap(),
        ] {
            let redis = Arc::new(MemoryStore::new("rs:"));
            redis.insert_raw(KEY, &value);
            let service = service(redis.clone());
            // A miss falls through to Postgres (empty) and then CCB (not configured).
            assert!(matches!(
                service.yearly(identity(2026)).await,
                Err(GivingError::CcbNotConfigured)
            ));
            assert_eq!(redis.raw(KEY), None, "{value}");
        }
    }

    #[test]
    fn expired_memory_entries_are_misses() {
        let service = service(Arc::new(MemoryStore::new("rs:")));
        let key = identity(2026).cache_key();
        service.memory.insert(
            key.clone(),
            Arc::new(MemoryEntry {
                year: year_giving(&[], 0.0, 0),
                expires_ms: NOW,
            }),
        );
        assert_eq!(service.memory_get(&key, 2026), None);
        assert!(service.memory.get(&key).is_none());
    }

    #[test]
    fn rounds_cents_like_math_round() {
        assert_eq!(to_cents(25.5), 2550);
        assert_eq!(to_cents(0.29), 29);
        assert_eq!(to_cents(10.005), 1001);
        // Reference values from `Math.round(x * 100)`: -2.345 * 100 is -234.50000000000003, and
        // -0.005 * 100 is exactly -0.5, a tie, which rounds toward +∞.
        assert_eq!(to_cents(-2.345), -235);
        assert_eq!(to_cents(-0.005), 0);
        assert_eq!(fixed_two(8550), "85.50");
        assert_eq!(fixed_two(0), "0.00");
        assert_eq!(fixed_two(7), "0.07");
        assert_eq!(fixed_two(-1205), "-12.05");
    }

    #[test]
    fn keeps_the_first_row_of_each_transaction() {
        let row = |id: &str, amount: &str| DonationRow {
            ccb_transaction_id: id.to_owned(),
            amount: amount.to_owned(),
            date: "2026-01-04".to_owned(),
            name: "Giving".to_owned(),
            campus: None,
            campus_id: None,
            payment_type: None,
            tax_deductible: true,
        };
        assert_eq!(
            dedupe(vec![row("N/A", "1"), row("5001", "2"), row("N/A", "3")]),
            vec![row("N/A", "1"), row("5001", "2")]
        );
    }
}
