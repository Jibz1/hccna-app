//! Feature gates (`apps/server/src/effect/StatsigService.ts`, `apps/server/src/statsig/user.ts`).
//!
//! The TS server evaluates gates locally with `@statsig/statsig-node-core` 0.23.2, which is the
//! `statsig-rust` 0.23.2 evaluator behind N-API: rule sets are downloaded at start-up and synced
//! in the background, `checkGate` evaluates in process (no network call per check), and exposures
//! are queued and flushed in batches. This module runs the same crate with the same options, so a
//! gate check costs the same here. Without `STATSIG_SERVER_SECRET_KEY`, or when initialization
//! fails (the TS service then drops its client), every gate is off.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use statsig_rust::output_logger::{LogLevel, OutputLogProvider};
use statsig_rust::{Statsig, StatsigOptions, StatsigUser, StatsigUserBuilder};

use crate::config::StatsigConfig;

/// `customIDs.anonymousID` for a request without a user (`buildStatsigUser`).
pub const ANONYMOUS_ID: &str = "server-anonymous-user";

/// How long shutdown may spend flushing queued exposures.
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(3);

pub type GatesFuture<'a> = Pin<Box<dyn Future<Output = ()> + Send + 'a>>;

/// The request's caller, as `buildStatsigUser` reads it from the GraphQL context.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct GateUser<'a> {
    pub uid: Option<&'a str>,
    pub email: Option<&'a str>,
}

/// Gate checks, behind a trait so tests choose the answers.
pub trait FeatureGates: Send + Sync {
    /// `ctx.statsig.checkGate(gate)`: whether `gate` passes for `user`.
    fn check(&self, gate: &str, user: &GateUser<'_>) -> bool;

    /// Downloads the rule sets; called once before the server accepts requests, as the TS
    /// server initializes Statsig while building its runtime.
    fn initialize(&self) -> GatesFuture<'_> {
        Box::pin(async {})
    }

    /// Flushes queued exposures on shutdown.
    fn shutdown(&self) -> GatesFuture<'_> {
        Box::pin(async {})
    }
}

/// Statsig is not configured: every gate is off (the TS `disabledService`).
pub struct DisabledGates;

impl FeatureGates for DisabledGates {
    fn check(&self, _gate: &str, _user: &GateUser<'_>) -> bool {
        false
    }
}

/// The configured gates: Statsig with a server secret key, otherwise [`DisabledGates`].
pub fn from_config(config: &StatsigConfig) -> Arc<dyn FeatureGates> {
    match &config.server_secret_key {
        Some(key) => Arc::new(StatsigGates::new(key.expose(), config, None)),
        None => {
            tracing::info!(
                environment = %config.environment,
                enabled = false,
                "Statsig disabled"
            );
            Arc::new(DisabledGates)
        }
    }
}

/// Statsig's server SDK with the TS service's options.
pub struct StatsigGates {
    statsig: Statsig,
    environment: String,
    /// Set once initialization succeeded. Until then, and for good after a failure, gates are
    /// off without evaluating, as the TS service has no client in either case.
    ready: AtomicBool,
}

impl StatsigGates {
    /// `options` replaces the SDK options derived from `config` (tests disable the network).
    fn new(key: &str, config: &StatsigConfig, options: Option<StatsigOptions>) -> Self {
        let options = options.unwrap_or_else(|| StatsigOptions {
            environment: Some(config.environment.clone()),
            output_logger_provider: Some(Arc::new(TracingLogger)),
            output_log_level: Some(if config.production {
                LogLevel::Warn
            } else {
                LogLevel::Info
            }),
            service_name: Some("hccna-backend-rs".to_owned()),
            ..StatsigOptions::default()
        });
        Self {
            statsig: Statsig::new(key, Some(Arc::new(options))),
            environment: config.environment.clone(),
            ready: AtomicBool::new(false),
        }
    }

