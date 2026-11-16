//! The giving tables (`apps/server/src/db/schema/donations.ts`, `users.ts`) as the giving service
//! and resolvers read and write them: drizzle's statements in
//! `apps/server/src/graphql/schema/user/donationsV2.ts` and
//! `apps/server/src/effect/services/GivingService.ts`.
//!
//! The `timestamp` columns have no time zone and hold UTC wall-clock time: drizzle writes
//! `Date.toISOString()`, whose `Z` Postgres ignores, and reads them back as UTC. Timestamps are
//! therefore written as `to_timestamp(ms / 1000) at time zone 'UTC'` and read with `extract(epoch …)`.
//! Ids are drizzle's `$defaultFn(crypto.randomUUID())`, generated here, since the columns have no
//! database default.

use std::future::Future;
use std::pin::Pin;

use sqlx::{PgPool, Postgres, Row, Transaction};
use uuid::Uuid;

/// `DONATION_UPSERT_CHUNK_SIZE`.
pub const UPSERT_CHUNK_SIZE: usize = 250;

#[derive(Debug, thiserror::Error)]
pub enum GivingStoreError {
    #[error(transparent)]
    Sql(#[from] sqlx::Error),
    /// Only produced by the in-memory test store.
    #[cfg(test)]
    #[error("store unavailable")]
    Unavailable,
}

pub type StoreFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, GivingStoreError>> + Send + 'a>>;

/// `getCurrentGivingUser`'s row.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GivingUser {
    pub id: String,
    pub ccb_id: Option<String>,
    pub ccb_family_id: Option<String>,
}

/// The `donation_yearly_summaries` columns `checkDb` reads.
#[derive(Clone, Debug, PartialEq)]
pub struct SummaryRow {
    pub ccb_id: Option<String>,
    /// `numeric(10, 2)`, as node-postgres returns it: text.
    pub total_amount: String,
    pub number_of_donations: i32,
    pub last_synced_at_ms: i64,
    pub is_stale: bool,
}

/// A `donations` row as `mapDonationToGiving` reads it, and as `fetchAndPersist` writes it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DonationRow {
    pub ccb_transaction_id: String,
    /// `numeric(10, 2)` as text: what Postgres answers, or `String(amount)` when written.
    pub amount: String,
    /// `yyyy-MM-dd`.
    pub date: String,
    pub name: String,
    pub campus: Option<String>,
    pub campus_id: Option<String>,
    pub payment_type: Option<String>,
    pub tax_deductible: bool,
}

/// One year rewritten from CCB (`fetchAndPersist`'s transaction).
#[derive(Clone, Debug, PartialEq)]
pub struct YearSync {
    pub user_id: String,
    pub year: i32,
    pub ccb_id: String,
    /// Deduplicated by transaction id.
    pub rows: Vec<DonationRow>,
    /// `persistedTotal`: the rows' total, `toFixed(2)`.
    pub total_amount: String,
    /// When the sync is written (`new Date()` in each statement on TS).
    pub synced_at_ms: i64,
    /// From the start of the CCB fetch to `synced_at_ms`.
    pub duration_ms: i32,
}

/// Where the giving tables live: Postgres, or a fake in tests.
pub trait GivingStore: Send + Sync {
    /// `getCurrentGivingUser`: the `app_users` row for a Firebase uid.
    fn giving_user<'a>(&'a self, firebase_uid: &'a str) -> StoreFuture<'a, Option<GivingUser>>;
    /// The `(user_id, year)` summary.
    fn summary<'a>(&'a self, user_id: &'a str, year: i32) -> StoreFuture<'a, Option<SummaryRow>>;
    /// The year's donations, newest first.
    fn donations<'a>(&'a self, user_id: &'a str, year: i32) -> StoreFuture<'a, Vec<DonationRow>>;
    /// Flags a summary whose rows disagree with it, so the next read refetches.
    fn mark_stale<'a>(&'a self, user_id: &'a str, year: i32, now_ms: i64) -> StoreFuture<'a, ()>;
    /// In one transaction: the year's rows become exactly `sync.rows`, its summary is replaced
    /// and the sync is logged.
    fn replace_year<'a>(&'a self, sync: &'a YearSync) -> StoreFuture<'a, ()>;
}

