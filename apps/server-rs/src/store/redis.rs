use std::sync::Arc;

use redis::aio::ConnectionManager;
use redis::{Client, RedisResult};
use tokio::sync::OnceCell;

use crate::config::RedisConfig;

/// Shared Redis access. The connection opens on first use and `ConnectionManager` reconnects
/// after that, so the server boots (and `/readyz` reports the outage) while Redis is down.
#[derive(Clone)]
pub struct RedisStore {
    client: Client,
    connection: Arc<OnceCell<ConnectionManager>>,
    prefix: Arc<str>,
}

impl RedisStore {
    /// Builds the store without any I/O.
    pub fn new(config: &RedisConfig) -> RedisResult<Self> {
        Ok(Self {
            client: Client::open(connection_url(config))?,
            connection: Arc::new(OnceCell::new()),
            prefix: Arc::from(config.key_prefix.as_str()),
        })
    }

    /// The full key for `suffix`, under this server's prefix.
    pub fn key(&self, suffix: &str) -> String {
        format!("{}{suffix}", self.prefix)
    }

    /// A cheap clone of the shared multiplexed connection, opened on first call.
    pub async fn connection(&self) -> RedisResult<ConnectionManager> {
        self.connection
            .get_or_try_init(|| ConnectionManager::new(self.client.clone()))
            .await
            .cloned()
    }

    pub async fn ping(&self) -> RedisResult<()> {
        let mut connection = self.connection().await?;
        redis::cmd("PING")
            .query_async::<String>(&mut connection)
            .await?;
        Ok(())
    }
}

fn connection_url(config: &RedisConfig) -> String {
    let credentials = match (&config.username, &config.password) {
        (None, None) => String::new(),
        (username, password) => format!(
            "{}:{}@",
            encode_userinfo(username.as_deref().unwrap_or_default()),
            encode_userinfo(password.as_ref().map(|p| p.expose()).unwrap_or_default()),
        ),
    };
    // Bracket IPv6 literals so the port separator stays unambiguous.
    let host = if config.host.contains(':') && !config.host.starts_with('[') {
        format!("[{}]", config.host)
    } else {
        config.host.clone()
    };
    format!("redis://{credentials}{host}:{}", config.port)
}

/// Percent-encodes everything outside RFC 3986's unreserved set, so passwords containing `@`,
/// `:` or `/` survive the URL.
fn encode_userinfo(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Secret;

    fn config(host: &str, username: Option<&str>, password: Option<&str>) -> RedisConfig {
        RedisConfig {
            host: host.to_owned(),
            port: 6379,
            username: username.map(str::to_owned),
            password: password.map(Secret::new),
            key_prefix: "rs:".to_owned(),
        }
    }

    #[test]
    fn builds_urls_with_and_without_credentials() {
        assert_eq!(
            connection_url(&config("redis.example.internal", None, None)),
            "redis://redis.example.internal:6379"
        );
        assert_eq!(
            connection_url(&config("localhost", Some("default"), Some("p@ss:w/rd"))),
            "redis://default:p%40ss%3Aw%2Frd@localhost:6379"
        );
        assert_eq!(
            connection_url(&config("localhost", None, Some("secret"))),
            "redis://:secret@localhost:6379"
        );
    }

    #[test]
    fn brackets_ipv6_hosts() {
        assert_eq!(
            connection_url(&config("::1", None, None)),
            "redis://[::1]:6379"
        );
    }

    #[test]
    fn prefixes_keys() {
        let store = RedisStore::new(&config("localhost", None, None)).unwrap();
        assert_eq!(store.key("cms:coreSettings:v1"), "rs:cms:coreSettings:v1");
    }
}