    /// `buildStatsigUser`: the user id (or the shared anonymous id), the environment as a custom
    /// field and as the environment tier, and the email as a private attribute.
    fn user(&self, user: &GateUser<'_>) -> StatsigUser {
        let builder = match user.uid {
            Some(uid) => StatsigUserBuilder::new_with_user_id(uid),
            None => StatsigUserBuilder::new_with_custom_ids([("anonymousID", ANONYMOUS_ID)]),
        };
        builder
            .custom_from_str_map(Some(HashMap::from([(
                "environment".to_owned(),
                self.environment.clone(),
            )])))
            .statsig_environment(Some(HashMap::from([(
                "tier".to_owned(),
                self.environment.clone(),
            )])))
            .private_attributes_from_str_map(
                user.email
                    .map(|email| HashMap::from([("email".to_owned(), email.to_owned())])),
            )
            .build()
    }
}

impl FeatureGates for StatsigGates {
    fn check(&self, gate: &str, user: &GateUser<'_>) -> bool {
        self.ready.load(Ordering::Acquire) && self.statsig.check_gate(&self.user(user), gate)
    }

    fn initialize(&self) -> GatesFuture<'_> {
        Box::pin(async move {
            match self.statsig.initialize().await {
                Ok(()) => {
                    self.ready.store(true, Ordering::Release);
                    tracing::info!(
                        environment = %self.environment,
                        enabled = true,
                        "Statsig initialized"
                    );
                }
                Err(error) => tracing::warn!(
                    environment = %self.environment,
                    enabled = false,
                    error = %error,
                    "Statsig initialization failed"
                ),
            }
        })
    }

    fn shutdown(&self) -> GatesFuture<'_> {
        Box::pin(async move {
            if let Err(error) = self.statsig.shutdown_with_timeout(SHUTDOWN_TIMEOUT).await {
                tracing::warn!(error = %error, "Statsig shutdown failed");
            }
        })
    }
}

/// The SDK's own log lines, as the TS `StatsigOutputLogger` sends them to the app logger.
struct TracingLogger;

impl OutputLogProvider for TracingLogger {
    fn initialize(&self) {
        tracing::info!("Statsig logger initialized");
    }

    fn debug(&self, tag: &str, msg: String) {
        tracing::debug!(tag, "{msg}");
    }

    fn info(&self, tag: &str, msg: String) {
        tracing::info!(tag, "{msg}");
    }

    fn warn(&self, tag: &str, msg: String) {
        tracing::warn!(tag, "{msg}");
    }

    fn error(&self, tag: &str, msg: String) {
        tracing::error!(tag, "{msg}");
    }

    fn shutdown(&self) {
        tracing::info!("Statsig logger shutdown");
    }
}

#[cfg(test)]
pub mod testing {
    use std::collections::HashSet;
    use std::sync::Mutex;

    use super::{FeatureGates, GateUser};

    /// One recorded check: `(gate, uid, email)`.
    pub type Check = (String, Option<String>, Option<String>);

    /// Gates that pass when listed; every check is recorded.
    #[derive(Default)]
    pub struct FixedGates {
        passing: HashSet<String>,
        pub checks: Mutex<Vec<Check>>,
    }

    impl FixedGates {
        pub fn passing(gates: &[&str]) -> Self {
            Self {
                passing: gates.iter().map(|gate| (*gate).to_owned()).collect(),
                checks: Mutex::default(),
            }
        }
    }