/// `to_timestamp(<ms> / 1000)` as UTC wall-clock time, for a `timestamp` column.
const UTC_TIMESTAMP: &str = "(to_timestamp($1::float8 / 1000) at time zone 'UTC')";

fn timestamp_param(index: usize) -> String {
    UTC_TIMESTAMP.replace("$1", &format!("${index}"))
}

const SELECT_GIVING_USER: &str = r#"select "id", "ccb_id", "ccb_family_id" from "app_users" where "app_users"."firebase_uid" = $1 limit $2"#;

const SELECT_SUMMARY: &str = r#"select "ccb_id", "total_amount"::text, "number_of_donations", (extract(epoch from "last_synced_at") * 1000)::float8, "is_stale" from "donation_yearly_summaries" where ("donation_yearly_summaries"."user_id" = $1 and "donation_yearly_summaries"."year" = $2) limit $3"#;

const SELECT_DONATIONS: &str = r#"select "ccb_transaction_id", "amount"::text, to_char("date", 'YYYY-MM-DD'), "name", "campus", "campus_id", "payment_type", "tax_deductible" from "donations" where ("donations"."user_id" = $1 and "donations"."year" = $2) order by "donations"."date" desc"#;

/// `notInArray(ccbTransactionId, ids)`, or no id filter when `ids` is empty: `<> all('{}')` holds
/// for every row.
const DELETE_DROPPED_DONATIONS: &str = r#"delete from "donations" where ("donations"."user_id" = $1 and "donations"."year" = $2 and "donations"."ccb_transaction_id" <> all($3::text[]))"#;

/// The PostgreSQL store, over the pool the rest of the server shares.
pub struct PgGivingStore {
    pool: PgPool,
}

impl PgGivingStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    async fn write_year(
        transaction: &mut Transaction<'_, Postgres>,
        sync: &YearSync,
    ) -> Result<(), GivingStoreError> {
        let synced_at = sync.synced_at_ms as f64;
        let ids: Vec<String> = sync
            .rows
            .iter()
            .map(|row| row.ccb_transaction_id.clone())
            .collect();
        sqlx::query(DELETE_DROPPED_DONATIONS)
            .bind(&sync.user_id)
            .bind(sync.year)
            .bind(&ids)
            .execute(&mut **transaction)
            .await?;

        let upsert = format!(
            r#"insert into "donations" ("id", "user_id", "ccb_transaction_id", "amount", "date", "year", "name", "campus", "campus_id", "payment_type", "tax_deductible") select * from unnest($1::text[], $2::text[], $3::text[], $4::text[]::numeric[], $5::text[]::date[], $6::int4[], $7::text[], $8::text[], $9::text[], $10::text[], $11::bool[]) on conflict ("user_id","ccb_transaction_id") do update set "amount" = excluded.amount, "date" = excluded.date, "year" = excluded.year, "name" = excluded.name, "campus" = excluded.campus, "campus_id" = excluded.campus_id, "payment_type" = excluded.payment_type, "tax_deductible" = excluded.tax_deductible, "synced_from_ccb_at" = {at}, "updated_at" = {at}"#,
            at = timestamp_param(12)
        );
        for chunk in sync.rows.chunks(UPSERT_CHUNK_SIZE) {
            let column = |pick: fn(&DonationRow) -> String| chunk.iter().map(pick).collect();
            let optional = |pick: fn(&DonationRow) -> Option<String>| -> Vec<Option<String>> {
                chunk.iter().map(pick).collect()
            };
            let ids: Vec<String> = chunk.iter().map(|_| Uuid::new_v4().to_string()).collect();
            let user_ids: Vec<String> = chunk.iter().map(|_| sync.user_id.clone()).collect();
            let transaction_ids: Vec<String> = column(|row| row.ccb_transaction_id.clone());
            let amounts: Vec<String> = column(|row| row.amount.clone());
            let dates: Vec<String> = column(|row| row.date.clone());
            let years: Vec<i32> = chunk.iter().map(|_| sync.year).collect();
            let names: Vec<String> = column(|row| row.name.clone());
            let tax: Vec<bool> = chunk.iter().map(|row| row.tax_deductible).collect();
            sqlx::query(&upsert)
                .bind(ids)
                .bind(user_ids)
                .bind(transaction_ids)
                .bind(amounts)
                .bind(dates)
                .bind(years)
                .bind(names)
                .bind(optional(|row| row.campus.clone()))
                .bind(optional(|row| row.campus_id.clone()))
                .bind(optional(|row| row.payment_type.clone()))
                .bind(tax)
                .bind(synced_at)
                .execute(&mut **transaction)
                .await?;
        }

        let summary = format!(
            r#"insert into "donation_yearly_summaries" ("id", "user_id", "year", "ccb_id", "total_amount", "number_of_donations", "last_synced_at", "is_stale") values ($1, $2, $3, $4, $5::numeric, $6, {at}, false) on conflict ("user_id","year") do update set "ccb_id" = $4, "total_amount" = $5::numeric, "number_of_donations" = $6, "last_synced_at" = {at}, "is_stale" = false, "updated_at" = {at}"#,
            at = timestamp_param(7)
        );
        let count = i32::try_from(sync.rows.len()).unwrap_or(i32::MAX);
        sqlx::query(&summary)
            .bind(Uuid::new_v4().to_string())
            .bind(&sync.user_id)
            .bind(sync.year)
            .bind(&sync.ccb_id)
            .bind(&sync.total_amount)
            .bind(count)
            .bind(synced_at)
            .execute(&mut **transaction)
            .await?;

        sqlx::query(
            r#"insert into "donation_sync_logs" ("id", "user_id", "year", "transaction_count", "total_amount", "sync_status", "duration_ms") values ($1, $2, $3, $4, $5::numeric, 'SUCCESS', $6)"#,
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&sync.user_id)
        .bind(sync.year)
        .bind(count)
        .bind(&sync.total_amount)
        .bind(sync.duration_ms)
        .execute(&mut **transaction)
        .await?;
        Ok(())
    }
}

