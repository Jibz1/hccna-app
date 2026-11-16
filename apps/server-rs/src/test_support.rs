//! Shared helpers for in-process router tests.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::body::Body;
use axum::http::{HeaderMap, Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

use crate::config::Config;
use crate::fields::core::{CoreSettingsRow, CoreSettingsSource, RowFuture};
use crate::google::GoogleAuth;
use crate::google::firestore::{Document, DocumentFuture, DocumentSource, FirestoreError};
use crate::graphql::auth::testing::GoogleMock;
use crate::http;
use crate::http::request_log::GraphqlOperationInfo;
use crate::state::{AppState, Dependencies};
use crate::statsig::FeatureGates;
use crate::store::kv::MemoryStore;
use crate::strapi::records::{
    CampusRecord, EventQuery, EventRecord, SermonPage, SermonQuery, ThoughtOfGodRecord,
};
use crate::strapi::{CmsContentError, CmsContentErrorReason, CmsFuture, CmsSource};

/// Configuration whose Redis and Postgres point at a closed port, plus `vars`.
pub fn config(vars: &[(&str, &str)]) -> Config {
    let mut map: HashMap<String, String> = [
        ("DATABASE_URL", "postgres://ada:pw@127.0.0.1:1/example"),
        ("REDIS_HOST", "127.0.0.1"),
        ("REDIS_PORT", "1"),
        ("DB_CONNECTION_TIMEOUT_MS", "500"),
        // Tests never reach Google: unless a test points these at a mock, they hit a closed port.
        ("GOOGLE_JWKS_URL", "http://127.0.0.1:1/jwks"),
        ("IDENTITY_TOOLKIT_URL", "http://127.0.0.1:1"),
        ("FIREBASE_PROJECT_ID", "example-project"),
        ("CCB_FORMS_URL", "http://127.0.0.1:1/api/forms"),
        ("CMS_V5_ENDPOINT", "http://127.0.0.1:1/graphql"),
        ("CMS_V5_TOKEN", "example-cms-token"),
        // Never the real TS server: forwarded requests hit a closed port unless a test starts a
        // `MockOrigin`.
        ("TS_ORIGIN_URL", "http://127.0.0.1:1"),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_owned(), v.to_owned()))
    .collect();
    for (k, v) in vars {
        map.insert((*k).to_owned(), (*v).to_owned());
    }
    Config::from_lookup(move |name| map.get(name).cloned()).expect("test config is valid")
}

/// The router over an in-memory key-value store. The gateway's kill switch is on (local serving
/// allowed) unless a test replaces `Dependencies::kill_switch`.
pub struct TestApp {
    pub state: AppState,
    pub store: Arc<MemoryStore>,
}

impl TestApp {
    pub fn new() -> Self {
        Self::with_env(&[])
    }

    pub fn with_env(vars: &[(&str, &str)]) -> Self {
        Self::build(vars, None)
    }

    /// Firebase pointed at `mock`, with `google` as the account lookup's credentials.
    pub fn with_google(mock: &GoogleMock, google: Option<GoogleAuth>) -> Self {
        let env = mock.env();
        let vars: Vec<(&str, &str)> = env.iter().map(|(k, v)| (*k, v.as_str())).collect();
        Self::build(&vars, google)
    }

    pub fn build(vars: &[(&str, &str)], google: Option<GoogleAuth>) -> Self {
        Self::assemble(vars, google, Arc::new(MemoryStore::new("rs:")), |_| {})
    }

    /// An app over `store`, so two apps can share "Redis" like two replicas.
    pub fn with_store(store: Arc<MemoryStore>) -> Self {
        Self::assemble(&[], None, store, |_| {})
    }

    /// Firebase pointed at `mock` (with working credentials) and CMS content from `cms`.
    pub fn with_cms(mock: &GoogleMock, google: GoogleAuth, cms: Arc<dyn CmsSource>) -> Self {
        Self::with_dependencies(mock, google, |dependencies| dependencies.cms = Some(cms))
    }

