//! The Redis commands the GraphQL pipeline uses, behind a trait so tests run without Redis
//! (the spec's "Redis behind small traits with in-memory test implementations").
//!
//! Callers treat every error as a cache miss or a skipped write, the way the TS services catch
//! Redis failures, so an outage costs latency rather than correctness.

use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use redis::FromRedisValue;

use crate::store::RedisStore;

pub type StoreFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, StoreError>> + Send + 'a>>;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error(transparent)]
    Redis(#[from] redis::RedisError),
    #[error("Redis did not answer within {0:?}")]
    Timeout(Duration),
    /// Only produced by the in-memory test store.
    #[error("store unavailable")]
    Unavailable,
}

pub trait KeyValueStore: Send + Sync {
    /// The full key for `suffix`, under this server's prefix (`RedisStore::key`).
    fn key(&self, suffix: &str) -> String;
    fn get<'a>(&'a self, key: &'a str) -> StoreFuture<'a, Option<String>>;
    fn set_ex<'a>(&'a self, key: &'a str, seconds: u64, value: &'a str) -> StoreFuture<'a, ()>;
    fn del<'a>(&'a self, key: &'a str) -> StoreFuture<'a, ()>;
    fn incr<'a>(&'a self, key: &'a str) -> StoreFuture<'a, i64>;
    fn expire<'a>(&'a self, key: &'a str, seconds: i64) -> StoreFuture<'a, ()>;
    /// Seconds to live: `-2` for a missing key, `-1` for a key without an expiry.
    fn ttl<'a>(&'a self, key: &'a str) -> StoreFuture<'a, i64>;
}

/// The longest a single command may take, connection included. The TS server sets no timeout
/// on these commands (Bun's client queues them while it reconnects); without one, the
/// connection manager's six reconnect attempts would hold every request during an outage.
/// 500 ms matches the redis crate's response timeout and the TS record cache's Redis timeout.
pub const COMMAND_TIMEOUT: Duration = Duration::from_millis(500);

impl RedisStore {
    async fn query<T: FromRedisValue>(&self, command: redis::Cmd) -> Result<T, StoreError> {
        let run = async {
            let mut connection = self.connection().await?;
            command.query_async::<T>(&mut connection).await
        };
        match tokio::time::timeout(COMMAND_TIMEOUT, run).await {
            Ok(result) => Ok(result?),
            Err(_) => Err(StoreError::Timeout(COMMAND_TIMEOUT)),
        }
    }
}

/// `redis::Cmd` from a name and arguments.
macro_rules! command {
    ($name:literal $(, $arg:expr)*) => {{
        let mut command = redis::cmd($name);
        $(command.arg($arg);)*
        command
    }};
}

impl KeyValueStore for RedisStore {
    fn key(&self, suffix: &str) -> String {
        RedisStore::key(self, suffix)
    }

    fn get<'a>(&'a self, key: &'a str) -> StoreFuture<'a, Option<String>> {
        Box::pin(self.query(command!("GET", key)))
    }

    fn set_ex<'a>(&'a self, key: &'a str, seconds: u64, value: &'a str) -> StoreFuture<'a, ()> {
        Box::pin(self.query(command!("SETEX", key, seconds, value)))
    }

    fn del<'a>(&'a self, key: &'a str) -> StoreFuture<'a, ()> {
        Box::pin(async move {
            self.query::<i64>(command!("DEL", key)).await?;
            Ok(())
        })
    }

    fn incr<'a>(&'a self, key: &'a str) -> StoreFuture<'a, i64> {
        Box::pin(self.query(command!("INCR", key)))
    }

    fn expire<'a>(&'a self, key: &'a str, seconds: i64) -> StoreFuture<'a, ()> {
        Box::pin(async move {
            self.query::<i64>(command!("EXPIRE", key, seconds)).await?;
            Ok(())
        })
    }

    fn ttl<'a>(&'a self, key: &'a str) -> StoreFuture<'a, i64> {
        Box::pin(self.query(command!("TTL", key)))
    }
}

#[cfg(test)]
pub use memory::MemoryStore;

#[cfg(test)]
mod memory {
    use std::collections::HashMap;
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::time::Duration;

    use tokio::time::Instant;

    use super::{KeyValueStore, StoreError, StoreFuture};

    /// An in-memory Redis stand-in. Expiry follows tokio's clock, so paused-time tests can
    /// advance it. `set_failing(true)` makes every command fail, like an unreachable Redis.
    #[derive(Default)]
    pub struct MemoryStore {
        prefix: String,
        entries: Mutex<HashMap<String, (String, Option<Instant>)>>,
        failing: AtomicBool,
        commands: AtomicUsize,
    }

