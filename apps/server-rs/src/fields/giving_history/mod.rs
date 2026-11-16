//! `myGivingHistory` and `getPreviousFiveYearsGivingV2`
//! (`apps/server/src/graphql/schema/user/donationsV2.ts`, types in `givings.ts`): the signed-in
//! member's giving for this year and the four before it, from [`service::GivingService`].
//!
//! Both fields need the `signedIn` scope. The member is the `app_users` row of the caller's
//! Firebase uid, which must carry a CCB individual and family id. `myGivingHistory` answers a typed
//! result: a missing row or CCB link is `MyGivingHistoryNotFoundError`, and a failed lookup or
//! giving read is logged and answered with `MyGivingHistoryFetchError`'s fixed message.
//! `getPreviousFiveYearsGivingV2` answers `null` where the first answers "not found", and a failure
//! as the masked `Unexpected error.`. The response-cache TTL of both is 0
//! (`graphql/response_cache.rs`).

pub mod parse;
pub mod refresh;
pub mod service;
pub mod store;

use std::sync::Arc;

use async_graphql::{Context, Object, SimpleObject, Union};

use crate::graphql::auth::Viewer;
use crate::graphql::guards::SignedIn;
use parse::Gift;
use service::{GivingService, YearGiving};
use store::GivingUser;

/// `MyGivingHistoryFetchError`'s message.
pub const FETCH_ERROR_MESSAGE: &str = "Failed to fetch previous five years giving";

/// `MONTH_NAMES`.
const MONTH_NAMES: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

// `UserDonation`. (No doc comment: TS has no description.)
#[derive(Clone, Debug, PartialEq, SimpleObject)]
pub struct UserDonation {
    /// User amount
    pub amount: Option<f64>,
    /// User campus
    pub campus: Option<String>,
    /// User campus id
    pub campus_id: Option<String>,
    /// User date
    pub date: Option<String>,
    /// User name
    pub name: Option<String>,
    /// User payment type
    pub payment_type: Option<String>,
    /// User tax deductible
    pub tax_deductible: Option<bool>,
    /// User transaction id
    pub transaction_id: Option<String>,
}

impl From<&Gift> for UserDonation {
    fn from(gift: &Gift) -> Self {
        Self {
            amount: Some(gift.amount),
            campus: Some(gift.campus.clone()),
            campus_id: Some(gift.campus_id.clone()),
            date: Some(gift.date.clone()),
            name: Some(gift.name.clone()),
            payment_type: gift.payment_type.clone(),
            tax_deductible: Some(gift.tax_deductible),
            transaction_id: Some(gift.transaction_id.clone()),
        }
    }
}

// `MonthlyGivingGroup`. (No doc comment: TS has no description.)
#[derive(Clone, Debug, PartialEq, SimpleObject)]
pub struct MonthlyGivingGroup {
    /// List of donations for this month
    pub giving_list: Option<Vec<UserDonation>>,
    /// Month name (e.g., January)
    pub month: Option<String>,
    /// Number of donations for this month
    pub number: Option<i32>,
    /// Total amount for this month
    pub total: Option<f64>,
}

/// `getMonthFromDate` / `getDayFromDate` for the `yyyy-MM-dd` dates every tier holds: the 1-based
/// month, or `None` (the gift is left out of the groups).
fn date_part(date: &str, index: usize) -> Option<u32> {
    date.split('-').nth(index)?.trim().parse().ok()
}

/// `groupGivingByMonth`: months with gifts, latest month first, each month's gifts by day,
/// latest first (stable).
fn group_by_month(giving: &[Gift]) -> Vec<MonthlyGivingGroup> {
    let mut months: Vec<(u32, Vec<&Gift>, f64)> = Vec::new();
    for gift in giving {
        let Some(month) = date_part(&gift.date, 1).filter(|month| (1..=12).contains(month)) else {
            continue;
        };
        match months
            .iter_mut()
            .find(|(existing, _, _)| *existing == month)
        {
            Some((_, gifts, total)) => {
                gifts.push(gift);
                *total += gift.amount;
            }
            None => months.push((month, vec![gift], gift.amount)),
        }
    }
    months.sort_by(|a, b| b.0.cmp(&a.0));
    months
        .into_iter()
        .map(|(month, mut gifts, total)| {
            gifts.sort_by_key(|gift| std::cmp::Reverse(date_part(&gift.date, 2).unwrap_or(0)));
            MonthlyGivingGroup {
                number: i32::try_from(gifts.len()).ok(),
                giving_list: Some(gifts.into_iter().map(UserDonation::from).collect()),
                month: MONTH_NAMES
                    .get(month as usize - 1)
                    .map(|name| (*name).to_owned()),
                total: Some(total),
            }
        })
        .collect()
}