    /// `vars` on top of the test configuration, with `replace` swapping in fakes.
    pub fn with_env_and(vars: &[(&str, &str)], replace: impl FnOnce(&mut Dependencies)) -> Self {
        Self::assemble(vars, None, Arc::new(MemoryStore::new("rs:")), replace)
    }

    /// Firebase pointed at `mock` (with working credentials), with `replace` swapping in fakes.
    pub fn with_dependencies(
        mock: &GoogleMock,
        google: GoogleAuth,
        replace: impl FnOnce(&mut Dependencies),
    ) -> Self {
        let env = mock.env();
        let vars: Vec<(&str, &str)> = env.iter().map(|(k, v)| (*k, v.as_str())).collect();
        Self::assemble(
            &vars,
            Some(google),
            Arc::new(MemoryStore::new("rs:")),
            replace,
        )
    }

    fn assemble(
        vars: &[(&str, &str)],
        google: Option<GoogleAuth>,
        store: Arc<MemoryStore>,
        replace: impl FnOnce(&mut Dependencies),
    ) -> Self {
        let mut dependencies = Dependencies {
            kv: store.clone(),
            google,
            cms: None,
            core_settings: None,
            gates: None,
            documents: None,
            kill_switch: Some(Arc::new(crate::statsig::testing::FixedGates::passing(&[
                crate::gateway::route::SERVE_LOCALLY_GATE,
            ]))),
            giving_store: Some(Arc::new(
                crate::fields::giving_history::store::testing::FakeGivingStore::default(),
            )),
            woa_store: Some(Arc::new(
                crate::fields::user::store::testing::FakeWoaStore::default(),
            )),
        };
        replace(&mut dependencies);
        Self {
            state: AppState::with_dependencies(config(vars), dependencies)
                .expect("test state builds"),
            store,
        }
    }

    /// The router's response as it is, for tests that read raw (compressed) bodies.
    pub async fn send_raw(&self, request: Request<Body>) -> axum::response::Response {
        http::router(self.state.clone())
            .oneshot(request)
            .await
            .expect("the router is infallible")
    }

    pub async fn send(&self, request: Request<Body>) -> TestResponse {
        let response = self.send_raw(request).await;
        let status = response.status();
        let headers = response.headers().clone();
        let graphql = response.extensions().get::<GraphqlOperationInfo>().cloned();
        let body = response
            .into_body()
            .collect()
            .await
            .expect("test bodies are readable")
            .to_bytes();
        TestResponse {
            status,
            headers,
            body: String::from_utf8(body.to_vec()).expect("bodies are UTF-8"),
            graphql,
        }
    }
}

pub struct TestResponse {
    pub status: StatusCode,
    pub headers: HeaderMap,
    pub body: String,
    /// What the handler recorded for the request log and metrics.
    pub graphql: Option<GraphqlOperationInfo>,
}

impl TestResponse {
    pub fn json(&self) -> Value {
        serde_json::from_str(&self.body).expect("the body is JSON")
    }
}

/// Runs `query` against `schema` and finishes the response the way the handler does
/// (null propagation, masking), returning the rendered body.
pub async fn execute_like_handler<Q, M, S>(
    schema: &async_graphql::Schema<Q, M, S>,
    query: &str,
    viewer: Option<crate::graphql::auth::Viewer>,
) -> Value
where
    Q: async_graphql::ObjectType + 'static,
    M: async_graphql::ObjectType + 'static,
    S: async_graphql::SubscriptionType + 'static,
{
    execute_with_variables(schema, query, Value::Null, viewer).await
}