impl GivingStore for PgGivingStore {
    fn giving_user<'a>(&'a self, firebase_uid: &'a str) -> StoreFuture<'a, Option<GivingUser>> {
        Box::pin(async move {
            let row = sqlx::query(SELECT_GIVING_USER)
                .bind(firebase_uid)
                .bind(1_i64)
                .fetch_optional(&self.pool)
                .await?;
            row.map(|row| {
                Ok(GivingUser {
                    id: row.try_get(0)?,
                    ccb_id: row.try_get(1)?,
                    ccb_family_id: row.try_get(2)?,
                })
            })
            .transpose()
        })
    }

    fn summary<'a>(&'a self, user_id: &'a str, year: i32) -> StoreFuture<'a, Option<SummaryRow>> {
        Box::pin(async move {
            let row = sqlx::query(SELECT_SUMMARY)
                .bind(user_id)
                .bind(year)
                .bind(1_i64)
                .fetch_optional(&self.pool)
                .await?;
            row.map(|row| {
                Ok(SummaryRow {
                    ccb_id: row.try_get(0)?,
                    total_amount: row.try_get(1)?,
                    number_of_donations: row.try_get(2)?,
                    last_synced_at_ms: row.try_get::<f64, _>(3)?.round() as i64,
                    is_stale: row.try_get(4)?,
                })
            })
            .transpose()
        })
    }

    fn donations<'a>(&'a self, user_id: &'a str, year: i32) -> StoreFuture<'a, Vec<DonationRow>> {
        Box::pin(async move {
            let rows = sqlx::query(SELECT_DONATIONS)
                .bind(user_id)
                .bind(year)
                .fetch_all(&self.pool)
                .await?;
            rows.into_iter()
                .map(|row| {
                    Ok(DonationRow {
                        ccb_transaction_id: row.try_get(0)?,
                        amount: row.try_get(1)?,
                        date: row.try_get(2)?,
                        name: row.try_get(3)?,
                        campus: row.try_get(4)?,
                        campus_id: row.try_get(5)?,
                        payment_type: row.try_get(6)?,
                        tax_deductible: row.try_get(7)?,
                    })
                })
                .collect()
        })
    }