// `UserPreviousFiveYearsDonations`. (No doc comment: TS has no description.)
#[derive(Clone, Debug, PartialEq)]
pub struct UserPreviousFiveYearsDonations(pub YearGiving);

#[Object]
impl UserPreviousFiveYearsDonations {
    /// User ccb id
    async fn ccb_id(&self) -> Option<String> {
        Some(self.0.ccb_id.clone())
    }

    async fn giving(&self) -> Option<Vec<UserDonation>> {
        Some(self.0.giving.iter().map(UserDonation::from).collect())
    }

    /// Giving grouped by month
    async fn group_giving_by_month(&self) -> Option<Vec<MonthlyGivingGroup>> {
        Some(group_by_month(&self.0.giving))
    }

    /// User number of giving
    async fn number_of_giving(&self) -> Option<i32> {
        i32::try_from(self.0.number_of_giving).ok()
    }

    /// User total
    async fn total(&self) -> Option<f64> {
        Some(self.0.total)
    }

    /// User year
    async fn year(&self) -> Option<i32> {
        Some(self.0.year)
    }
}

// `MyGivingHistorySuccess`. (No doc comment: TS has no description.)
#[derive(Clone, Debug, PartialEq, SimpleObject)]
pub struct MyGivingHistorySuccess {
    /// Previous five years of giving
    pub years: Option<Vec<UserPreviousFiveYearsDonations>>,
}

// `MyGivingHistoryFetchError`. (No doc comment: TS has no description.)
#[derive(Clone, Debug, PartialEq, SimpleObject)]
pub struct MyGivingHistoryFetchError {
    /// Error message describing what went wrong
    pub message: Option<String>,
}

// `MyGivingHistoryNotFoundError`. (No doc comment: TS has no description.)
#[derive(Clone, Debug, PartialEq, SimpleObject)]
pub struct MyGivingHistoryNotFoundError {
    /// Error message when giving data cannot be found
    pub message: Option<String>,
}

// `MyGivingHistoryResult`. (No doc comment: TS has no description.)
#[derive(Clone, Debug, PartialEq, Union)]
pub enum MyGivingHistoryResult {
    MyGivingHistoryFetchError(MyGivingHistoryFetchError),
    MyGivingHistoryNotFoundError(MyGivingHistoryNotFoundError),
    MyGivingHistorySuccess(MyGivingHistorySuccess),
}

fn not_found(message: &str) -> MyGivingHistoryResult {
    MyGivingHistoryResult::MyGivingHistoryNotFoundError(MyGivingHistoryNotFoundError {
        message: Some(message.to_owned()),
    })
}

/// `toGivingFetchError`: the client gets a fixed message; the log keeps the cause, without
/// emails or CCB ids.
fn fetch_error(step: &str, error: &service::GivingError) -> MyGivingHistoryResult {
    tracing::error!(
        operation = "myGivingHistory",
        step,
        error = %error,
        "Failed to fetch giving history"
    );
    MyGivingHistoryResult::MyGivingHistoryFetchError(MyGivingHistoryFetchError {
        message: Some(FETCH_ERROR_MESSAGE.to_owned()),
    })
}

/// A member's `(user id, CCB family id, CCB id)`, when both CCB ids are set and non-empty.
fn linked(user: GivingUser) -> Option<(String, String, String)> {
    let family = user.ccb_family_id.filter(|id| !id.is_empty())?;
    let ccb_id = user.ccb_id.filter(|id| !id.is_empty())?;
    Some((user.id, family, ccb_id))
}