    impl MemoryStore {
        pub fn new(prefix: &str) -> Self {
            Self {
                prefix: prefix.to_owned(),
                ..Self::default()
            }
        }

        pub fn set_failing(&self, failing: bool) {
            self.failing.store(failing, Ordering::SeqCst);
        }

        /// The live value under the full `key`.
        pub fn raw(&self, key: &str) -> Option<String> {
            let mut entries = self.entries.lock().unwrap();
            live(&mut entries, key).map(|(value, _)| value.clone())
        }

        pub fn insert_raw(&self, key: &str, value: &str) {
            self.entries
                .lock()
                .unwrap()
                .insert(key.to_owned(), (value.to_owned(), None));
        }

        pub fn keys(&self) -> Vec<String> {
            let mut keys: Vec<String> = self.entries.lock().unwrap().keys().cloned().collect();
            keys.sort();
            keys
        }

        /// How many commands were attempted, failed ones included.
        pub fn commands(&self) -> usize {
            self.commands.load(Ordering::SeqCst)
        }

        fn run<T: Send + 'static>(
            &self,
            op: impl FnOnce(&mut HashMap<String, (String, Option<Instant>)>) -> T,
        ) -> StoreFuture<'_, T> {
            self.commands.fetch_add(1, Ordering::SeqCst);
            let result = if self.failing.load(Ordering::SeqCst) {
                Err(StoreError::Unavailable)
            } else {
                Ok(op(&mut self.entries.lock().unwrap()))
            };
            Box::pin(async move { result })
        }
    }

    fn live<'m>(
        entries: &'m mut HashMap<String, (String, Option<Instant>)>,
        key: &str,
    ) -> Option<&'m mut (String, Option<Instant>)> {
        let expired = entries
            .get(key)
            .is_some_and(|(_, expires)| expires.is_some_and(|at| at <= Instant::now()));
        if expired {
            entries.remove(key);
        }
        entries.get_mut(key)
    }

    impl KeyValueStore for MemoryStore {
        fn key(&self, suffix: &str) -> String {
            format!("{}{suffix}", self.prefix)
        }

        fn get<'a>(&'a self, key: &'a str) -> StoreFuture<'a, Option<String>> {
            self.run(|entries| live(entries, key).map(|(value, _)| value.clone()))
        }

        fn set_ex<'a>(&'a self, key: &'a str, seconds: u64, value: &'a str) -> StoreFuture<'a, ()> {
            self.run(|entries| {
                let expires = Instant::now() + Duration::from_secs(seconds);
                entries.insert(key.to_owned(), (value.to_owned(), Some(expires)));
            })
        }

        fn del<'a>(&'a self, key: &'a str) -> StoreFuture<'a, ()> {
            self.run(|entries| {
                entries.remove(key);
            })
        }

        fn incr<'a>(&'a self, key: &'a str) -> StoreFuture<'a, i64> {
            self.run(|entries| match live(entries, key) {
                Some((value, _)) => {
                    let next = value.parse::<i64>().unwrap_or(0) + 1;
                    *value = next.to_string();
                    next
                }
                None => {
                    entries.insert(key.to_owned(), ("1".to_owned(), None));
                    1
                }
            })
        }

        fn expire<'a>(&'a self, key: &'a str, seconds: i64) -> StoreFuture<'a, ()> {
            self.run(|entries| {
                if let Some((_, expires)) = live(entries, key) {
                    let seconds = u64::try_from(seconds).unwrap_or(0);
                    *expires = Some(Instant::now() + Duration::from_secs(seconds));
                }
            })
        }

        fn ttl<'a>(&'a self, key: &'a str) -> StoreFuture<'a, i64> {
            self.run(|entries| match live(entries, key) {
                None => -2,
                Some((_, None)) => -1,
                Some((_, Some(at))) => {
                    let left = at.saturating_duration_since(Instant::now());
                    i64::try_from(left.as_millis().div_ceil(1000)).unwrap_or(i64::MAX)
                }
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::Instant;

    use super::*;
    use crate::config::RedisConfig;

    #[tokio::test]
    async fn redis_commands_fail_within_the_timeout_when_redis_is_down() {
        let store = RedisStore::new(&RedisConfig {
            host: "127.0.0.1".to_owned(),
            port: 1,
            username: None,
            password: None,
            key_prefix: "rs:".to_owned(),
        })
        .unwrap();
        let start = Instant::now();
        assert!(KeyValueStore::get(&store, "rs:example").await.is_err());
        assert!(store.incr("rs:example").await.is_err());
        assert!(start.elapsed() < COMMAND_TIMEOUT * 3);
    }
}
