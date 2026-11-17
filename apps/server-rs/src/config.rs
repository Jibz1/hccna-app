//! Environment configuration. Variable names match `apps/server` so Railway variables can be
//! copied between the two services; Rust-only settings are called out where they are read.

use std::fmt;
use std::time::Duration;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ConfigError {
    #[error("missing required environment variable {0}")]
    Missing(&'static str),
    #[error("environment variable {name} has an invalid value {value:?}")]
    Invalid { name: &'static str, value: String },
}

/// A value that must never reach logs. `Debug` prints a placeholder.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(<redacted>)")
    }
}

#[derive(Clone, Debug)]
pub struct Config {
    /// Interface to bind. `::` accepts IPv4 and IPv6, which Railway's private network may use.
    pub host: String,
    pub port: u16,
    pub metrics_port: u16,
    /// Whole-request deadline, matching the TS server's `APP_TIMEOUT_MS`.
    pub request_timeout: Duration,
    pub database: DatabaseConfig,
    pub redis: RedisConfig,
    pub graphql: GraphqlConfig,
    pub firebase: FirebaseConfig,
    pub google_credentials: GoogleCredentials,
    /// Rust-only test override (`CCB_FORMS_URL`) for the public CCB forms list.
    pub ccb_forms_url: String,
    pub cms: CmsConfig,
    /// `None` unless `CCB_API_END_POINT`, `CCB_USERNAME` and `CCB_PASSWORD` are all set.
    pub ccb: Option<CcbConfig>,
    pub statsig: StatsigConfig,
    pub vod: VodConfig,
    pub sentry: SentryConfig,
    pub gateway: GatewayConfig,
}

/// Where the gateway forwards what Rust does not answer.
#[derive(Clone, Debug)]
pub struct GatewayConfig {
    /// `TS_ORIGIN_URL` (required, with no default) with the path `/graphql`. The variable
    /// must be a bare `http` or `https` origin; nothing in a request changes this URL.
    pub ts_graphql_url: url::Url,
}

/// Sentry, with the TS server's variable names (`apps/server/src/instrument.ts`). Unlike TS, Rust
/// has no built-in DSN.
#[derive(Clone, Debug)]
pub struct SentryConfig {
    /// `SENTRY_DSN`; without it nothing is reported.
    pub dsn: Option<sentry::types::Dsn>,
    /// `SENTRY_ENABLED=true`, or `NODE_ENV=production`, as TS's `isProduction || sentryEnabled`.
    pub enabled: bool,
    /// `NODE_ENV` (default `development`), TS's `environment: appConfig.nodeEnv`.
    pub environment: String,
    /// `SENTRY_SAMPLE_RATE` (default 0.8, TS's default): the share of events sent, 0 to 1.
    pub sample_rate: f32,
    /// `SENTRY_RELEASE`: the deployed commit SHA, which the deploy workflow sets.
    pub release: Option<String>,
}

impl SentryConfig {
    /// Whether events are sent: enabled and given a DSN.
    pub fn active(&self) -> bool {
        self.enabled && self.dsn.is_some()
    }
}

/// The verse of the day (`apps/server/src/effect/services/vod/constants.ts`).
#[derive(Clone, Debug)]
pub struct VodConfig {
    /// `VOD_TIMEZONE` (default `America/New_York`): the zone whose date is "today".
    pub timezone: chrono_tz::Tz,
    /// Rust-only test override (`FIRESTORE_URL`) for the Firestore REST host.
    pub firestore_url: String,
}

/// Statsig (`apps/server/src/effect/AppConfig.ts`): enabled only with a server secret key.
#[derive(Clone, Debug)]
pub struct StatsigConfig {
    /// `STATSIG_SERVER_SECRET_KEY`; `None` disables Statsig (every gate is off).
    pub server_secret_key: Option<Secret>,
    /// `STATSIG_ENVIRONMENT`, else `NODE_ENV` (default `development`): the SDK's environment
    /// tier and the users' `environment` field.
    pub environment: String,
    /// `NODE_ENV=production`: the SDK logs warnings and errors only.
    pub production: bool,
}

