//! `CCBService` (`apps/server/src/effect/services/CCBService.ts`) without its writes: one method
//! per read service, each answered from [`CcbCache`] or else from CCB through [`Transport`].

use std::sync::Arc;

use serde::Serialize;
use serde::de::DeserializeOwned;

use super::CcbError;
use super::cache::{CacheClock, CcbCache};
use super::records::{
    AttendanceProfile, FamilyTransactions, GroupParticipants, IndividualGroups, IndividualSearch,
};
use super::request::CcbRequest;
use super::transport::Transport;
use crate::config::CcbConfig;
use crate::metrics::Metrics;
use crate::store::kv::KeyValueStore;

/// Cloning is cheap; clones share the cache.
#[derive(Clone)]
pub struct CcbClient {
    transport: Arc<Transport>,
    cache: CcbCache,
}

impl CcbClient {
    pub fn new(
        config: &CcbConfig,
        http: reqwest::Client,
        metrics: Metrics,
        store: Arc<dyn KeyValueStore>,
    ) -> Self {
        Self {
            transport: Arc::new(Transport::new(config, http, metrics)),
            cache: CcbCache::new(store, CacheClock::system()),
        }
    }

    /// `searchUserByEmail`.
    pub async fn individual_search(&self, email: &str) -> Result<IndividualSearch, CcbError> {
        self.get(CcbRequest::individual_search(email)).await
    }

    /// `getUserGroupsById`.
    pub async fn individual_groups(
        &self,
        individual_id: u64,
    ) -> Result<IndividualGroups, CcbError> {
        self.get(CcbRequest::individual_groups(individual_id)).await
    }

    /// `getGroupParticipants`.
    pub async fn group_participants(&self, group_id: u64) -> Result<GroupParticipants, CcbError> {
        self.get(CcbRequest::group_participants(group_id)).await
    }

    /// `getAttendanceProfile`.
    pub async fn attendance_profile(
        &self,
        event_id: u64,
        occurrence: &str,
    ) -> Result<AttendanceProfile, CcbError> {
        self.get(CcbRequest::attendance_profile(event_id, occurrence))
            .await
    }

    /// `getGiving`.
    pub async fn transactions_by_family(
        &self,
        family_id: &str,
        year: i32,
    ) -> Result<FamilyTransactions, CcbError> {
        self.get(CcbRequest::transactions_by_family(family_id, year))
            .await
    }

    /// `getGiving(familyId, year, { skipCache: true })`: CCB's answer, cached nowhere, for the
    /// giving service, which keeps its own cache of the result. A cached answer could predate the
    /// weekly import and would then be stored as current until the next one.
    pub async fn transactions_by_family_uncached(
        &self,
        family_id: &str,
        year: i32,
    ) -> Result<FamilyTransactions, CcbError> {
        let request = CcbRequest::transactions_by_family(family_id, year);
        self.transport.get(&request).await.inspect_err(|error| {
            tracing::error!(action = request.service().srv(), error = %error, "CCB GET error");
        })
    }

    /// `CCBService.get`: the cached answer, else CCB's. A failure is logged as TS logs it, naming
    /// the service rather than the query.
    async fn get<T>(&self, request: CcbRequest) -> Result<T, CcbError>
    where
        T: Serialize + DeserializeOwned + Send + Sync + 'static,
    {
        let transport = self.transport.clone();
        let load_request = request.clone();
        let load = move || async move { transport.get::<T>(&load_request).await };
        self.cache.get(&request, load).await.inspect_err(|error| {
            tracing::error!(action = request.service().srv(), error = %error, "CCB GET error");
        })
    }
}

#[cfg(test)]
mod tests {
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::config::Secret;
    use crate::store::kv::MemoryStore;
    use crate::strapi::record_cache::testing::LogCapture;
    use crate::test_support::TestApp;

    const SEARCH: &str = r#"<ccb_api><response><individuals count="1"><individual id="1001"><first_name>Ada</first_name><last_name>Example</last_name><login>ada@example.com</login><email>ada@example.com</email></individual></individuals></response></ccb_api>"#;