/// [`execute_like_handler`] with `variables` (a JSON object, or `null` for none).
pub async fn execute_with_variables<Q, M, S>(
    schema: &async_graphql::Schema<Q, M, S>,
    query: &str,
    variables: Value,
    viewer: Option<crate::graphql::auth::Viewer>,
) -> Value
where
    Q: async_graphql::ObjectType + 'static,
    M: async_graphql::ObjectType + 'static,
    S: async_graphql::SubscriptionType + 'static,
{
    let index = crate::graphql::complexity::SchemaIndex::from_sdl(&schema.sdl())
        .expect("a schema's own SDL parses");
    let document = crate::graphql::operation::parse_document(query).expect("the query parses");
    let mut request = async_graphql::Request::new(query)
        .variables(async_graphql::Variables::from_json(variables));
    if let Some(viewer) = viewer {
        request = request.data(viewer);
    }
    // As the handler does: one set of per-request loaders.
    request = request.data(crate::fields::RequestLoaders::default());
    let mut response = schema.execute(request).await;
    crate::graphql::nulls::propagate(&index, &document, None, &mut response);
    crate::graphql::errors::finish(&mut response);
    serde_json::from_slice(&crate::graphql::handler::render(&response)).expect("the body is JSON")
}

/// `POST /graphql` with a JSON body and a bearer token.
pub fn post_graphql_as(body: Value, token: &str) -> Request<Body> {
    let mut request = post_graphql(body);
    request.headers_mut().insert(
        "authorization",
        format!("Bearer {token}").parse().expect("a valid header"),
    );
    request
}

/// `POST /graphql` with a JSON body.
pub fn post_graphql(body: Value) -> Request<Body> {
    Request::post("/graphql")
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .expect("a valid request")
}

/// A signed-in caller, as the `Authorized` guard needs.
pub fn viewer() -> crate::graphql::auth::Viewer {
    crate::graphql::auth::Viewer {
        uid: "ada-example-uid".to_owned(),
        email: Some("ada@example.com".to_owned()),
        kind: crate::graphql::auth::AuthKind::Jwt,
    }
}

type Reply<T> = Box<dyn Fn() -> Result<T, CmsContentError> + Send + Sync>;
type SermonReply = Box<dyn Fn(&SermonQuery) -> Result<SermonPage, CmsContentError> + Send + Sync>;

/// CMS content served from records, like the TS tests' fake `CmsContent` layers. Members that
/// were not given an answer fail as `Unavailable`. Every query is recorded.
#[derive(Default)]
pub struct FakeCms {
    campuses: Option<Reply<Vec<CampusRecord>>>,
    events: Option<Reply<Vec<EventRecord>>>,
    sermons: Option<SermonReply>,
    thought_of_god: Option<Reply<Option<ThoughtOfGodRecord>>>,
    pub event_queries: Mutex<Vec<EventQuery>>,
    pub sermon_queries: Mutex<Vec<SermonQuery>>,
    pub calls: Mutex<u32>,
}

impl FakeCms {
    pub fn with_sermons(
        mut self,
        reply: impl Fn(&SermonQuery) -> Result<SermonPage, CmsContentError> + Send + Sync + 'static,
    ) -> Self {
        self.sermons = Some(Box::new(reply));
        self
    }

    pub fn with_campuses(
        mut self,
        reply: impl Fn() -> Result<Vec<CampusRecord>, CmsContentError> + Send + Sync + 'static,
    ) -> Self {
        self.campuses = Some(Box::new(reply));
        self
    }

    pub fn with_events(
        mut self,
        reply: impl Fn() -> Result<Vec<EventRecord>, CmsContentError> + Send + Sync + 'static,
    ) -> Self {
        self.events = Some(Box::new(reply));
        self
    }

    pub fn with_thought_of_god(
        mut self,
        reply: impl Fn() -> Result<Option<ThoughtOfGodRecord>, CmsContentError> + Send + Sync + 'static,
    ) -> Self {
        self.thought_of_god = Some(Box::new(reply));
        self
    }

    pub fn calls(&self) -> u32 {
        *self.calls.lock().expect("not poisoned")
    }

    fn answer<T: Send + 'static>(
        &self,
        operation: &'static str,
        reply: Option<Result<T, CmsContentError>>,
    ) -> CmsFuture<'_, T> {
        *self.calls.lock().expect("not poisoned") += 1;
        let result = reply.unwrap_or_else(|| Err(not_faked(operation)));
        Box::pin(async move { result })
    }
}