#[derive(Clone, Debug)]
pub struct FirebaseConfig {
    /// Rust-only (`FIREBASE_PROJECT_ID`); the TS server hard-codes `app-hccnj`.
    pub project_id: String,
    /// Rust-only (`FIREBASE_SECONDARY_PROJECT_ID`); the TS server hard-codes `app-hccnj-17d4f`,
    /// which holds the Word of Activation subscriptions.
    pub secondary_project_id: String,
    /// Rust-only test override (`GOOGLE_JWKS_URL`) for Google's securetoken signing keys.
    pub jwks_url: String,
    /// Rust-only test override (`IDENTITY_TOOLKIT_URL`) for the account lookup host.
    pub identity_toolkit_url: String,
}

/// Where the Google service account comes from. `GOOGLE_APPLICATION_CREDENTIALS` (a path) wins
/// over `GOOGLE_APPLICATION_CREDENTIALS_JSON`, as in `apps/server/src/platform/googleCredentials.ts`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GoogleCredentials {
    None,
    Json(Secret),
    File(String),
}

#[derive(Clone, Debug)]
pub struct GraphqlConfig {
    /// Requests per client per second (`GRAPHQL_RATE_LIMIT_RPS`, default 20).
    pub rate_limit_rps: u32,
}

#[derive(Clone, Debug)]
pub struct DatabaseConfig {
    pub url: Secret,
    pub pool_max: u32,
    pub connection_timeout: Duration,
    /// `DB_STATEMENT_TIMEOUT_MS` (default 10 s), sent as Postgres' `statement_timeout` the way
    /// node-postgres sends its `statement_timeout` option; `0` disables it.
    pub statement_timeout: Duration,
}

#[derive(Clone, Debug)]
pub struct RedisConfig {
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<Secret>,
    /// Rust-only. Every key this server writes starts with it so its entries never collide with
    /// the TS server's, whose encodings differ.
    pub key_prefix: String,
}

/// Strapi 5, read through `CmsContent`. Both are required at boot, as `CmsContentV5Live`
/// requires them in `apps/server/src/effect/services/cms/content/v5Layer.ts`.
#[derive(Clone, Debug)]
pub struct CmsConfig {
    /// `CMS_V5_ENDPOINT`: the full GraphQL URL, e.g. `https://cms.example.com/graphql`.
    pub endpoint: String,
    /// `CMS_V5_TOKEN`: the API token sent as `Authorization: Bearer <token>`.
    pub token: Secret,
}

