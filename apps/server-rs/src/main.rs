use std::net::{IpAddr, SocketAddr};

use anyhow::Context;
use hccna_server_rs::config::Config;
use hccna_server_rs::state::AppState;
use hccna_server_rs::{http, logging, reporting};
use tokio::net::TcpListener;
use tokio::sync::watch;

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

/// Sentry starts before the Tokio runtime, as the SDK requires, so every worker thread reports to
/// the same client; the guard lives until the runtime has stopped and then flushes.
fn main() -> anyhow::Result<()> {
    logging::init();
    let config = Config::from_env().context("invalid configuration")?;
    let _sentry = reporting::init(&config.sentry);
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .context("building the Tokio runtime")?
        .block_on(serve(config))
}

async fn serve(config: Config) -> anyhow::Result<()> {
    let host: IpAddr = config.host.parse().context("HOST must be an IP address")?;
    let app_addr = SocketAddr::new(host, config.port);
    let metrics_addr = SocketAddr::new(host, config.metrics_port);

    let state = AppState::new(config)?;
    // Like the TS server, Statsig loads its rule sets before the first request (bounded by the
    // SDK's 3 s initialization timeout); without a key this does nothing.
    state.gates.initialize().await;
    let app = http::router(state.clone());
    let metrics = http::metrics_router(state.metrics.clone());

    let app_listener = TcpListener::bind(app_addr)
        .await
        .with_context(|| format!("binding {app_addr}"))?;
    let metrics_listener = TcpListener::bind(metrics_addr)
        .await
        .with_context(|| format!("binding {metrics_addr}"))?;
    tracing::info!(
        port = app_addr.port(),
        metrics_port = metrics_addr.port(),
        "Server listening"
    );

    // Open the Redis connection before the first request; a failure here is not fatal because
    // `/readyz` reports it and the connection is retried on use.
    if let Err(error) = state.redis.ping().await {
        tracing::warn!(error = %error, "Redis is not reachable at startup");
    }

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    tokio::spawn(async move {
        shutdown_signal().await;
        tracing::info!("Shutting down");
        let _ = shutdown_tx.send(true);
    });

    tokio::try_join!(
        // The peer address is the rate limiter's key when `X-Real-IP` is absent.
        axum::serve(
            app_listener,
            app.into_make_service_with_connect_info::<SocketAddr>()
        )
        .with_graceful_shutdown(wait_for(shutdown_rx.clone())),
        axum::serve(metrics_listener, metrics).with_graceful_shutdown(wait_for(shutdown_rx)),
    )?;
    state.gates.shutdown().await;
    Ok(())
}

async fn wait_for(mut shutdown: watch::Receiver<bool>) {
    let _ = shutdown.wait_for(|stopping| *stopping).await;
}

/// SIGTERM is how Railway stops a deployment; SIGINT covers Ctrl-C locally.
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
}
