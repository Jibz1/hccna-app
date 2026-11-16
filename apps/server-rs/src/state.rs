use std::sync::Arc;

use sqlx::PgPool;

use crate::ccb::CcbClient;
use crate::config::Config;
use crate::fields::Clock;
use crate::fields::ccb_forms::CcbFormsLoader;
use crate::fields::core::{CoreSettings, CoreSettingsSource, PgCoreSettings};
use crate::fields::giving_history::service::GivingService;
use crate::fields::giving_history::store::{GivingStore, PgGivingStore};
use crate::fields::live_stream::projection::StreamProjectionStore;
use crate::fields::user::store::{FirestoreWoaStore, WoaStore};
use crate::fields::user::woa::WoaService;
use crate::fields::vod::VodService;
use crate::gateway::forward::Forwarder;
use crate::google::GoogleAuth;
use crate::google::firestore::{DocumentSource, FirestoreClient};
use crate::graphql::auth::Authenticator;
use crate::graphql::complexity::SchemaIndex;
use crate::graphql::memo::DocumentMemo;
use crate::graphql::rate_limit::RateLimiter;
use crate::graphql::response_cache::ResponseCache;
use crate::graphql::{self, AppSchema, SchemaData};
use crate::metrics::Metrics;
use crate::statsig::{self, FeatureGates};
use crate::store::kv::KeyValueStore;
use crate::store::{RedisStore, postgres};
use crate::strapi::{CmsContent, CmsSource};
use crate::upstream;

/// Everything a handler needs. Cloning is cheap: every field is reference-counted inside.
#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub metrics: Metrics,
    pub redis: RedisStore,
    pub db: PgPool,
    /// Shared outbound HTTP client; see [`upstream::observe`] for its metrics.
    pub http: reqwest::Client,
    /// The cache commands of the GraphQL pipeline; Redis in production.
    pub kv: Arc<dyn KeyValueStore>,
    pub schema: AppSchema,
    /// The schema's types for the cost model.
    pub complexity: Arc<SchemaIndex>,
    /// Cost verdicts and cache TTLs per document.
    pub documents: Arc<DocumentMemo>,
    pub rate_limiter: Arc<RateLimiter>,
    pub response_cache: Arc<ResponseCache>,
    /// The service account for Google APIs; `None` without credentials.
    pub google: Option<GoogleAuth>,
    pub auth: Arc<Authenticator>,
    /// CMS content: Strapi 5 through the record cache ([`CmsContent`]) unless a test replaced it.
    pub cms: Arc<dyn CmsSource>,
    /// Feature gates; `main` initializes them before serving and shuts them down after.
    pub gates: Arc<dyn FeatureGates>,
    /// Where the gateway's kill switch is read: `gates` unless a test replaced it.
    pub kill_switch: Arc<dyn FeatureGates>,
    /// Sends what this server does not answer to the TS server.
    pub forwarder: Arc<Forwarder>,
    /// CCB v1 reads; `None` unless `CCB_API_END_POINT`, `CCB_USERNAME` and `CCB_PASSWORD` are
    /// all set. The giving fields read through it, and are forwarded to TS while it is `None`.
    pub ccb: Option<CcbClient>,
}

/// The parts of the state that tests replace.
pub struct Dependencies {
    pub kv: Arc<dyn KeyValueStore>,
    pub google: Option<GoogleAuth>,
    /// `None`: [`CmsContent`] on the configured Strapi 5 and Redis. Tests pass a fake to serve
    /// records without Strapi.
    pub cms: Option<Arc<dyn CmsSource>>,
    /// `None`: the `core_settings` table in the configured Postgres.
    pub core_settings: Option<Arc<dyn CoreSettingsSource>>,
    /// `None`: Statsig when `STATSIG_SERVER_SECRET_KEY` is set, otherwise every gate off.
    pub gates: Option<Arc<dyn FeatureGates>>,
    /// `None`: Firestore's REST API for the Firebase project, with `google`'s token. Both
    /// `verseOfTheDayV2` and `liveStreamStatus` read through it.
    pub documents: Option<Arc<dyn DocumentSource>>,
    /// `None`: the kill switch is read from `gates`.
    pub kill_switch: Option<Arc<dyn FeatureGates>>,
    /// `None`: the giving tables in the configured Postgres.
    pub giving_store: Option<Arc<dyn GivingStore>>,
    /// `None`: Firestore's REST API for both Firebase projects, with `google`'s token.
    pub woa_store: Option<Arc<dyn WoaStore>>,
}