/// CCB v1 (`ccbConfig` in `apps/server/src/effect/services/CCBService.ts`). TS requires all
/// three variables at boot; here they are optional, and the CCB client exists only when all three
/// are set.
#[derive(Clone, Debug)]
pub struct CcbConfig {
    /// `CCB_API_END_POINT`: the API URL, e.g. `https://example.ccbchurch.com/api.php`.
    pub api_endpoint: String,
    /// `CCB_USERNAME`: the API user, sent with HTTP Basic auth.
    pub username: String,
    /// `CCB_PASSWORD`
    pub password: Secret,
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    /// Reads configuration through `lookup`, so tests can supply variables without touching the
    /// process environment.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let env = Env(&lookup);
        let node_env = env.string("NODE_ENV").map_or_else(
            || "development".to_owned(),
            |value| value.trim().to_lowercase(),
        );
        Ok(Self {
            host: env.string("HOST").unwrap_or_else(|| "::".to_owned()),
            port: env.parse("PORT", 8080)?,
            metrics_port: env.parse("METRICS_SERVER_PORT", 9184)?,
            request_timeout: Duration::from_millis(env.parse("APP_TIMEOUT_MS", 20_000)?),
            database: DatabaseConfig {
                url: Secret::new(env.required("DATABASE_URL")?),
                // The live TS server's pool is 50; the bench servers share its Postgres.
                pool_max: env.parse("DB_POOL_MAX", 10)?,
                connection_timeout: Duration::from_millis(
                    env.parse("DB_CONNECTION_TIMEOUT_MS", 5_000)?,
                ),
                statement_timeout: Duration::from_millis(
                    env.parse("DB_STATEMENT_TIMEOUT_MS", 10_000)?,
                ),
            },
            redis: RedisConfig {
                host: env.required("REDIS_HOST")?,
                port: env.parse("REDIS_PORT", 6379)?,
                username: env.string("REDIS_USERNAME"),
                password: env.string("REDIS_PASSWORD").map(Secret::new),
                key_prefix: env
                    .string("REDIS_KEY_PREFIX")
                    .unwrap_or_else(|| "rs:".to_owned()),
            },
            graphql: GraphqlConfig {
                rate_limit_rps: env.positive("GRAPHQL_RATE_LIMIT_RPS", 20)?,
            },
            firebase: FirebaseConfig {
                project_id: env
                    .string("FIREBASE_PROJECT_ID")
                    .unwrap_or_else(|| "app-hccnj".to_owned()),
                secondary_project_id: env
                    .string("FIREBASE_SECONDARY_PROJECT_ID")
                    .unwrap_or_else(|| "app-hccnj-17d4f".to_owned()),
                jwks_url: env.string("GOOGLE_JWKS_URL").unwrap_or_else(|| {
                    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
                        .to_owned()
                }),
                identity_toolkit_url: env
                    .string("IDENTITY_TOOLKIT_URL")
                    .unwrap_or_else(|| "https://identitytoolkit.googleapis.com".to_owned()),
            },
            ccb_forms_url: env
                .string("CCB_FORMS_URL")
                .unwrap_or_else(|| crate::fields::ccb_forms::DEFAULT_CCB_FORMS_URL.to_owned()),
            google_credentials: match (
                env.string("GOOGLE_APPLICATION_CREDENTIALS"),
                env.string("GOOGLE_APPLICATION_CREDENTIALS_JSON"),
            ) {
                (Some(path), _) => GoogleCredentials::File(path),
                (None, Some(json)) => GoogleCredentials::Json(Secret::new(json)),
                (None, None) => GoogleCredentials::None,
            },
            cms: CmsConfig {
                endpoint: env.required("CMS_V5_ENDPOINT")?,
                token: Secret::new(env.required("CMS_V5_TOKEN")?),
            },
            ccb: match (
                env.string("CCB_API_END_POINT"),
                env.string("CCB_USERNAME"),
                env.string("CCB_PASSWORD"),
            ) {
                (Some(api_endpoint), Some(username), Some(password)) => Some(CcbConfig {
                    api_endpoint,
                    username,
                    password: Secret::new(password),
                }),
                _ => None,
            },
            vod: VodConfig {
                timezone: match env.string("VOD_TIMEZONE") {
                    None => chrono_tz::America::New_York,
                    Some(value) => value.trim().parse().map_err(|_| ConfigError::Invalid {
                        name: "VOD_TIMEZONE",
                        value,
                    })?,
                },
                firestore_url: env
                    .string("FIRESTORE_URL")
                    .unwrap_or_else(|| "https://firestore.googleapis.com".to_owned()),
            },
            statsig: StatsigConfig {
                server_secret_key: env
                    .string("STATSIG_SERVER_SECRET_KEY")
                    .map(|key| Secret::new(key.trim())),
                environment: env
                    .string("STATSIG_ENVIRONMENT")
                    .map_or_else(|| node_env.clone(), |value| value.trim().to_owned()),
                production: node_env == "production",
            },
            sentry: SentryConfig {
                dsn: match env.string("SENTRY_DSN") {
                    None => None,
                    Some(value) => Some(value.trim().parse().map_err(|_| ConfigError::Invalid {
                        name: "SENTRY_DSN",
                        value,
                    })?),
                },
                enabled: env.boolean("SENTRY_ENABLED", false)? || node_env == "production",
                environment: node_env.clone(),
                sample_rate: env.fraction("SENTRY_SAMPLE_RATE", 0.8)?,
                release: env
                    .string("SENTRY_RELEASE")
                    .map(|value| value.trim().to_owned()),
            },
            gateway: GatewayConfig {
                ts_graphql_url: ts_graphql_url(&env)?,
            },
        })
    }
}