fn not_faked(operation: &'static str) -> CmsContentError {
    CmsContentError {
        reason: CmsContentErrorReason::Unavailable,
        operation,
        detail: "not faked".to_owned(),
    }
}

impl CmsSource for FakeCms {
    fn campuses(&self) -> CmsFuture<'_, Vec<CampusRecord>> {
        self.answer("campuses", self.campuses.as_ref().map(|reply| reply()))
    }

    fn events(&self, query: EventQuery) -> CmsFuture<'_, Vec<EventRecord>> {
        self.event_queries.lock().expect("not poisoned").push(query);
        self.answer("events", self.events.as_ref().map(|reply| reply()))
    }

    fn sermons(&self, query: SermonQuery) -> CmsFuture<'_, SermonPage> {
        let reply = self.sermons.as_ref().map(|reply| reply(&query));
        self.sermon_queries
            .lock()
            .expect("not poisoned")
            .push(query);
        self.answer("sermons", reply)
    }

    fn thought_of_god(&self) -> CmsFuture<'_, Option<ThoughtOfGodRecord>> {
        self.answer(
            "thoughtOfGod",
            self.thought_of_god.as_ref().map(|reply| reply()),
        )
    }
}

/// The application schema over `cms`, with CCB forms pointed at a closed port.
pub fn schema_with(cms: Arc<dyn CmsSource>) -> crate::graphql::AppSchema {
    schema_at(cms, crate::fields::Clock::system())
}

/// [`schema_with`] with its resolvers reading `clock`.
pub fn schema_at(
    cms: Arc<dyn CmsSource>,
    clock: crate::fields::Clock,
) -> crate::graphql::AppSchema {
    schema_from(&TestServices {
        cms,
        clock,
        ..TestServices::default()
    })
}

/// Everything the schema's resolvers reach, faked. The default answers nothing: CMS members and
/// the core settings fail, and every gate is off.
pub struct TestServices {
    pub cms: Arc<dyn CmsSource>,
    pub clock: crate::fields::Clock,
    pub core_settings: Arc<dyn CoreSettingsSource>,
    pub gates: Arc<dyn FeatureGates>,
    pub documents: Arc<dyn DocumentSource>,
    /// The "Redis" behind the field caches.
    pub store: Arc<MemoryStore>,
    /// The giving tables.
    pub giving_store: Arc<dyn crate::fields::giving_history::store::GivingStore>,
    /// CCB reads for the giving fields; `None` as when CCB is not configured.
    pub ccb: Option<crate::ccb::CcbClient>,
    /// `User.woa`'s Firestore documents.
    pub woa_store: Arc<dyn crate::fields::user::store::WoaStore>,
}

impl Default for TestServices {
    fn default() -> Self {
        Self {
            cms: Arc::new(FakeCms::default()),
            clock: crate::fields::Clock::system(),
            core_settings: Arc::new(FakeCoreSettings::failing()),
            gates: Arc::new(crate::statsig::DisabledGates),
            documents: Arc::new(FakeDocuments::default()),
            store: Arc::new(MemoryStore::new("rs:")),
            giving_store: Arc::new(
                crate::fields::giving_history::store::testing::FakeGivingStore::default(),
            ),
            ccb: None,
            woa_store: Arc::new(crate::fields::user::store::testing::FakeWoaStore::default()),
        }
    }
}