    fn mark_stale<'a>(&'a self, user_id: &'a str, year: i32, now_ms: i64) -> StoreFuture<'a, ()> {
        Box::pin(async move {
            let statement = format!(
                r#"update "donation_yearly_summaries" set "is_stale" = true, "updated_at" = {at} where ("donation_yearly_summaries"."user_id" = $2 and "donation_yearly_summaries"."year" = $3)"#,
                at = timestamp_param(1)
            );
            sqlx::query(&statement)
                .bind(now_ms as f64)
                .bind(user_id)
                .bind(year)
                .execute(&self.pool)
                .await?;
            Ok(())
        })
    }

    fn replace_year<'a>(&'a self, sync: &'a YearSync) -> StoreFuture<'a, ()> {
        Box::pin(async move {
            // A dropped or failed transaction rolls back.
            let mut transaction = self.pool.begin().await?;
            Self::write_year(&mut transaction, sync).await?;
            transaction.commit().await?;
            Ok(())
        })
    }
}

/// An in-memory store for the service and resolver tests.
#[cfg(test)]
pub mod testing {
    use std::collections::HashMap;
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    use super::*;

    #[derive(Default)]
    pub struct FakeGivingStore {
        pub users: Mutex<HashMap<String, GivingUser>>,
        pub summaries: Mutex<HashMap<(String, i32), SummaryRow>>,
        pub donations: Mutex<HashMap<(String, i32), Vec<DonationRow>>>,
        /// Every `replace_year`, in order.
        pub syncs: Mutex<Vec<YearSync>>,
        /// Reads fail while set, like an unreachable database.
        pub failing: AtomicBool,
        pub reads: AtomicUsize,
    }

    impl FakeGivingStore {
        pub fn with_user(uid: &str, user: GivingUser) -> Self {
            let store = Self::default();
            store.users.lock().unwrap().insert(uid.to_owned(), user);
            store
        }

        pub fn set_failing(&self, failing: bool) {
            self.failing.store(failing, Ordering::SeqCst);
        }

        pub fn insert_year(
            &self,
            user_id: &str,
            year: i32,
            summary: SummaryRow,
            rows: Vec<DonationRow>,
        ) {
            let key = (user_id.to_owned(), year);
            self.summaries.lock().unwrap().insert(key.clone(), summary);
            self.donations.lock().unwrap().insert(key, rows);
        }

        pub fn summary_of(&self, user_id: &str, year: i32) -> Option<SummaryRow> {
            self.summaries
                .lock()
                .unwrap()
                .get(&(user_id.to_owned(), year))
                .cloned()
        }

        pub fn sync_count(&self) -> usize {
            self.syncs.lock().unwrap().len()
        }

        fn read<T: Send + 'static>(&self, value: impl FnOnce() -> T) -> StoreFuture<'_, T> {
            self.reads.fetch_add(1, Ordering::SeqCst);
            let result = if self.failing.load(Ordering::SeqCst) {
                Err(GivingStoreError::Unavailable)
            } else {
                Ok(value())
            };
            Box::pin(async move { result })
        }
    }

    impl GivingStore for FakeGivingStore {
        fn giving_user<'a>(&'a self, firebase_uid: &'a str) -> StoreFuture<'a, Option<GivingUser>> {
            self.read(|| self.users.lock().unwrap().get(firebase_uid).cloned())
        }