/// `TS_ORIGIN_URL` with the path `/graphql`. Only a bare `http(s)://host[:port]` is accepted, so a
/// path, query or credentials in the variable cannot change where requests go.
fn ts_graphql_url(env: &Env<'_>) -> Result<url::Url, ConfigError> {
    // Required: a built-in default would send every forwarded request, mutations included, to
    // whatever server it named.
    let value = env
        .string("TS_ORIGIN_URL")
        .ok_or(ConfigError::Missing("TS_ORIGIN_URL"))?;
    let invalid = || ConfigError::Invalid {
        name: "TS_ORIGIN_URL",
        value: value.clone(),
    };
    let mut url = url::Url::parse(value.trim()).map_err(|_| invalid())?;
    let bare_origin = matches!(url.scheme(), "http" | "https")
        && url.host().is_some()
        && url.path() == "/"
        && url.query().is_none()
        && url.fragment().is_none()
        && url.username().is_empty()
        && url.password().is_none();
    if !bare_origin {
        return Err(invalid());
    }
    url.set_path("/graphql");
    Ok(url)
}

struct Env<'a>(&'a dyn Fn(&str) -> Option<String>);

impl Env<'_> {
    /// A positive integer, as the TS config's `parsePositiveInteger` accepts (`^[1-9]\d*$`).
    fn positive(&self, name: &'static str, default: u32) -> Result<u32, ConfigError> {
        match self.string(name) {
            None => Ok(default),
            Some(value) => {
                let trimmed = value.trim();
                let valid = trimmed.starts_with(|c: char| ('1'..='9').contains(&c))
                    && trimmed.chars().all(|c| c.is_ascii_digit());
                valid
                    .then(|| trimmed.parse().ok())
                    .flatten()
                    .ok_or(ConfigError::Invalid { name, value })
            }
        }
    }
}