/// The application schema over `services`.
pub fn schema_from(services: &TestServices) -> crate::graphql::AppSchema {
    crate::graphql::build_schema(crate::graphql::SchemaData {
        ccb_forms: Arc::new(crate::fields::ccb_forms::CcbFormsLoader::new(
            "http://127.0.0.1:1/api/forms".to_owned(),
            crate::upstream::http_client().expect("the HTTP client builds"),
            crate::metrics::Metrics::new(),
            Arc::new(MemoryStore::new("rs:")),
        )),
        cms: services.cms.clone(),
        clock: services.clock,
        core: Arc::new(crate::fields::core::CoreSettings::new(
            services.core_settings.clone(),
            services.store.clone(),
        )),
        gates: services.gates.clone(),
        giving: Arc::new(crate::fields::giving_history::service::GivingService::new(
            services.giving_store.clone(),
            services.store.clone(),
            services.ccb.clone(),
            services.clock,
        )),
        streams: Arc::new(
            crate::fields::live_stream::projection::StreamProjectionStore::new(
                services.documents.clone(),
            ),
        ),
        vod: Arc::new(crate::fields::vod::VodService::new(
            services.documents.clone(),
            services.store.clone(),
            chrono_tz::America::New_York,
            services.clock,
        )),
        woa: Arc::new(crate::fields::user::woa::WoaService::new(
            services.woa_store.clone(),
            services.store.clone(),
            services.clock,
        )),
    })
}

/// Firestore documents by `collection/id`, or a failing Firestore. Reads are counted in total and
/// per document; a read can fail for one document, and every read can take a set time.
#[derive(Default)]
pub struct FakeDocuments {
    documents: HashMap<String, Document>,
    failing: bool,
    failing_paths: HashSet<String>,
    delay: Option<Duration>,
    reads: Mutex<u32>,
    reads_by_path: Mutex<HashMap<String, u32>>,
    in_flight: Mutex<usize>,
    max_in_flight: Mutex<usize>,
}

impl FakeDocuments {
    pub fn with(mut self, collection: &str, id: &str, document: Document) -> Self {
        self.documents
            .insert(format!("{collection}/{id}"), document);
        self
    }

    /// Every read fails as a Firestore 503 would.
    pub fn failing() -> Self {
        Self {
            failing: true,
            ..Self::default()
        }
    }

    /// Reads of `collection/id` fail as a Firestore 503 would; other documents still answer.
    pub fn failing_on(mut self, collection: &str, id: &str) -> Self {
        self.failing_paths.insert(format!("{collection}/{id}"));
        self
    }

    /// Every read waits `delay` (tokio time) before it answers.
    pub fn with_delay(mut self, delay: Duration) -> Self {
        self.delay = Some(delay);
        self
    }

    pub fn reads(&self) -> u32 {
        *self.reads.lock().expect("not poisoned")
    }

    /// Reads of `collection/id`.
    pub fn reads_of(&self, collection: &str, id: &str) -> u32 {
        self.reads_by_path
            .lock()
            .expect("not poisoned")
            .get(&format!("{collection}/{id}"))
            .copied()
            .unwrap_or_default()
    }

    /// The most reads in progress at the same time.
    pub fn max_in_flight(&self) -> usize {
        *self.max_in_flight.lock().expect("not poisoned")
    }
}

impl DocumentSource for FakeDocuments {
    fn get_document<'a>(&'a self, collection: &'a str, id: &'a str) -> DocumentFuture<'a> {
        let path = format!("{collection}/{id}");
        *self.reads.lock().expect("not poisoned") += 1;
        *self
            .reads_by_path
            .lock()
            .expect("not poisoned")
            .entry(path.clone())
            .or_default() += 1;
        Box::pin(async move {
            {
                let mut in_flight = self.in_flight.lock().expect("not poisoned");
                *in_flight += 1;
                let mut max = self.max_in_flight.lock().expect("not poisoned");
                *max = (*max).max(*in_flight);
            }
            if let Some(delay) = self.delay {
                tokio::time::sleep(delay).await;
            }
            *self.in_flight.lock().expect("not poisoned") -= 1;
            if self.failing || self.failing_paths.contains(&path) {
                Err(FirestoreError::Status(503))
            } else {
                Ok(self.documents.get(&path).cloned())
            }
        })
    }
}

