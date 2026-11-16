//! Error reporting to Sentry, configured like `apps/server/src/instrument.ts`. Three things are
//! reported: panics (the SDK's panic hook), 5xx responses Rust produced for `/graphql`, and
//! forwards to the TS server that got no answer. Events never carry request headers, cookies or
//! bodies: nothing here attaches them, and [`scrub`] removes any an integration adds, so
//! `authorization` values and push tokens never reach Sentry.

use std::borrow::Cow;
use std::sync::Arc;

use sentry::protocol::{Event, Value};
use sentry::{ClientInitGuard, ClientOptions, Level};

use crate::config::SentryConfig;

/// The `server_name` on every event.
pub const SERVER_NAME: &str = "hccna-backend-rs";

/// The message of an upstream-failure event; the cause goes in `extra`, so events group.
pub const UPSTREAM_FAILURE_MESSAGE: &str = "Forward to the TS server failed";

/// The message of a server-error event.
pub const SERVER_ERROR_MESSAGE: &str = "Rust answered /graphql with a 5xx status";

/// Starts Sentry when `config` is active. `main` keeps the guard until shutdown; dropping it
/// flushes queued events. Without it, the `report_*` functions do nothing.
///
/// `sentry::init` also reads `SENTRY_DSN` from the environment when no DSN is given, so it is
/// never called while reporting is off.
pub fn init(config: &SentryConfig) -> Option<ClientInitGuard> {
    if config.enabled && config.dsn.is_none() {
        tracing::warn!("Sentry enabled without SENTRY_DSN; nothing is reported");
    }
    let options = client_options(config)?;
    let guard = sentry::init(options);
    tracing::info!(
        environment = %config.environment,
        release = config.release.as_deref().unwrap_or("unset"),
        "Sentry enabled"
    );
    Some(guard)
}

/// The client options for `config`, or `None` when reporting is off.
pub fn client_options(config: &SentryConfig) -> Option<ClientOptions> {
    if !config.active() {
        return None;
    }
    Some(ClientOptions {
        dsn: config.dsn.clone(),
        release: config.release.clone().map(Cow::Owned),
        environment: Some(Cow::Owned(config.environment.clone())),
        server_name: Some(Cow::Borrowed(SERVER_NAME)),
        sample_rate: config.sample_rate,
        send_default_pii: false,
        before_send: Some(Arc::new(|event| Some(scrub(event)))),
        ..ClientOptions::default()
    })
}