impl Env<'_> {
    /// `true` or `false` in any case, as the TS config's `parseBoolean` accepts.
    fn boolean(&self, name: &'static str, default: bool) -> Result<bool, ConfigError> {
        match self.string(name) {
            None => Ok(default),
            Some(value) => match value.trim().to_ascii_lowercase().as_str() {
                "true" => Ok(true),
                "false" => Ok(false),
                _ => Err(ConfigError::Invalid { name, value }),
            },
        }
    }

    /// A number from 0 to 1.
    fn fraction(&self, name: &'static str, default: f32) -> Result<f32, ConfigError> {
        match self.string(name) {
            None => Ok(default),
            Some(value) => value
                .trim()
                .parse::<f32>()
                .ok()
                .filter(|fraction| (0.0..=1.0).contains(fraction))
                .ok_or(ConfigError::Invalid { name, value }),
        }
    }

    /// A set, non-blank value. Blank values count as unset, as they do in the TS config.
    fn string(&self, name: &str) -> Option<String> {
        (self.0)(name).filter(|value| !value.trim().is_empty())
    }

    fn required(&self, name: &'static str) -> Result<String, ConfigError> {
        self.string(name).ok_or(ConfigError::Missing(name))
    }

    fn parse<T: std::str::FromStr>(
        &self,
        name: &'static str,
        default: T,
    ) -> Result<T, ConfigError> {
        match self.string(name) {
            None => Ok(default),
            Some(value) => value
                .trim()
                .parse()
                .map_err(|_| ConfigError::Invalid { name, value }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn lookup(vars: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<String, String> = vars
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect();
        move |name| map.get(name).cloned()
    }

    const REQUIRED: [(&str, &str); 5] = [
        ("DATABASE_URL", "postgres://ada:pw@localhost:5432/example"),
        ("REDIS_HOST", "localhost"),
        ("CMS_V5_ENDPOINT", "https://cms.example.com/graphql"),
        ("CMS_V5_TOKEN", "example-cms-token"),
        ("TS_ORIGIN_URL", "http://127.0.0.1:8081"),
    ];

    #[test]
    fn applies_defaults() {
        let config = Config::from_lookup(lookup(&REQUIRED)).unwrap();
        assert_eq!(config.host, "::");
        assert_eq!(config.port, 8080);
        assert_eq!(config.metrics_port, 9184);
        assert_eq!(config.request_timeout, Duration::from_secs(20));
        assert_eq!(config.database.pool_max, 10);
        assert_eq!(config.redis.port, 6379);
        assert_eq!(config.redis.key_prefix, "rs:");
        assert_eq!(config.redis.username, None);
        assert_eq!(config.graphql.rate_limit_rps, 20);
        assert_eq!(config.firebase.project_id, "app-hccnj");
        assert_eq!(config.firebase.secondary_project_id, "app-hccnj-17d4f");
        assert_eq!(
            config.firebase.jwks_url,
            "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
        );
        assert_eq!(
            config.firebase.identity_toolkit_url,
            "https://identitytoolkit.googleapis.com"
        );
        assert_eq!(config.google_credentials, GoogleCredentials::None);
        assert_eq!(config.database.statement_timeout, Duration::from_secs(10));
        assert_eq!(config.vod.timezone, chrono_tz::America::New_York);
        assert_eq!(config.vod.firestore_url, "https://firestore.googleapis.com");
        assert!(config.statsig.server_secret_key.is_none());
        assert_eq!(config.statsig.environment, "development");
        assert!(!config.statsig.production);
        assert!(config.sentry.dsn.is_none());
        assert!(!config.sentry.enabled);
        assert!(!config.sentry.active());
        assert_eq!(config.sentry.environment, "development");
        assert!((config.sentry.sample_rate - 0.8).abs() < f32::EPSILON);
        assert_eq!(config.sentry.release, None);
        assert_eq!(
            config.gateway.ts_graphql_url.as_str(),
            "http://127.0.0.1:8081/graphql"
        );
        assert_eq!(
            config.ccb_forms_url,
            "https://hccnj.ccbchurch.com/api/forms?publicly_listed=true&status=ACTIVE&name=&sort_by=DATE_CREATED&sort_direction=DESC&page=1"
        );
    }

    #[test]
    fn prefers_the_credentials_path_over_inline_json() {
        let mut vars = REQUIRED.to_vec();
        vars.push((
            "GOOGLE_APPLICATION_CREDENTIALS_JSON",
            r#"{"type":"service_account"}"#,
        ));
        assert_eq!(
            Config::from_lookup(lookup(&vars))
                .unwrap()
                .google_credentials,
            GoogleCredentials::Json(Secret::new(r#"{"type":"service_account"}"#))
        );
        vars.push(("GOOGLE_APPLICATION_CREDENTIALS", "/run/secrets/google.json"));
        assert_eq!(
            Config::from_lookup(lookup(&vars))
                .unwrap()
                .google_credentials,
            GoogleCredentials::File("/run/secrets/google.json".to_owned())
        );
    }

    #[test]
    fn reads_the_rate_limit_as_a_positive_integer() {
        let with = |value: &str| {
            let mut vars = REQUIRED.to_vec();
            vars.push(("GRAPHQL_RATE_LIMIT_RPS", value));
            Config::from_lookup(lookup(&vars)).map(|config| config.graphql.rate_limit_rps)
        };
        assert_eq!(with(" 500 ").unwrap(), 500);
        for invalid in ["0", "-1", "1.5", "012", "many"] {
            assert_eq!(
                with(invalid).unwrap_err(),
                ConfigError::Invalid {
                    name: "GRAPHQL_RATE_LIMIT_RPS",
                    value: invalid.to_owned()
                }
            );
        }
    }

    #[test]
    fn reads_overrides() {
        let mut vars = REQUIRED.to_vec();
        vars.extend([
            ("PORT", "9000"),
            ("REDIS_PORT", "6380"),
            ("REDIS_USERNAME", "default"),
            ("REDIS_PASSWORD", "example-password"),
            ("REDIS_KEY_PREFIX", "bench:"),
            ("DB_POOL_MAX", "4"),
            ("DB_STATEMENT_TIMEOUT_MS", "0"),
        ]);
        let config = Config::from_lookup(lookup(&vars)).unwrap();
        assert_eq!(config.port, 9000);
        assert_eq!(config.redis.port, 6380);
        assert_eq!(config.redis.username.as_deref(), Some("default"));
        assert_eq!(
            config.redis.password.as_ref().map(Secret::expose),
            Some("example-password")
        );
        assert_eq!(config.redis.key_prefix, "bench:");
        assert_eq!(config.database.pool_max, 4);
        assert_eq!(config.database.statement_timeout, Duration::ZERO);
    }

    #[test]
    fn reports_missing_and_invalid_values() {
        assert_eq!(
            Config::from_lookup(lookup(&[("REDIS_HOST", "localhost")])).unwrap_err(),
            ConfigError::Missing("DATABASE_URL")
        );
        let mut vars = REQUIRED.to_vec();
        vars.push(("PORT", "eighty"));
        assert_eq!(
            Config::from_lookup(lookup(&vars)).unwrap_err(),
            ConfigError::Invalid {
                name: "PORT",
                value: "eighty".to_owned()
            }
        );
    }

    #[test]
    fn requires_the_strapi_5_endpoint_and_token() {
        let config = Config::from_lookup(lookup(&REQUIRED)).unwrap();
        assert_eq!(config.cms.endpoint, "https://cms.example.com/graphql");
        assert_eq!(config.cms.token.expose(), "example-cms-token");

        for missing in ["CMS_V5_ENDPOINT", "CMS_V5_TOKEN"] {
            let vars: Vec<_> = REQUIRED
                .iter()
                .copied()
                .filter(|(name, _)| *name != missing)
                .collect();
            assert_eq!(
                Config::from_lookup(lookup(&vars)).unwrap_err(),
                ConfigError::Missing(missing)
            );
        }
    }

    #[test]
    fn reads_the_ccb_settings_only_when_all_three_are_set() {
        const CCB: [(&str, &str); 3] = [
            ("CCB_API_END_POINT", "https://example.ccbchurch.com/api.php"),
            ("CCB_USERNAME", "example-user"),
            ("CCB_PASSWORD", "example-password"),
        ];
        let mut vars = REQUIRED.to_vec();
        vars.extend(CCB);
        let config = Config::from_lookup(lookup(&vars)).unwrap();
        let ccb = config.ccb.as_ref().unwrap();
        assert_eq!(ccb.api_endpoint, "https://example.ccbchurch.com/api.php");
        assert_eq!(ccb.username, "example-user");
        assert_eq!(ccb.password.expose(), "example-password");
        assert!(!format!("{config:?}").contains("example-password"));

        assert!(
            Config::from_lookup(lookup(&REQUIRED))
                .unwrap()
                .ccb
                .is_none()
        );
        for (missing, _) in CCB {
            let mut vars = REQUIRED.to_vec();
            vars.extend(CCB.iter().copied().filter(|(name, _)| *name != missing));
            assert!(
                Config::from_lookup(lookup(&vars)).unwrap().ccb.is_none(),
                "{missing}"
            );
            vars.push((missing, "  "));
            assert!(
                Config::from_lookup(lookup(&vars)).unwrap().ccb.is_none(),
                "{missing} blank"
            );
        }
    }

    #[test]
    fn reads_statsig_like_the_ts_config() {
        let mut vars = REQUIRED.to_vec();
        vars.extend([
            ("STATSIG_SERVER_SECRET_KEY", " secret-example "),
            ("NODE_ENV", "production"),
        ]);
        let config = Config::from_lookup(lookup(&vars)).unwrap();
        assert_eq!(
            config
                .statsig
                .server_secret_key
                .as_ref()
                .map(Secret::expose),
            Some("secret-example")
        );
        assert_eq!(config.statsig.environment, "production");
        assert!(config.statsig.production);

        vars.push(("STATSIG_ENVIRONMENT", "staging"));
        let config = Config::from_lookup(lookup(&vars)).unwrap();
        assert_eq!(config.statsig.environment, "staging");
        assert!(config.statsig.production);
        assert!(!format!("{config:?}").contains("secret-example"));
    }

    #[test]
    fn reads_the_vod_time_zone() {
        let with = |value: &str| {
            let mut vars = REQUIRED.to_vec();
            vars.push(("VOD_TIMEZONE", value));
            Config::from_lookup(lookup(&vars)).map(|config| config.vod.timezone)
        };
        assert_eq!(with("Europe/London").unwrap(), chrono_tz::Europe::London);
        assert_eq!(
            with("Mars/Olympus").unwrap_err(),
            ConfigError::Invalid {
                name: "VOD_TIMEZONE",
                value: "Mars/Olympus".to_owned()
            }
        );
    }

    #[test]
    fn requires_the_ts_origin() {
        let vars: Vec<_> = REQUIRED
            .into_iter()
            .filter(|(name, _)| *name != "TS_ORIGIN_URL")
            .collect();
        assert_eq!(
            Config::from_lookup(lookup(&vars)).unwrap_err(),
            ConfigError::Missing("TS_ORIGIN_URL")
        );
    }

    #[test]
    fn reads_the_ts_origin_as_a_bare_origin() {
        let with = |value: &str| {
            let mut vars = REQUIRED.to_vec();
            vars.push(("TS_ORIGIN_URL", value));
            Config::from_lookup(lookup(&vars)).map(|config| config.gateway.ts_graphql_url)
        };
        assert_eq!(
            with("http://127.0.0.1:4000").unwrap().as_str(),
            "http://127.0.0.1:4000/graphql"
        );
        assert_eq!(
            with(" https://ts.example.com/ ").unwrap().as_str(),
            "https://ts.example.com/graphql"
        );
        for invalid in [
            "ts.example.com",
            "ftp://ts.example.com",
            "https://ts.example.com/graphql",
            "https://ts.example.com/?target=elsewhere",
            "https://ts.example.com/#graphql",
            "https://ada:pw@ts.example.com",
        ] {
            assert_eq!(
                with(invalid).unwrap_err(),
                ConfigError::Invalid {
                    name: "TS_ORIGIN_URL",
                    value: invalid.to_owned()
                }
            );
        }
    }

    #[test]
    fn reads_sentry_like_the_ts_config() {
        let with = |extra: &[(&'static str, &'static str)]| {
            let mut vars = REQUIRED.to_vec();
            vars.extend_from_slice(extra);
            Config::from_lookup(lookup(&vars)).map(|config| config.sentry)
        };
        let dsn = ("SENTRY_DSN", "https://public@example.com/1");

        let sentry = with(&[dsn, ("SENTRY_ENABLED", " TRUE ")]).unwrap();
        assert!(sentry.active());
        let parsed = sentry.dsn.expect("the DSN was read");
        assert_eq!(
            (parsed.public_key(), parsed.host()),
            ("public", "example.com")
        );
        // As in TS, production enables reporting without SENTRY_ENABLED.
        let sentry = with(&[dsn, ("NODE_ENV", "production")]).unwrap();
        assert!(sentry.active());
        assert_eq!(sentry.environment, "production");
        assert!(!with(&[dsn, ("SENTRY_ENABLED", "false")]).unwrap().active());
        assert!(!with(&[("SENTRY_ENABLED", "true")]).unwrap().active());

        let sentry = with(&[
            ("SENTRY_SAMPLE_RATE", "0.25"),
            ("SENTRY_RELEASE", "0123456789abcdef0123456789abcdef01234567"),
        ])
        .unwrap();
        assert!((sentry.sample_rate - 0.25).abs() < f32::EPSILON);
        assert_eq!(
            sentry.release.as_deref(),
            Some("0123456789abcdef0123456789abcdef01234567")
        );

        for (name, value) in [
            ("SENTRY_ENABLED", "yes"),
            ("SENTRY_SAMPLE_RATE", "1.5"),
            ("SENTRY_SAMPLE_RATE", "often"),
            ("SENTRY_DSN", "not a dsn"),
        ] {
            assert_eq!(
                with(&[(name, value)]).unwrap_err(),
                ConfigError::Invalid {
                    name,
                    value: value.to_owned()
                }
            );
        }
    }

    #[test]
    fn treats_blank_values_as_unset() {
        let mut vars = REQUIRED.to_vec();
        vars.push(("PORT", "  "));
        assert_eq!(Config::from_lookup(lookup(&vars)).unwrap().port, 8080);
    }

    #[test]
    fn debug_output_hides_secrets() {
        let mut vars = REQUIRED.to_vec();
        vars.push(("REDIS_PASSWORD", "example-password"));
        vars.push((
            "GOOGLE_APPLICATION_CREDENTIALS_JSON",
            r#"{"type":"service_account","private_key":"example-private-key"}"#,
        ));
        let rendered = format!("{:?}", Config::from_lookup(lookup(&vars)).unwrap());
        assert!(!rendered.contains("example-password"));
        assert!(!rendered.contains("ada:pw"));
        assert!(!rendered.contains("example-private-key"));
        assert!(!rendered.contains("example-cms-token"));
    }
}
