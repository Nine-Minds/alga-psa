mod cache;
mod engine;
mod http;
mod models;
mod providers;
mod registry;
mod secrets;
mod util;

use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // init tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Build banner for visibility
    let build_sha = option_env!("ALGA_BUILD_GIT_SHA").unwrap_or("unknown");
    let build_unix = option_env!("ALGA_BUILD_UNIX_SECS").unwrap_or("0");
    tracing::info!(git_sha=%build_sha, build_unix_secs=%build_unix, "runner build");

    // Log key environment configuration for easier diagnostics
    let reg_base = std::env::var("REGISTRY_BASE_URL").unwrap_or_else(|_| "<unset>".into());
    let bundle_base = std::env::var("BUNDLE_STORE_BASE").unwrap_or_else(|_| "<unset>".into());
    let strict = std::env::var("EXT_STATIC_STRICT_VALIDATION").unwrap_or_else(|_| "<unset>".into());
    // Note: static file size limit env is EXT_STATIC_MAX_FILE_BYTES
    let cache_bytes =
        std::env::var("EXT_STATIC_MAX_FILE_BYTES").unwrap_or_else(|_| "<unset>".into());
    tracing::info!(
        REGISTRY_BASE_URL=%reg_base,
        BUNDLE_STORE_BASE=%bundle_base,
        EXT_STATIC_STRICT_VALIDATION=%strict,
        EXT_STATIC_MAX_FILE_BYTES=%cache_bytes,
        "runner config"
    );

    http::server::run().await
}