/// `resolveMyGivingHistory`.
pub async fn resolve_my_giving_history(
    giving: &GivingService,
    uid: Option<&str>,
) -> MyGivingHistoryResult {
    let Some(uid) = uid.filter(|uid| !uid.is_empty()) else {
        return not_found("Authenticated user was not found");
    };
    let user = match giving.giving_user(uid).await {
        Ok(Some(user)) => user,
        Ok(None) => return not_found("Giving profile was not found"),
        Err(error) => return fetch_error("lookupUser", &error),
    };
    let Some((user_id, family, ccb_id)) = linked(user) else {
        return not_found("CCB giving profile is not linked");
    };
    match giving.previous_five_years(&user_id, &family, &ccb_id).await {
        Ok(years) => MyGivingHistoryResult::MyGivingHistorySuccess(MyGivingHistorySuccess {
            years: Some(
                years
                    .into_iter()
                    .map(UserPreviousFiveYearsDonations)
                    .collect(),
            ),
        }),
        Err(error) => fetch_error("fetchGiving", &error),
    }
}

/// `resolvePreviousFiveYearsGivingV2`.
pub async fn resolve_previous_five_years(
    giving: &GivingService,
    uid: Option<&str>,
) -> async_graphql::Result<Option<Vec<UserPreviousFiveYearsDonations>>> {
    let Some(uid) = uid.filter(|uid| !uid.is_empty()) else {
        return Ok(None);
    };
    let user = giving
        .giving_user(uid)
        .await
        .map_err(|error| async_graphql::Error::new(error.to_string()))?;
    let Some((user_id, family, ccb_id)) = user.and_then(linked) else {
        return Ok(None);
    };
    let years = giving
        .previous_five_years(&user_id, &family, &ccb_id)
        .await
        .map_err(|error| async_graphql::Error::new(error.to_string()))?;
    Ok(Some(
        years
            .into_iter()
            .map(UserPreviousFiveYearsDonations)
            .collect(),
    ))
}

#[derive(Default)]
pub struct GivingHistoryQuery;