        fn summary<'a>(
            &'a self,
            user_id: &'a str,
            year: i32,
        ) -> StoreFuture<'a, Option<SummaryRow>> {
            self.read(|| self.summary_of(user_id, year))
        }

        fn donations<'a>(
            &'a self,
            user_id: &'a str,
            year: i32,
        ) -> StoreFuture<'a, Vec<DonationRow>> {
            self.read(|| {
                let mut rows = self
                    .donations
                    .lock()
                    .unwrap()
                    .get(&(user_id.to_owned(), year))
                    .cloned()
                    .unwrap_or_default();
                rows.sort_by(|a, b| b.date.cmp(&a.date));
                rows
            })
        }

        fn mark_stale<'a>(
            &'a self,
            user_id: &'a str,
            year: i32,
            _now_ms: i64,
        ) -> StoreFuture<'a, ()> {
            self.read(|| {
                if let Some(summary) = self
                    .summaries
                    .lock()
                    .unwrap()
                    .get_mut(&(user_id.to_owned(), year))
                {
                    summary.is_stale = true;
                }
            })
        }

        fn replace_year<'a>(&'a self, sync: &'a YearSync) -> StoreFuture<'a, ()> {
            self.read(|| {
                let key = (sync.user_id.clone(), sync.year);
                self.summaries.lock().unwrap().insert(
                    key.clone(),
                    SummaryRow {
                        ccb_id: Some(sync.ccb_id.clone()),
                        total_amount: sync.total_amount.clone(),
                        number_of_donations: i32::try_from(sync.rows.len()).unwrap(),
                        last_synced_at_ms: sync.synced_at_ms,
                        is_stale: false,
                    },
                );
                self.donations
                    .lock()
                    .unwrap()
                    .insert(key, sync.rows.clone());
                self.syncs.lock().unwrap().push(sync.clone());
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use sqlx::postgres::{PgConnectOptions, PgPoolOptions};

    use super::*;

    /// The tables as drizzle created them (`app_users` cut to the columns read here).
    const SCHEMA: &[&str] = &[
        r#"create table "app_users" ("id" text primary key, "firebase_uid" varchar(128) not null unique, "ccb_id" varchar(50), "ccb_family_id" varchar(50))"#,
        r#"create type "donation_sync_status" as enum ('SUCCESS', 'FAILED', 'PARTIAL')"#,
        r#"create table "donations" ("id" text primary key, "user_id" text not null references "app_users"("id") on delete cascade, "ccb_transaction_id" varchar(100) not null, "amount" numeric(10, 2) not null, "date" date not null, "year" integer not null, "name" varchar(255) not null, "campus" varchar(255), "campus_id" varchar(50), "payment_type" varchar(50), "tax_deductible" boolean default true not null, "synced_from_ccb_at" timestamp default now() not null, "created_at" timestamp default now() not null, "updated_at" timestamp default now() not null)"#,
        r#"create unique index "donations_user_transaction_idx" on "donations" ("user_id", "ccb_transaction_id")"#,
        r#"create table "donation_yearly_summaries" ("id" text primary key, "user_id" text not null references "app_users"("id") on delete cascade, "year" integer not null, "ccb_id" varchar(50), "total_amount" numeric(10, 2) not null, "number_of_donations" integer not null, "last_synced_at" timestamp default now() not null, "is_stale" boolean default false not null, "created_at" timestamp default now() not null, "updated_at" timestamp default now() not null)"#,
        r#"create unique index "donation_summaries_user_year_idx" on "donation_yearly_summaries" ("user_id", "year")"#,
        r#"create table "donation_sync_logs" ("id" text primary key, "user_id" text not null references "app_users"("id") on delete cascade, "year" integer not null, "synced_at" timestamp default now() not null, "transaction_count" integer not null, "total_amount" numeric(10, 2) not null, "sync_status" "donation_sync_status" not null, "error_message" text, "duration_ms" integer)"#,
    ];

    fn row(id: &str, amount: &str, date: &str) -> DonationRow {
        DonationRow {
            ccb_transaction_id: id.to_owned(),
            amount: amount.to_owned(),
            date: date.to_owned(),
            name: "General Fund".to_owned(),
            campus: Some("Example Campus".to_owned()),
            campus_id: Some("1".to_owned()),
            payment_type: Some("Credit Card".to_owned()),
            tax_deductible: true,
        }
    }

    fn sync(rows: Vec<DonationRow>, total: &str, synced_at_ms: i64) -> YearSync {
        YearSync {
            user_id: "user-ada".to_owned(),
            year: 2026,
            ccb_id: "1001".to_owned(),
            rows,
            total_amount: total.to_owned(),
            synced_at_ms,
            duration_ms: 42,
        }
    }

    /// Against `TEST_DATABASE_URL` (skipped without it), in a schema of its own that it drops.
    #[tokio::test]
    async fn reads_and_rewrites_the_giving_tables() {
        let Ok(url) = std::env::var("TEST_DATABASE_URL") else {
            eprintln!("skipped: TEST_DATABASE_URL is not set");
            return;
        };
        let schema = format!("giving_test_{}", Uuid::new_v4().simple());
        let options = PgConnectOptions::from_str(&url)
            .unwrap()
            .options([("search_path", schema.as_str())]);
        let pool = PgPoolOptions::new()
            .max_connections(2)
            .connect_with(options)
            .await
            .unwrap();
        sqlx::query(&format!(r#"create schema "{schema}""#))
            .execute(&pool)
            .await
            .unwrap();
        for statement in SCHEMA {
            sqlx::query(statement).execute(&pool).await.unwrap();
        }
        sqlx::query(
            r#"insert into "app_users" values ('user-ada', 'ada-example-uid', '1001', '2001')"#,
        )
        .execute(&pool)
        .await
        .unwrap();
        let store = PgGivingStore::new(pool.clone());

        assert_eq!(
            store.giving_user("ada-example-uid").await.unwrap(),
            Some(GivingUser {
                id: "user-ada".to_owned(),
                ccb_id: Some("1001".to_owned()),
                ccb_family_id: Some("2001".to_owned()),
            })
        );
        assert_eq!(store.giving_user("grace-example-uid").await.unwrap(), None);
        assert_eq!(store.summary("user-ada", 2026).await.unwrap(), None);

        // 2026-10-16 12:00:00.123 UTC.
        let first_sync = 1_792_152_000_123;
        let mut no_campus = row("5003", "10", "2026-03-01");
        no_campus.campus = None;
        no_campus.campus_id = None;
        no_campus.payment_type = Some(String::new());
        store
            .replace_year(&sync(
                vec![
                    no_campus.clone(),
                    row("5001", "50", "2026-01-04"),
                    row("5002", "25.5", "2026-01-04"),
                ],
                "85.50",
                first_sync,
            ))
            .await
            .unwrap();
        assert_eq!(
            store.summary("user-ada", 2026).await.unwrap(),
            Some(SummaryRow {
                ccb_id: Some("1001".to_owned()),
                total_amount: "85.50".to_owned(),
                number_of_donations: 3,
                last_synced_at_ms: first_sync,
                is_stale: false,
            })
        );
        let rows = store.donations("user-ada", 2026).await.unwrap();
        assert_eq!(rows.len(), 3);
        // Newest first, amounts as numeric(10, 2) text, the empty payment type kept.
        assert_eq!(
            rows[0],
            DonationRow {
                amount: "10.00".to_owned(),
                ..no_campus
            }
        );
        assert_eq!(rows[1].date, "2026-01-04");
        assert!(rows[1..].iter().any(|row| row.amount == "25.50"));
        // UTC wall-clock time, as drizzle writes it.
        let synced: String = sqlx::query_scalar(
            r#"select to_char("last_synced_at", 'YYYY-MM-DD"T"HH24:MI:SS.MS') from "donation_yearly_summaries""#,
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(synced, "2026-10-16T12:00:00.123");

        // A rewrite drops the rows CCB no longer returns and updates the rest.
        store
            .replace_year(&sync(
                vec![row("5001", "60", "2026-01-04")],
                "60.00",
                first_sync + 1000,
            ))
            .await
            .unwrap();
        let rows = store.donations("user-ada", 2026).await.unwrap();
        assert_eq!(rows, vec![row("5001", "60.00", "2026-01-04")]);
        let summary = store.summary("user-ada", 2026).await.unwrap().unwrap();
        assert_eq!(
            (summary.total_amount.as_str(), summary.number_of_donations),
            ("60.00", 1)
        );

        // An empty answer empties the year.
        store
            .replace_year(&sync(vec![], "0.00", first_sync + 2000))
            .await
            .unwrap();
        assert_eq!(store.donations("user-ada", 2026).await.unwrap(), vec![]);

        store
            .mark_stale("user-ada", 2026, first_sync + 3000)
            .await
            .unwrap();
        assert!(
            store
                .summary("user-ada", 2026)
                .await
                .unwrap()
                .unwrap()
                .is_stale
        );

        let logs: Vec<(i32, String, String, Option<i32>)> = sqlx::query_as(
            r#"select "transaction_count", "total_amount"::text, "sync_status"::text, "duration_ms" from "donation_sync_logs" order by "transaction_count" desc"#,
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            logs,
            vec![
                (3, "85.50".to_owned(), "SUCCESS".to_owned(), Some(42)),
                (1, "60.00".to_owned(), "SUCCESS".to_owned(), Some(42)),
                (0, "0.00".to_owned(), "SUCCESS".to_owned(), Some(42)),
            ]
        );

        sqlx::query(&format!(r#"drop schema "{schema}" cascade"#))
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;
    }
}