    fn client(server: &MockServer, store: Arc<MemoryStore>) -> CcbClient {
        let config = CcbConfig {
            api_endpoint: format!("{}/api.php", server.uri()),
            username: "example-user".to_owned(),
            password: Secret::new("example-password"),
        };
        CcbClient::new(
            &config,
            crate::upstream::http_client().unwrap(),
            Metrics::new(),
            store,
        )
    }

    /// Expects exactly one GET with `params`, answered with `body`.
    async fn expect_one(server: &MockServer, params: &[(&str, &str)], body: &str) {
        let mut mock = Mock::given(method("GET")).and(path("/api.php"));
        for (name, value) in params {
            mock = mock.and(query_param(*name, *value));
        }
        mock.respond_with(ResponseTemplate::new(200).set_body_string(body))
            .expect(1)
            .mount(server)
            .await;
    }

    #[tokio::test]
    async fn reads_through_the_cache_with_one_ccb_request() {
        let server = MockServer::start().await;
        expect_one(
            &server,
            &[("srv", "individual_search"), ("email", "ada@example.com")],
            SEARCH,
        )
        .await;
        let store = Arc::new(MemoryStore::new("rs:"));
        let client = client(&server, store.clone());

        let first = client.individual_search("ada@example.com").await.unwrap();
        let second = client.individual_search("ada@example.com").await.unwrap();

        assert_eq!(first, second);
        assert_eq!(
            first.individuals.unwrap().individual[0].login.as_deref(),
            Some("ada@example.com")
        );
        assert!(
            store
                .raw("rs:ccb:1:srv=individual_search&email=ada%40example.com")
                .is_some()
        );
    }

    #[tokio::test]
    async fn sends_each_service_its_query() {
        let server = MockServer::start().await;
        expect_one(
            &server,
            &[("srv", "individual_groups"), ("individual_id", "1001")],
            r#"<ccb_api><response><individuals count="0"/></response></ccb_api>"#,
        )
        .await;
        expect_one(
            &server,
            &[("srv", "group_participants"), ("id", "3001")],
            r#"<ccb_api><response><groups count="0"><group id="3001"><participants count="0"/></group></groups></response></ccb_api>"#,
        )
        .await;
        expect_one(
            &server,
            &[("srv", "attendance_profile"), ("id", "4001"), ("occurrence", "2026-10-04")],
            r#"<ccb_api><response><events count="1"><event id="4001"><attendees/></event></events></response></ccb_api>"#,
        )
        .await;
        expect_one(
            &server,
            &[
                ("srv", "transactions_by_family"),
                ("family_id", "2001"),
                ("modified_since", "2025-12-31"),
                ("date_end", "2026-12-31"),
            ],
            r#"<ccb_api><response><transactions count="0"/></response></ccb_api>"#,
        )
        .await;
        let client = client(&server, Arc::new(MemoryStore::new("rs:")));

        assert!(client.individual_groups(1001).await.is_ok());
        assert!(client.group_participants(3001).await.is_ok());
        assert!(client.attendance_profile(4001, "2026-10-04").await.is_ok());
        assert!(client.transactions_by_family("2001", 2026).await.is_ok());
    }

    #[tokio::test]
    async fn logs_a_failure_and_caches_nothing() {
        let logs = LogCapture::default();
        let _guard = logs.install();
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api.php"))
            .respond_with(ResponseTemplate::new(401))
            .expect(1)
            .mount(&server)
            .await;
        let store = Arc::new(MemoryStore::new("rs:"));

        let result = client(&server, store.clone())
            .individual_search("ada@example.com")
            .await;

        assert_eq!(result, Err(CcbError::Status { status: 401 }));
        assert!(store.keys().is_empty());
        assert_eq!(
            logs.lines(),
            [
                r#"Warn CCB GET request failed {"action":"individual_search","status":"401"}"#,
                r#"Error CCB GET error {"action":"individual_search","error":"CCB API error: 401"}"#,
            ]
        );
    }

    #[tokio::test]
    async fn exists_only_when_all_three_variables_are_set() {
        assert!(TestApp::new().state.ccb.is_none());
        let app = TestApp::with_env(&[
            ("CCB_API_END_POINT", "https://example.ccbchurch.com/api.php"),
            ("CCB_USERNAME", "example-user"),
            ("CCB_PASSWORD", "example-password"),
        ]);
        assert!(app.state.ccb.is_some());
    }
}