/// Removes the request and the user from an event before it leaves the process.
pub fn scrub(mut event: Event<'static>) -> Event<'static> {
    event.request = None;
    event.user = None;
    event
}

/// A forward to the TS server that ended without a response: `timed_out` when the deadline
/// expired, otherwise the connection failed. `cause` is the error's text, `request_id` the
/// request's `x-request-id`.
pub fn report_upstream_failure(timed_out: bool, cause: &str, request_id: Option<&str>) {
    sentry::with_scope(
        |scope| {
            scope.set_tag("route", "forward");
            scope.set_tag(
                "upstream_failure",
                if timed_out { "timeout" } else { "unreachable" },
            );
            if let Some(request_id) = request_id {
                scope.set_tag("request_id", request_id);
            }
            scope.set_extra("cause", Value::from(cause));
        },
        || sentry::capture_message(UPSTREAM_FAILURE_MESSAGE, Level::Error),
    );
}

/// A 5xx response Rust produced for `/graphql` (TS's own 5xx responses are TS's to report).
/// `operation_name` is the bounded metric label, never the raw name.
pub fn report_server_error(status: u16, operation_name: &str, request_id: Option<&str>) {
    sentry::with_scope(
        |scope| {
            scope.set_tag("route", "local");
            scope.set_tag("status", status);
            scope.set_tag("operation_name", operation_name);
            if let Some(request_id) = request_id {
                scope.set_tag("request_id", request_id);
            }
        },
        || sentry::capture_message(SERVER_ERROR_MESSAGE, Level::Error),
    );
}

#[cfg(test)]
mod tests {
    use sentry::protocol::{Request, User};

    use super::*;

    fn config(enabled: bool, dsn: Option<&str>) -> SentryConfig {
        SentryConfig {
            dsn: dsn.map(|dsn| dsn.parse().expect("a valid DSN")),
            enabled,
            environment: "production".to_owned(),
            sample_rate: 1.0,
            release: Some("0123456789abcdef0123456789abcdef01234567".to_owned()),
        }
    }

    const DSN: &str = "https://public@example.com/1";

    #[test]
    fn stays_off_without_both_a_dsn_and_enabling() {
        assert!(client_options(&config(false, Some(DSN))).is_none());
        assert!(client_options(&config(true, None)).is_none());
        assert!(init(&config(true, None)).is_none());
    }

    #[derive(Clone, Default)]
    struct Capture(std::sync::Arc<std::sync::Mutex<Vec<u8>>>);

    impl std::io::Write for Capture {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0
                .lock()
                .expect("the capture lock is not poisoned")
                .extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for Capture {
        type Writer = Capture;

        fn make_writer(&'a self) -> Self::Writer {
            self.clone()
        }
    }

    /// What `init` logs for `config`.
    fn init_log(config: &SentryConfig) -> String {
        let capture = Capture::default();
        let subscriber = tracing_subscriber::fmt()
            .with_writer(capture.clone())
            .finish();
        tracing::subscriber::with_default(subscriber, || {
            assert!(init(config).is_none());
        });
        let bytes = capture.0.lock().expect("the capture lock is not poisoned");
        String::from_utf8(bytes.clone()).expect("log output is UTF-8")
    }

    #[test]
    fn warns_when_enabled_without_a_dsn() {
        let log = init_log(&config(true, None));
        assert_eq!(
            log.matches("Sentry enabled without SENTRY_DSN; nothing is reported")
                .count(),
            1
        );
        assert!(init_log(&config(false, None)).is_empty());
    }

    #[test]
    fn tags_events_with_server_environment_and_release() {
        let options = client_options(&config(true, Some(DSN))).expect("reporting is on");
        assert_eq!(options.server_name.as_deref(), Some("hccna-backend-rs"));
        assert_eq!(options.environment.as_deref(), Some("production"));
        assert_eq!(
            options.release.as_deref(),
            Some("0123456789abcdef0123456789abcdef01234567")
        );
        assert!(!options.send_default_pii);
        assert!((options.sample_rate - 1.0).abs() < f32::EPSILON);
    }

    #[test]
    fn strips_requests_and_users_before_sending() {
        let options = client_options(&config(true, Some(DSN))).expect("reporting is on");
        let events = sentry::test::with_captured_events_options(
            || {
                sentry::capture_event(Event {
                    message: Some("example".to_owned()),
                    request: Some(Request {
                        data: Some(r#"{"query":"mutation M { registerPushToken }"}"#.to_owned()),
                        headers: [(
                            "authorization".to_owned(),
                            "Bearer example-token".to_owned(),
                        )]
                        .into_iter()
                        .collect(),
                        ..Request::default()
                    }),
                    user: Some(User {
                        email: Some("ada@example.com".to_owned()),
                        ..User::default()
                    }),
                    ..Event::default()
                });
            },
            options,
        );
        assert_eq!(events.len(), 1);
        assert!(events[0].request.is_none());
        assert!(events[0].user.is_none());
        let rendered = format!("{:?}", events[0]);
        assert!(!rendered.contains("example-token"));
        assert!(!rendered.contains("ada@example.com"));
    }

    #[test]
    fn reports_upstream_failures_and_server_errors_with_their_tags() {
        let events = sentry::test::with_captured_events(|| {
            report_upstream_failure(true, "deadline", Some("example-request"));
            report_server_error(503, "CCBFormsV2Query", None);
        });
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].message.as_deref(), Some(UPSTREAM_FAILURE_MESSAGE));
        assert_eq!(events[0].level, Level::Error);
        assert_eq!(events[0].tags["upstream_failure"], "timeout");
        assert_eq!(events[0].tags["request_id"], "example-request");
        assert_eq!(events[0].extra["cause"], "deadline");
        assert_eq!(events[1].message.as_deref(), Some(SERVER_ERROR_MESSAGE));
        assert_eq!(events[1].tags["status"], "503");
        assert_eq!(events[1].tags["operation_name"], "CCBFormsV2Query");
        assert!(!events[1].tags.contains_key("request_id"));
    }
}
