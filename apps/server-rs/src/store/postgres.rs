use std::str::FromStr;

use sqlx::PgPool;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};

use crate::config::DatabaseConfig;

/// Builds the pool without connecting; connections open on first use, so the server boots (and
/// `/readyz` reports the outage) while Postgres is down. Like node-postgres with the TS server's
/// `statement_timeout` option, each connection starts with that `statement_timeout` (none when 0).
pub fn connect_lazy(config: &DatabaseConfig) -> Result<PgPool, sqlx::Error> {
    let mut options = PgConnectOptions::from_str(config.url.expose())?;
    let statement_timeout = config.statement_timeout.as_millis();
    if statement_timeout > 0 {
        options = options.options([("statement_timeout", statement_timeout.to_string())]);
    }
    Ok(PgPoolOptions::new()
        .max_connections(config.pool_max)
        .acquire_timeout(config.connection_timeout)
        .connect_lazy_with(options))
}

pub async fn ping(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT 1").execute(pool).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use crate::config::Secret;

    fn config(url: &str, statement_timeout: Duration) -> DatabaseConfig {
        DatabaseConfig {
            url: Secret::new(url),
            pool_max: 1,
            connection_timeout: Duration::from_secs(5),
            statement_timeout,
        }
    }

    #[test]
    fn rejects_an_invalid_url_without_connecting() {
        assert!(connect_lazy(&config("not a url", Duration::ZERO)).is_err());
    }

    /// Against `TEST_DATABASE_URL` (skipped without it).
    #[tokio::test]
    async fn starts_sessions_with_the_statement_timeout() {
        let Ok(url) = std::env::var("TEST_DATABASE_URL") else {
            eprintln!("skipped: TEST_DATABASE_URL is not set");
            return;
        };
        let show = |pool: PgPool| async move {
            let value: String = sqlx::query_scalar("SHOW statement_timeout")
                .fetch_one(&pool)
                .await
                .unwrap();
            pool.close().await;
            value
        };
        let pool = connect_lazy(&config(&url, Duration::from_secs(10))).unwrap();
        assert_eq!(show(pool).await, "10s");
        let pool = connect_lazy(&config(&url, Duration::ZERO)).unwrap();
        assert_eq!(show(pool).await, "0");
    }
}