/// A `core_settings` table with one row, none, or a failing connection. Reads are counted.
pub struct FakeCoreSettings {
    row: Result<Option<CoreSettingsRow>, ()>,
    reads: Mutex<u32>,
}

impl FakeCoreSettings {
    pub fn row(row: CoreSettingsRow) -> Self {
        Self::answering(Ok(Some(row)))
    }

    pub fn missing() -> Self {
        Self::answering(Ok(None))
    }

    /// Every read fails as a pool timeout would.
    pub fn failing() -> Self {
        Self::answering(Err(()))
    }

    fn answering(row: Result<Option<CoreSettingsRow>, ()>) -> Self {
        Self {
            row,
            reads: Mutex::new(0),
        }
    }

    pub fn reads(&self) -> u32 {
        *self.reads.lock().expect("not poisoned")
    }
}

impl CoreSettingsSource for FakeCoreSettings {
    fn first_row(&self) -> RowFuture<'_> {
        *self.reads.lock().expect("not poisoned") += 1;
        let row = self.row.clone().map_err(|()| sqlx::Error::PoolTimedOut);
        Box::pin(async move { row })
    }
}

/// One request the mock origin received.
#[derive(Clone, Debug)]
pub struct OriginRequest {
    pub method: axum::http::Method,
    /// Path and query.
    pub uri: String,
    pub headers: HeaderMap,
    pub body: axum::body::Bytes,
}

/// An in-process stand-in for the TS server: axum on `127.0.0.1:0`, answering every request with
/// `reply` after `delay` and recording what it received. The server stops when this is dropped.
pub struct MockOrigin {
    /// `http://127.0.0.1:<port>`, for `TS_ORIGIN_URL`.
    pub url: String,
    requests: Arc<Mutex<Vec<OriginRequest>>>,
    server: tokio::task::JoinHandle<()>,
}

impl MockOrigin {
    pub async fn start(
        reply: impl Fn() -> axum::response::Response + Send + Sync + 'static,
    ) -> Self {
        Self::start_delayed(std::time::Duration::ZERO, reply).await
    }

    pub async fn start_delayed(
        delay: std::time::Duration,
        reply: impl Fn() -> axum::response::Response + Send + Sync + 'static,
    ) -> Self {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("an ephemeral port is free");
        let url = format!(
            "http://{}",
            listener.local_addr().expect("the listener has an address")
        );
        let requests = Arc::new(Mutex::new(Vec::new()));
        let recorded = requests.clone();
        let reply = Arc::new(reply);
        let app = axum::Router::new().fallback(move |request: axum::extract::Request| {
            let recorded = recorded.clone();
            let reply = reply.clone();
            async move {
                let (parts, body) = request.into_parts();
                let body = body
                    .collect()
                    .await
                    .expect("the forwarded body is readable")
                    .to_bytes();
                recorded.lock().expect("not poisoned").push(OriginRequest {
                    method: parts.method,
                    uri: parts.uri.to_string(),
                    headers: parts.headers,
                    body,
                });
                tokio::time::sleep(delay).await;
                reply()
            }
        });
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        Self {
            url,
            requests,
            server,
        }
    }

    /// Every request received so far, in order.
    pub fn requests(&self) -> Vec<OriginRequest> {
        self.requests.lock().expect("not poisoned").clone()
    }
}

impl Drop for MockOrigin {
    fn drop(&mut self) {
        self.server.abort();
    }
}

/// A TS-like answer: `status`, a JSON body and `headers`.
pub fn origin_reply(
    status: StatusCode,
    body: &str,
    headers: &[(&'static str, &'static str)],
) -> axum::response::Response {
    let mut response = axum::response::Response::new(Body::from(body.to_owned()));
    *response.status_mut() = status;
    response.headers_mut().insert(
        axum::http::header::CONTENT_TYPE,
        axum::http::HeaderValue::from_static("application/json; charset=utf-8"),
    );
    for (name, value) in headers {
        response
            .headers_mut()
            .append(*name, axum::http::HeaderValue::from_static(value));
    }
    response
}
