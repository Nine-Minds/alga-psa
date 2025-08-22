mod http;
mod models;
mod engine;
mod cache;
mod util;
mod registry;

use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // init tracing
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Log key environment configuration for easier diagnostics
    let reg_base = std::env::var("REGISTRY_BASE_URL").unwrap_or_else(|_| "<unset>".into());
    let bundle_base = std::env::var("BUNDLE_STORE_BASE").unwrap_or_else(|_| "<unset>".into());
    let strict = std::env::var("EXT_STATIC_STRICT_VALIDATION").unwrap_or_else(|_| "<unset>".into());
    let cache_bytes = std::env::var("EXT_CACHE_MAX_BYTES").unwrap_or_else(|_| "<unset>".into());
    tracing::info!(
        REGISTRY_BASE_URL=%reg_base,
        BUNDLE_STORE_BASE=%bundle_base,
        EXT_STATIC_STRICT_VALIDATION=%strict,
        EXT_CACHE_MAX_BYTES=%cache_bytes,
        "runner config"
    );

    http::server::run().await
}