    impl FeatureGates for FixedGates {
        fn check(&self, gate: &str, user: &GateUser<'_>) -> bool {
            self.checks.lock().expect("not poisoned").push((
                gate.to_owned(),
                user.uid.map(str::to_owned),
                user.email.map(str::to_owned),
            ));
            self.passing.contains(gate)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Secret;

    fn config(key: Option<&str>) -> StatsigConfig {
        StatsigConfig {
            server_secret_key: key.map(Secret::new),
            environment: "test".to_owned(),
            production: false,
        }
    }

    /// The SDK without any network access, so nothing leaves the test.
    fn offline(key: &str) -> StatsigGates {
        StatsigGates::new(
            key,
            &config(Some(key)),
            Some(StatsigOptions {
                disable_network: Some(true),
                disable_all_logging: Some(true),
                disable_disk_access: Some(true),
                environment: Some("test".to_owned()),
                ..StatsigOptions::default()
            }),
        )
    }

    #[test]
    fn every_gate_is_off_without_a_server_secret_key() {
        let gates = from_config(&config(None));
        assert!(!gates.check(
            "graphql_core_sort_more_links",
            &GateUser {
                uid: Some("ada-example-uid"),
                email: Some("ada@example.com"),
            }
        ));
    }

    #[tokio::test]
    async fn gates_are_off_until_statsig_is_initialized() {
        let gates = offline("secret-example-uninitialized");
        gates.statsig.override_gate("example_gate", true, None);
        assert!(!gates.check("example_gate", &GateUser::default()));
    }

    #[tokio::test]
    async fn evaluates_gates_in_process_once_ready() {
        let gates = offline("secret-example-ready");
        gates.statsig.override_gate("example_gate", true, None);
        gates.ready.store(true, Ordering::Release);
        let user = GateUser {
            uid: Some("ada-example-uid"),
            email: Some("ada@example.com"),
        };
        assert!(gates.check("example_gate", &user));
        assert!(!gates.check("example_other_gate", &user));
        assert!(gates.check("example_gate", &GateUser::default()));
    }

    #[tokio::test]
    async fn a_failed_initialization_leaves_every_gate_off() {
        // The rule sets come from a closed port, so initialization fails.
        let gates = StatsigGates::new(
            "secret-example-unreachable",
            &config(Some("secret-example-unreachable")),
            Some(StatsigOptions {
                specs_url: Some("http://127.0.0.1:1/v2/download_config_specs".to_owned()),
                log_event_url: Some("http://127.0.0.1:1/v1/log_event".to_owned()),
                init_timeout_ms: Some(1_000),
                disable_all_logging: Some(true),
                disable_disk_access: Some(true),
                ..StatsigOptions::default()
            }),
        );
        gates.statsig.override_gate("example_gate", true, None);
        gates.initialize().await;
        assert!(!gates.ready.load(Ordering::Acquire));
        assert!(!gates.check("example_gate", &GateUser::default()));
        gates.shutdown().await;
    }

    #[tokio::test]
    async fn a_failed_initialization_keeps_the_kill_switch_off_until_restart() {
        // Statsig unreachable at boot: the gateway forwards everything for the life of the
        // process, even though the gate itself is on.
        let gates = StatsigGates::new(
            "secret-example-kill-switch",
            &config(Some("secret-example-kill-switch")),
            Some(StatsigOptions {
                specs_url: Some("http://127.0.0.1:1/v2/download_config_specs".to_owned()),
                log_event_url: Some("http://127.0.0.1:1/v1/log_event".to_owned()),
                init_timeout_ms: Some(1_000),
                disable_all_logging: Some(true),
                disable_disk_access: Some(true),
                ..StatsigOptions::default()
            }),
        );
        gates
            .statsig
            .override_gate(crate::gateway::route::SERVE_LOCALLY_GATE, true, None);
        gates.initialize().await;
        assert!(!crate::gateway::route::serve_locally(&gates));
        gates.shutdown().await;
    }

    #[tokio::test]
    async fn an_offline_initialization_succeeds() {
        let gates = offline("secret-example-offline");
        gates.statsig.override_gate("example_gate", true, None);
        gates.initialize().await;
        assert!(gates.check("example_gate", &GateUser::default()));
    }

    #[test]
    fn builds_users_like_build_statsig_user() {
        let gates = offline("secret-example-users");
        let signed_in = gates.user(&GateUser {
            uid: Some("ada-example-uid"),
            email: Some("ada@example.com"),
        });
        // Private attributes are never serialized (they stay out of exposures).
        assert_eq!(
            serde_json::to_value(&*signed_in.data).unwrap(),
            serde_json::json!({
                "userID": "ada-example-uid",
                "statsigEnvironment": { "tier": "test" },
                "custom": { "environment": "test" },
            })
        );
        let private = signed_in.data.private_attributes.as_ref().unwrap();
        assert_eq!(
            serde_json::to_value(private).unwrap(),
            serde_json::json!({ "email": "ada@example.com" })
        );

        let anonymous = gates.user(&GateUser::default());
        assert_eq!(
            serde_json::to_value(&*anonymous.data).unwrap(),
            serde_json::json!({
                "customIDs": { "anonymousID": "server-anonymous-user" },
                "statsigEnvironment": { "tier": "test" },
                "custom": { "environment": "test" },
            })
        );
        assert!(anonymous.data.private_attributes.is_none());
    }
}