#[Object]
impl GivingHistoryQuery {
    #[graphql(guard = "SignedIn")]
    async fn get_previous_five_years_giving_v2(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Option<Vec<UserPreviousFiveYearsDonations>>> {
        let giving = ctx.data::<Arc<GivingService>>()?;
        let uid = ctx.data_opt::<Viewer>().map(|viewer| viewer.uid.as_str());
        resolve_previous_five_years(giving, uid).await
    }

    /// Get the current user's giving history with typed success and error responses
    #[graphql(guard = "SignedIn")]
    async fn my_giving_history(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Option<MyGivingHistoryResult>> {
        let giving = ctx.data::<Arc<GivingService>>()?;
        let uid = ctx.data_opt::<Viewer>().map(|viewer| viewer.uid.as_str());
        Ok(Some(resolve_my_giving_history(giving, uid).await))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::Duration;

    use serde_json::{Value, json};
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::store::testing::FakeGivingStore;
    use super::store::{DonationRow, GivingUser, SummaryRow};
    use crate::ccb::CcbClient;
    use crate::config::{CcbConfig, Secret};
    use crate::fields::Clock;
    use crate::graphql::auth::{AuthKind, Viewer};
    use crate::metrics::Metrics;
    use crate::store::kv::{KeyValueStore, MemoryStore};
    use crate::strapi::record_cache::testing::LogCapture;
    use crate::test_support::{TestServices, execute_like_handler, schema_from, viewer};

    /// Friday 2026-10-16 12:00 UTC.
    const NOW: i64 = 1_792_152_000_000;
    /// The weekly refresh before it, Monday 2026-10-12 10:00 UTC.
    const LAST_REFRESH: i64 = 1_791_799_200_000;
    const UID: &str = "ada-example-uid";
    const USER_ID: &str = "user-ada";

    /// The app's `UserGivingQuery`.
    const USER_GIVING_QUERY: &str = "query UserGivingQuery { myGivingHistory { __typename ... on MyGivingHistorySuccess { years { ccbId numberOfGiving total year giving { amount campus campusId date name paymentType taxDeductible transactionId } groupGivingByMonth { month givingList { amount campus campusId date name paymentType taxDeductible transactionId } number total } } } ... on MyGivingHistoryFetchError { message } ... on MyGivingHistoryNotFoundError { message } } }";

    /// 2026's window also returns a 2025 gift edited this year, which belongs to 2025.
    const FAMILY_2026: &str = r#"<ccb_api><response><transactions count="3">
      <transaction id="9001">
        <campus id="1">Example Campus</campus>
        <individual id="1001">Ada Example</individual>
        <date>2026-01-04</date>
        <payment_type>Credit Card</payment_type>
        <transaction_details>
          <transaction_detail id="5001"><coa id="7">General Fund</coa><amount>50.00</amount><tax_deductible>true</tax_deductible></transaction_detail>
          <transaction_detail id="5002"><coa id="8">Building Fund</coa><amount>25.50</amount><tax_deductible>false</tax_deductible></transaction_detail>
        </transaction_details>
      </transaction>
      <transaction id="9002">
        <individual id="1001">Ada Example</individual>
        <date>2026-03-01</date>
        <transaction_details>
          <transaction_detail id="5003"><coa id="7">General Fund</coa><amount>10</amount></transaction_detail>
        </transaction_details>
      </transaction>
      <transaction id="9003">
        <individual id="1001">Ada Example</individual>
        <date>2025-12-28</date>
        <transaction_details>
          <transaction_detail id="5004"><coa id="7">General Fund</coa><amount>20</amount></transaction_detail>
        </transaction_details>
      </transaction>
    </transactions></response></ccb_api>"#;

    const NO_TRANSACTIONS: &str =
        r#"<ccb_api><response><transactions count="0"/></response></ccb_api>"#;

    fn linked_user() -> GivingUser {
        GivingUser {
            id: USER_ID.to_owned(),
            ccb_id: Some("1001".to_owned()),
            ccb_family_id: Some("2001".to_owned()),
        }
    }

    fn ccb(server: &MockServer) -> CcbClient {
        let config = CcbConfig {
            api_endpoint: format!("{}/api.php", server.uri()),
            username: "example-user".to_owned(),
            password: Secret::new("example-password"),
        };
        CcbClient::new(
            &config,
            crate::upstream::http_client().unwrap(),
            Metrics::new(),
            Arc::new(MemoryStore::new("rs:")),
        )
    }

    /// One `transactions_by_family` answer for `year`'s window, expected `times` times.
    async fn mount_year(server: &MockServer, year: i32, body: &str, times: u64) {
        Mock::given(method("GET"))
            .and(path("/api.php"))
            .and(query_param("srv", "transactions_by_family"))
            .and(query_param("family_id", "2001"))
            .and(query_param(
                "modified_since",
                format!("{}-12-31", year - 1).as_str(),
            ))
            .and(query_param("date_end", format!("{year}-12-31").as_str()))
            .respond_with(ResponseTemplate::new(200).set_body_string(body))
            .expect(times)
            .mount(server)
            .await;
    }

    /// CCB answering 2026 with [`FAMILY_2026`], 2025 with its gift, and nothing before.
    async fn family_ccb(times: u64) -> MockServer {
        let server = MockServer::start().await;
        mount_year(&server, 2026, FAMILY_2026, times).await;
        mount_year(&server, 2025, FAMILY_2026, times).await;
        for year in 2022..=2024 {
            mount_year(&server, year, NO_TRANSACTIONS, times).await;
        }
        server
    }

    struct Fixture {
        store: Arc<FakeGivingStore>,
        redis: Arc<MemoryStore>,
        schema: crate::graphql::AppSchema,
    }

    fn fixture(store: FakeGivingStore, ccb: Option<CcbClient>) -> Fixture {
        let store = Arc::new(store);
        let redis = Arc::new(MemoryStore::new("rs:"));
        let schema = schema_from(&TestServices {
            clock: Clock::fixed(NOW),
            store: redis.clone(),
            giving_store: store.clone(),
            ccb,
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

    /// Waits for the background writes.
    async fn eventually(check: impl Fn() -> bool) {
        for _ in 0..400 {
            if check() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        panic!("the background write never happened");
    }

    fn empty_year(year: i32) -> Value {
        json!({
            "ccbId": "1001", "numberOfGiving": 0, "total": 0.0, "year": year,
            "giving": [], "groupGivingByMonth": [],
        })
    }

    #[tokio::test]
    async fn reads_five_years_from_ccb_and_persists_them() {
        let server = family_ccb(1).await;
        let fixture = fixture(
            FakeGivingStore::with_user(UID, linked_user()),
            Some(ccb(&server)),
        );

        let body = query(&fixture, USER_GIVING_QUERY).await;

        let march = json!({
            "amount": 10.0, "campus": "", "campusId": "", "date": "2026-03-01",
            "name": "General Fund", "paymentType": null, "taxDeductible": true,
            "transactionId": "5003",
        });
        let general = json!({
            "amount": 50.0, "campus": "Example Campus", "campusId": "1", "date": "2026-01-04",
            "name": "General Fund", "paymentType": "Credit Card", "taxDeductible": true,
            "transactionId": "5001",
        });
        let building = json!({
            "amount": 25.5, "campus": "Example Campus", "campusId": "1", "date": "2026-01-04",
            "name": "Building Fund", "paymentType": "Credit Card", "taxDeductible": false,
            "transactionId": "5002",
        });
        let late = json!({
            "amount": 20.0, "campus": "", "campusId": "", "date": "2025-12-28",
            "name": "General Fund", "paymentType": null, "taxDeductible": true,
            "transactionId": "5004",
        });
        assert_eq!(
            body,
            json!({ "data": { "myGivingHistory": {
                "__typename": "MyGivingHistorySuccess",
                "years": [
                    {
                        "ccbId": "1001", "numberOfGiving": 3, "total": 85.5, "year": 2026,
                        "giving": [march, general, building],
                        "groupGivingByMonth": [
                            { "month": "March", "givingList": [march], "number": 1, "total": 10.0 },
                            { "month": "January", "givingList": [general, building], "number": 2, "total": 75.5 },
                        ],
                    },
                    {
                        "ccbId": "1001", "numberOfGiving": 1, "total": 20.0, "year": 2025,
                        "giving": [late],
                        "groupGivingByMonth": [
                            { "month": "December", "givingList": [late], "number": 1, "total": 20.0 },
                        ],
                    },
                    empty_year(2024),
                    empty_year(2023),
                    empty_year(2022),
                ],
            } } })
        );

        // Every year is rewritten in Postgres and cached in Redis in the background.
        eventually(|| fixture.store.sync_count() == 5).await;
        let syncs = fixture.store.syncs.lock().unwrap().clone();
        let sync_2026 = syncs.iter().find(|sync| sync.year == 2026).unwrap();
        assert_eq!(sync_2026.user_id, USER_ID);
        assert_eq!(sync_2026.ccb_id, "1001");
        assert_eq!(sync_2026.total_amount, "85.50");
        assert_eq!(sync_2026.synced_at_ms, NOW);
        assert_eq!(
            sync_2026.rows[0],
            DonationRow {
                ccb_transaction_id: "5003".to_owned(),
                amount: "10".to_owned(),
                date: "2026-03-01".to_owned(),
                name: "General Fund".to_owned(),
                campus: None,
                campus_id: None,
                payment_type: None,
                tax_deductible: true,
            }
        );
        assert_eq!(sync_2026.rows[2].amount, "25.5");
        let key = "rs:donations-v3:user-ada:2001:1001:2026";
        eventually(|| fixture.redis.raw(key).is_some()).await;
        assert_eq!(
            fixture.redis.ttl(key).await.unwrap(),
            (LAST_REFRESH + 7 * 86_400_000 - NOW) / 1000
        );

        // The next read is answered from memory: CCB is asked once per year (`expect(1)`).
        assert_eq!(query(&fixture, USER_GIVING_QUERY).await, body);
    }

    #[tokio::test]
    async fn answers_from_postgres_while_the_summary_is_current() {
        let store = FakeGivingStore::with_user(UID, linked_user());
        let summary = |ccb_id: Option<&str>, synced: i64| SummaryRow {
            ccb_id: ccb_id.map(str::to_owned),
            total_amount: "15.00".to_owned(),
            number_of_donations: 2,
            last_synced_at_ms: synced,
            is_stale: false,
        };
        let rows = vec![
            DonationRow {
                ccb_transaction_id: "6001".to_owned(),
                amount: "5.00".to_owned(),
                date: "2024-02-10".to_owned(),
                name: "General Fund".to_owned(),
                campus: Some("Example Campus".to_owned()),
                campus_id: Some("1".to_owned()),
                payment_type: Some(String::new()),
                tax_deductible: true,
            },
            DonationRow {
                ccb_transaction_id: "6002".to_owned(),
                amount: "10.00".to_owned(),
                date: "2024-02-20".to_owned(),
                name: "Missions".to_owned(),
                campus: None,
                campus_id: None,
                payment_type: Some("Check".to_owned()),
                tax_deductible: false,
            },
        ];
        // 2024 is current; 2023 was synced before Monday's import; 2022 belongs to another
        // CCB individual. 2026 and 2025 have no summary.
        store.insert_year(
            USER_ID,
            2024,
            summary(Some("1001"), LAST_REFRESH),
            rows.clone(),
        );
        store.insert_year(
            USER_ID,
            2023,
            summary(Some("1001"), LAST_REFRESH - 1),
            rows.clone(),
        );
        store.insert_year(USER_ID, 2022, summary(Some("1002"), NOW), rows);
        let server = MockServer::start().await;
        for year in [2026, 2025, 2023, 2022] {
            mount_year(&server, year, NO_TRANSACTIONS, 1).await;
        }
        mount_year(&server, 2024, NO_TRANSACTIONS, 0).await;
        let fixture = fixture(store, Some(ccb(&server)));

        let body = query(
            &fixture,
            "query Q { getPreviousFiveYearsGivingV2 { year total numberOfGiving giving { amount campus campusId date name paymentType taxDeductible transactionId } groupGivingByMonth { month number total givingList { transactionId } } } }",
        )
        .await;

        let years = &body["data"]["getPreviousFiveYearsGivingV2"];
        assert_eq!(
            years[2],
            json!({
                "year": 2024, "total": 15.0, "numberOfGiving": 2,
                // Newest first; an empty payment type is null, a missing campus is "".
                "giving": [
                    {
                        "amount": 10.0, "campus": "", "campusId": "", "date": "2024-02-20",
                        "name": "Missions", "paymentType": "Check", "taxDeductible": false,
                        "transactionId": "6002",
                    },
                    {
                        "amount": 5.0, "campus": "Example Campus", "campusId": "1",
                        "date": "2024-02-10", "name": "General Fund", "paymentType": null,
                        "taxDeductible": true, "transactionId": "6001",
                    },
                ],
                "groupGivingByMonth": [{
                    "month": "February", "number": 2, "total": 15.0,
                    "givingList": [{ "transactionId": "6002" }, { "transactionId": "6001" }],
                }],
            })
        );
        for (index, year) in [(0, 2026), (1, 2025), (3, 2023), (4, 2022)] {
            assert_eq!(years[index]["year"], year);
            assert_eq!(years[index]["numberOfGiving"], 0, "{year} was refetched");
        }
        // The Postgres hit warms Redis, silently.
        eventually(|| {
            fixture
                .redis
                .raw("rs:donations-v3:user-ada:2001:1001:2024")
                .is_some()
        })
        .await;
    }

    #[tokio::test]
    async fn refetches_a_year_whose_rows_disagree_with_their_summary() {
        let logs = LogCapture::default();
        let _guard = logs.install();
        let store = FakeGivingStore::with_user(UID, linked_user());
        store.insert_year(
            USER_ID,
            2024,
            SummaryRow {
                ccb_id: Some("1001".to_owned()),
                total_amount: "99.00".to_owned(),
                number_of_donations: 1,
                last_synced_at_ms: NOW,
                is_stale: false,
            },
            vec![],
        );
        let server = MockServer::start().await;
        for year in 2022..=2026 {
            mount_year(&server, year, NO_TRANSACTIONS, 1).await;
        }
        let fixture = fixture(store, Some(ccb(&server)));

        let body = query(&fixture, USER_GIVING_QUERY).await;

        assert_eq!(
            body["data"]["myGivingHistory"]["years"][2],
            empty_year(2024)
        );
        assert!(
            logs.lines().iter().any(|line| line
                .starts_with("Warn DB donation summary mismatch detected, forcing CCB refetch")),
            "{:#?}",
            logs.lines()
        );
        // Flagged stale, then rewritten by the refetch.
        eventually(|| fixture.store.sync_count() == 5).await;
        let summary = fixture.store.summary_of(USER_ID, 2024).unwrap();
        assert_eq!(
            (summary.total_amount.as_str(), summary.number_of_donations),
            ("0.00", 0)
        );
    }

    #[tokio::test]
    async fn answers_not_found_without_a_linked_member() {
        let not_found = |message: &str| {
            json!({ "data": { "myGivingHistory": {
                "__typename": "MyGivingHistoryNotFoundError", "message": message,
            } } })
        };
        let unknown = fixture(FakeGivingStore::default(), None);
        assert_eq!(
            query(&unknown, USER_GIVING_QUERY).await,
            not_found("Giving profile was not found")
        );

        for (ccb_id, family) in [
            (None, Some("2001")),
            (Some("1001"), Some("")),
            (Some(""), None),
        ] {
            let user = GivingUser {
                id: USER_ID.to_owned(),
                ccb_id: ccb_id.map(str::to_owned),
                ccb_family_id: family.map(str::to_owned),
            };
            let unlinked = fixture(FakeGivingStore::with_user(UID, user), None);
            assert_eq!(
                query(&unlinked, USER_GIVING_QUERY).await,
                not_found("CCB giving profile is not linked")
            );
            assert_eq!(
                query(
                    &unlinked,
                    "query Q { getPreviousFiveYearsGivingV2 { year } }"
                )
                .await,
                json!({ "data": { "getPreviousFiveYearsGivingV2": null } })
            );
        }
    }

    #[tokio::test]
    async fn answers_a_fetch_error_and_logs_the_failed_step() {
        let logs = LogCapture::default();
        let _guard = logs.install();
        let fetch_error = json!({ "data": { "myGivingHistory": {
            "__typename": "MyGivingHistoryFetchError",
            "message": "Failed to fetch previous five years giving",
        } } });

        let store = FakeGivingStore::with_user(UID, linked_user());
        store.set_failing(true);
        let failing_db = fixture(store, None);
        assert_eq!(query(&failing_db, USER_GIVING_QUERY).await, fetch_error);

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api.php"))
            .respond_with(ResponseTemplate::new(401))
            .mount(&server)
            .await;
        let failing_ccb = fixture(
            FakeGivingStore::with_user(UID, linked_user()),
            Some(ccb(&server)),
        );
        assert_eq!(query(&failing_ccb, USER_GIVING_QUERY).await, fetch_error);

        let no_ccb = fixture(FakeGivingStore::with_user(UID, linked_user()), None);
        assert_eq!(query(&no_ccb, USER_GIVING_QUERY).await, fetch_error);

        let lines = logs.lines();
        let failures: Vec<&String> = lines
            .iter()
            .filter(|line| line.starts_with("Error Failed to fetch giving history"))
            .collect();
        assert_eq!(failures.len(), 3, "{lines:#?}");
        assert!(
            failures[0].contains(r#""step":"lookupUser""#),
            "{}",
            failures[0]
        );
        assert!(
            failures[1].contains(r#""error":"CCB API error: 401""#),
            "{}",
            failures[1]
        );
        assert!(
            failures[1].contains(r#""step":"fetchGiving""#),
            "{}",
            failures[1]
        );
        assert!(
            failures[2].contains(r#""error":"CCB is not configured""#),
            "{}",
            failures[2]
        );
        // No CCB failure persisted anything.
        assert_eq!(failing_ccb.store.sync_count(), 0);
    }

    #[tokio::test]
    async fn masks_failures_of_the_v2_field() {
        let store = FakeGivingStore::with_user(UID, linked_user());
        store.set_failing(true);
        let fixture = fixture(store, None);
        let body = query(
            &fixture,
            "query Q { getPreviousFiveYearsGivingV2 { year } }",
        )
        .await;
        assert_eq!(
            body["data"],
            json!({ "getPreviousFiveYearsGivingV2": null })
        );
        assert_eq!(body["errors"][0]["message"], "Unexpected error.");
    }

    #[tokio::test]
    async fn needs_a_full_sign_in() {
        let fixture = fixture(FakeGivingStore::with_user(UID, linked_user()), None);
        let anonymous = Viewer {
            uid: UID.to_owned(),
            email: None,
            kind: AuthKind::FirebaseAnonymous,
        };
        let body = execute_like_handler(&fixture.schema, USER_GIVING_QUERY, Some(anonymous)).await;
        assert_eq!(body["data"], json!({ "myGivingHistory": null }));
        assert_eq!(
            body["errors"][0]["message"],
            "Not authorized to resolve Query.myGivingHistory"
        );
        assert_eq!(
            fixture
                .store
                .reads
                .load(std::sync::atomic::Ordering::SeqCst),
            0
        );
    }
}
