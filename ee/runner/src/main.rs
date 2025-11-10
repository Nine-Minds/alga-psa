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
    tracing::info!("=== Extension Runner Service Starting ===");

    // Initialize tracing first
    tracing::info!("Initializing tracing subsystem...");
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();
    tracing::info!("✓ Tracing initialized successfully");

    // Initialize debug redis
    tracing::info!("Initializing debug Redis connection...");
    crate::engine::debug_redis::init_from_env().await;
    tracing::info!("✓ Debug Redis initialized");

    // Build banner for visibility
    let build_sha = option_env!("ALGA_BUILD_GIT_SHA").unwrap_or("unknown");
    let build_unix = option_env!("ALGA_BUILD_UNIX_SECS").unwrap_or("0");
    tracing::info!(
        git_sha=%build_sha,
        build_unix_secs=%build_unix,
        "Extension Runner Service - Build Information"
    );
    tracing::info!("Build: {} (commit {}) at Unix timestamp {}", build_sha, build_unix);

    // Log key environment configuration for easier diagnostics
    let reg_base = std::env::var("REGISTRY_BASE_URL").unwrap_or_else(|_| "<unset>".into());
    let bundle_base = std::env::var("BUNDLE_STORE_BASE").unwrap_or_else(|_| "<unset>".into());
    let strict = std::env::var("EXT_STATIC_STRICT_VALIDATION").unwrap_or_else(|_| "<unset>".into());
    let cache_bytes = std::env::var("EXT_STATIC_MAX_FILE_BYTES").unwrap_or_else(|_| "<unset>".into());
    let auth_key_present = std::env::var("ALGA_AUTH_KEY").ok().map(|k| !k.is_empty()).unwrap_or(false);
    let cache_root = std::env::var("EXT_CACHE_ROOT").unwrap_or_else(|_| "<unset>".into());
    let pool_total = std::env::var("WASM_POOL_TOTAL_COMPONENTS").unwrap_or_else(|_| "256".into());

    tracing::info!("═══════════════════════════════════════════════════════");
    tracing::info!("Configuration Overview:");
    tracing::info!("  ✓ Registry Base URL: {}", reg_base);
    tracing::info!("  ✓ Bundle Store Base: {}", bundle_base);
    tracing::info!("  ✓ Static File Validation: {}", strict);
    tracing::info!("  ✓ Max File Size Limit: {} bytes", cache_bytes);
    tracing::info!("  ✓ Auth Key Configured: {}", if auth_key_present { "YES" } else { "NO - registry calls may fail" });
    tracing::info!("  ✓ Cache Root: {}", cache_root);
    tracing::info!("  ✓ Wasmtime Pool Size: {} components", pool_total);
    tracing::info!("═══════════════════════════════════════════════════════");

    // Validate critical configuration
    tracing::info!("Validating critical configuration values...");
    if reg_base == "<unset>" {
        tracing::warn!("⚠ REGISTRY_BASE_URL not configured - registry operations will fail");
    }
    if bundle_base == "<unset>" {
        tracing::warn!("⚠ BUNDLE_STORE_BASE not configured - extension bundles cannot be fetched");
    }
    if !auth_key_present {
        tracing::warn!("⚠ ALGA_AUTH_KEY not present - registry requests may be unauthorized");
    }

    tracing::info!("Configuration validation complete");
    tracing::info!("═══════════════════════════════════════════════════════");
    tracing::info!("Starting HTTP server on configured port...");

    http::server::run().await
}