impl AppState {
    /// Builds the state without any network I/O; Redis and Postgres connect on first use. Invalid
    /// Google credentials fail here; missing ones leave Google-backed features unavailable.
    pub fn new(config: Config) -> anyhow::Result<Self> {
        let redis = RedisStore::new(&config.redis)?;
        let dependencies = Dependencies {
            kv: Arc::new(redis.clone()),
            google: GoogleAuth::from_config(&config.google_credentials)?,
            cms: None,
            core_settings: None,
            gates: None,
            documents: None,
            kill_switch: None,
            giving_store: None,
            woa_store: None,
        };
        Self::assemble(config, redis, dependencies)
    }

    /// Builds the state around `dependencies` instead of the configured services.
    pub fn with_dependencies(config: Config, dependencies: Dependencies) -> anyhow::Result<Self> {
        let redis = RedisStore::new(&config.redis)?;
        Self::assemble(config, redis, dependencies)
    }

    fn assemble(
        config: Config,
        redis: RedisStore,
        dependencies: Dependencies,
    ) -> anyhow::Result<Self> {
        let Dependencies {
            kv,
            google,
            cms,
            core_settings,
            gates,
            documents,
            kill_switch,
            giving_store,
            woa_store,
        } = dependencies;
        let http = upstream::http_client()?;
        let metrics = Metrics::new();
        let cms = cms.unwrap_or_else(|| {
            Arc::new(CmsContent::new(
                &config.cms,
                http.clone(),
                metrics.clone(),
                redis.clone(),
            ))
        });
        let db = postgres::connect_lazy(&config.database)?;
        let core_settings =
            core_settings.unwrap_or_else(|| Arc::new(PgCoreSettings::new(db.clone())));
        let gates = gates.unwrap_or_else(|| statsig::from_config(&config.statsig));
        let kill_switch = kill_switch.unwrap_or_else(|| gates.clone());
        let firestore = |project_id: &str| {
            Arc::new(FirestoreClient::new(
                http.clone(),
                google.clone(),
                &config.vod.firestore_url,
                project_id,
            ))
        };
        let primary = firestore(&config.firebase.project_id);
        let documents = documents.unwrap_or_else(|| primary.clone());
        let woa_store = woa_store.unwrap_or_else(|| {
            Arc::new(FirestoreWoaStore::new(
                primary.clone(),
                firestore(&config.firebase.secondary_project_id),
            ))
        });
        let streams = Arc::new(StreamProjectionStore::new(documents.clone()));
        let ccb = config
            .ccb
            .as_ref()
            .map(|ccb| CcbClient::new(ccb, http.clone(), metrics.clone(), kv.clone()));
        let giving_store = giving_store.unwrap_or_else(|| Arc::new(PgGivingStore::new(db.clone())));
        let schema = graphql::build_schema(SchemaData {
            cms: cms.clone(),
            clock: Clock::system(),
            core: Arc::new(CoreSettings::new(core_settings, kv.clone())),
            gates: gates.clone(),
            giving: Arc::new(GivingService::new(
                giving_store,
                kv.clone(),
                ccb.clone(),
                Clock::system(),
            )),
            streams,
            vod: Arc::new(VodService::new(
                documents,
                kv.clone(),
                config.vod.timezone,
                Clock::system(),
            )),
            woa: Arc::new(WoaService::new(woa_store, kv.clone(), Clock::system())),
            ccb_forms: Arc::new(CcbFormsLoader::new(
                config.ccb_forms_url.clone(),
                http.clone(),
                metrics.clone(),
                kv.clone(),
            )),
        });
        let complexity = Arc::new(SchemaIndex::from_sdl(&schema.sdl())?);
        Ok(Self {
            ccb,
            cms,
            db,
            gates,
            kill_switch,
            forwarder: Arc::new(Forwarder::new(&config.gateway)?),
            auth: Arc::new(Authenticator::new(
                &config.firebase,
                http.clone(),
                metrics.clone(),
                google.clone(),
            )),
            google,
            http,
            metrics,
            schema,
            complexity,
            documents: Arc::new(DocumentMemo::new()),
            rate_limiter: Arc::new(RateLimiter::new(kv.clone(), config.graphql.rate_limit_rps)),
            response_cache: Arc::new(ResponseCache::new(kv.clone())),
            kv,
            redis,
            config: Arc::new(config),
        })
    }
}
