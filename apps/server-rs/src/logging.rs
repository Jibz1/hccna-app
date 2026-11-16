//! Pino-shaped JSON logs, one object per stdout line, matching `apps/server`'s logger: `level` as a
//! lowercase name (Railway reads it as a name) and no timestamp (the host stamps each line).

use std::fmt;
use std::io::Write;
use std::sync::OnceLock;

use serde_json::{Map, Value};
use tracing::field::{Field, Visit};
use tracing::{Event, Level, Subscriber};
use tracing_subscriber::EnvFilter;
use tracing_subscriber::fmt::format::Writer;
use tracing_subscriber::fmt::{FmtContext, FormatEvent, FormatFields};
use tracing_subscriber::registry::LookupSpan;

static MAX_LEVEL: OnceLock<Level> = OnceLock::new();

/// Installs the global subscriber. `LOG_LEVEL` (`trace` … `error`, default `info`) sets the
/// threshold for both `tracing` events and [`emit`].
pub fn init() {
    let level = std::env::var("LOG_LEVEL")
        .ok()
        .and_then(|value| value.parse::<Level>().ok())
        .unwrap_or(Level::INFO);
    let _ = MAX_LEVEL.set(level);
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::new(level.as_str().to_ascii_lowercase()))
        .event_format(PinoFormat)
        .init();
}

/// Writes one structured line. Used for request logs, whose `client` and `fields` values are
/// objects and arrays that `tracing` fields cannot carry.
pub fn emit(level: Level, mut fields: Map<String, Value>) {
    if level > *MAX_LEVEL.get().unwrap_or(&Level::INFO) {
        return;
    }
    fields.insert("level".to_owned(), Value::from(level_name(level)));
    let mut line = serde_json::to_vec(&Value::Object(fields)).expect("a JSON map serializes");
    line.push(b'\n');
    // One write per line, under the stdout lock, so concurrent lines never interleave.
    let _ = std::io::stdout().lock().write_all(&line);
}

fn level_name(level: Level) -> &'static str {
    match level {
        Level::TRACE => "trace",
        Level::DEBUG => "debug",
        Level::INFO => "info",
        Level::WARN => "warn",
        Level::ERROR => "error",
    }
}

struct PinoFormat;

impl<S, N> FormatEvent<S, N> for PinoFormat
where
    S: Subscriber + for<'a> LookupSpan<'a>,
    N: for<'a> FormatFields<'a> + 'static,
{
    fn format_event(
        &self,
        _ctx: &FmtContext<'_, S, N>,
        mut writer: Writer<'_>,
        event: &Event<'_>,
    ) -> fmt::Result {
        let mut fields = JsonFields(Map::new());
        event.record(&mut fields);
        let mut map = fields.0;
        map.insert(
            "level".to_owned(),
            Value::from(level_name(*event.metadata().level())),
        );
        let line = serde_json::to_string(&Value::Object(map)).map_err(|_| fmt::Error)?;
        writeln!(writer, "{line}")
    }
}

/// Collects event fields into a JSON map; the `message` field becomes pino's `msg`.
struct JsonFields(Map<String, Value>);

impl JsonFields {
    fn insert(&mut self, field: &Field, value: Value) {
        let key = match field.name() {
            "message" => "msg",
            name => name,
        };
        self.0.insert(key.to_owned(), value);
    }
}

impl Visit for JsonFields {
    fn record_str(&mut self, field: &Field, value: &str) {
        self.insert(field, Value::from(value));
    }

    fn record_i64(&mut self, field: &Field, value: i64) {
        self.insert(field, Value::from(value));
    }

    fn record_u64(&mut self, field: &Field, value: u64) {
        self.insert(field, Value::from(value));
    }

    fn record_f64(&mut self, field: &Field, value: f64) {
        self.insert(field, Value::from(value));
    }

    fn record_bool(&mut self, field: &Field, value: bool) {
        self.insert(field, Value::from(value));
    }

    fn record_error(&mut self, field: &Field, value: &(dyn std::error::Error + 'static)) {
        self.insert(field, Value::from(value.to_string()));
    }

    fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
        self.insert(field, Value::from(format!("{value:?}")));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tracing_subscriber::fmt::MakeWriter;

    #[derive(Clone, Default)]
    struct Capture(Arc<Mutex<Vec<u8>>>);

    impl Write for Capture {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl<'a> MakeWriter<'a> for Capture {
        type Writer = Capture;

        fn make_writer(&'a self) -> Self::Writer {
            self.clone()
        }
    }

    #[test]
    fn formats_events_as_pino_json() {
        let capture = Capture::default();
        let subscriber = tracing_subscriber::fmt()
            .event_format(PinoFormat)
            .with_writer(capture.clone())
            .finish();
        tracing::subscriber::with_default(subscriber, || {
            tracing::warn!(
                dependency = "redis",
                attempts = 2_u64,
                "Readiness check failed"
            );
        });

        let output = String::from_utf8(capture.0.lock().unwrap().clone()).unwrap();
        let line: Value = serde_json::from_str(output.trim()).unwrap();
        assert_eq!(
            line,
            serde_json::json!({
                "level": "warn",
                "msg": "Readiness check failed",
                "dependency": "redis",
                "attempts": 2,
            })
        );
    }
}
