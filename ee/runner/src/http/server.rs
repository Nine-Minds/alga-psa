use axum::response::{IntoResponse, Redirect, Response};
use axum::{
    extract::{FromRef, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    routing::{get, post},
    Json, Router,
};
use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;
use tower_http::{set_header::SetResponseHeaderLayer, trace::TraceLayer};
use url::{form_urlencoded, Url};

use crate::cache::fs as cache_fs;
use crate::engine::loader::{HostExecutionContext, ModuleLoader};
use crate::models::{ExecuteRequest, ExecuteResponse};
use crate::providers;
use crate::registry::client::HttpRegistryClient;

// Idempotency cache
type IdemMap = Arc<Mutex<HashMap<String, crate::models::ExecuteResponse>>>;

// Core state for execute API
#[derive(Clone)]
struct CoreState {
    idempotency: IdemMap,
}

// Root state containing both core and ext-ui states.
// Handlers extract their needed state via FromRef.
#[derive(Clone)]
struct RootState {
    core: CoreState,
    ext: crate::http::ext_ui::AppState,
    api_key: Option<String>,
}

// Allow extracting CoreState from RootState
impl FromRef<RootState> for CoreState {
    fn from_ref(root: &RootState) -> CoreState {
        root.core.clone()
    }
}

// Allow extracting ext-ui AppState from RootState
impl FromRef<RootState> for crate::http::ext_ui::AppState {
    fn from_ref(root: &RootState) -> crate::http::ext_ui::AppState {
        root.ext.clone()
    }
}

// Build and run the HTTP server
pub async fn run() -> anyhow::Result<()> {
    tracing::info!("═══════════════════════════════════════════════════════");
    tracing::info!("HTTP Server Initialization");
    tracing::info!("═══════════════════════════════════════════════════════");

    // Initialize core state
    tracing::info!("Initializing core execution state...");
    let core = CoreState {
        idempotency: Arc::new(Mutex::new(HashMap::new())),
    };
    tracing::info!("✓ Core state initialized (idempotency cache ready)");

    // Load ALGA_AUTH_KEY from env or Vault at startup
    tracing::info!("Loading ALGA_AUTH_KEY from environment...");
    let api_key = crate::secrets::load_alga_auth_key().await;
    if api_key.is_none() {
        let default_path = "/vault/secrets/alga_auth_key";
        tracing::error!("CRITICAL: ALGA_AUTH_KEY not available");
        tracing::error!("Please provide ALGA_AUTH_KEY environment variable or mount a file at ALGA_AUTH_KEY_FILE (default: {})", default_path);
        return Err(anyhow::anyhow!(
            format!(
                "ALGA_AUTH_KEY unavailable. Provide ALGA_AUTH_KEY or mount a file at ALGA_AUTH_KEY_FILE (default: {})",
                default_path
            )
        ));
    }
    tracing::info!("✓ ALGA_AUTH_KEY loaded successfully");

    // Validate required registry base URL exists and parses
    tracing::info!("Validating REGISTRY_BASE_URL configuration...");
    let reg_base = std::env::var("REGISTRY_BASE_URL")
        .map_err(|_| anyhow::anyhow!("REGISTRY_BASE_URL not set"))?;
    Url::parse(&reg_base).map_err(|e| anyhow::anyhow!("Invalid REGISTRY_BASE_URL: {}", e))?;
    tracing::info!("✓ Registry base URL validated: {}", reg_base);

    // Initialize registry client
    tracing::info!("Initializing registry client...");
    let registry = Arc::new(HttpRegistryClient::new(api_key.clone())?);
    tracing::info!("✓ Registry client initialized");

    // Initialize cache and bundle store
    tracing::info!("Initializing cache and bundle store configuration...");
    let cache_root = cache_fs::ext_cache_root_from_env();
    tracing::info!("  ✓ Cache root: {}", cache_root.display());

    let bundle_store_base = Url::parse(
        &std::env::var("BUNDLE_STORE_BASE")
            .unwrap_or_else(|_| "http://localhost:9000/alga-ext/".into()),
    )?;
    tracing::info!("  ✓ Bundle store base: {}", bundle_store_base);

    let max_file_bytes = crate::util::limits::max_file_bytes_from_env();
    tracing::info!("  ✓ Max file bytes limit: {:?}", max_file_bytes);

    let ext = crate::http::ext_ui::AppState {
        registry,
        cache_root,
        bundle_store_base,
        max_file_bytes,
    };
    tracing::info!("✓ Extension UI state initialized");

    let state = RootState { core, ext, api_key };
    tracing::info!("✓ Root state assembled");

    // Build router with all routes
    tracing::info!("Configuring HTTP routes...");
    let app = Router::new()
        .route("/v1/execute", post(execute))
        .route("/healthz", get(healthz))
        .route("/", get(root_dispatch))
        .route(
            "/ext-ui/:extensionId/:contentHash/*path",
            get(crate::http::ext_ui::handle_get),
        )
        .route("/warmup", post(crate::http::ext_ui::warmup))
        .with_state(state)
        .layer(TraceLayer::new_for_http())
        .layer(SetResponseHeaderLayer::overriding(
            axum::http::header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        ));
    tracing::info!("✓ HTTP routes configured:");
    tracing::info!("  - POST /v1/execute (extension execution)");
    tracing::info!("  - GET  /healthz (health check)");
    tracing::info!("  - GET  / (root dispatcher)");
    tracing::info!("  - GET  /ext-ui/:extensionId/:contentHash/*path (UI file serving)");
    tracing::info!("  - POST /warmup (cache warmup)");

    // Configure server address
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(8080);
    let addr: SocketAddr = ([0, 0, 0, 0], port).into();
    tracing::info!("═══════════════════════════════════════════════════════");
    tracing::info!("HTTP Server Ready");
    tracing::info!("  Address: {}", addr);
    tracing::info!("  Protocol: HTTP");
    tracing::info!("═══════════════════════════════════════════════════════");
    tracing::info!("Server startup complete - listening for requests");

    axum::serve(tokio::net::TcpListener::bind(addr).await?, app).await?;
    Ok(())
}

async fn execute(
    State(state): State<CoreState>,
    headers: HeaderMap,
    Json(req): Json<ExecuteRequest>,
) -> Json<ExecuteResponse> {
    let started = Instant::now();
    let req_id = headers
        .get("x-request-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let idem = headers
        .get("x-idempotency-key")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let tenant = headers
        .get("x-alga-tenant")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let ext = headers
        .get("x-alga-extension")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    tracing::info!(request_id=%req_id, idempotency=%idem, tenant=%tenant, extension=%ext, "execute start");

    if tenant.is_empty() || ext.is_empty() {
        tracing::error!(request_id=%req_id, "Missing tenant or extension headers for execute request");
        let resp = ExecuteResponse {
            status: 400,
            headers: Default::default(),
            body_b64: None,
            error: Some("missing_routing_headers".to_string()),
        };
        return Json(resp);
    }

    if !idem.is_empty() {
        let map = state.idempotency.lock().await;
        if let Some(prev) = map.get(&idem) {
            return Json(prev.clone());
        }
    }

    // Fetch wasm by content hash (scaffold)
    let content_hash = req.context.content_hash.clone();
    let hash = content_hash
        .strip_prefix("sha256:")
        .unwrap_or(&content_hash);
    tracing::info!(request_id=%req_id, tenant=%tenant, extension=%ext, content_hash=%hash, "Initializing Wasmtime ModuleLoader for extension execution");
    let loader = match ModuleLoader::new() {
        Ok(l) => {
            tracing::info!(request_id=%req_id, "✓ ModuleLoader initialized successfully");
            l
        }
        Err(e) => {
            tracing::error!(request_id=%req_id, err=%e.to_string(), "FAILED: ModuleLoader initialization failed");
            tracing::error!(request_id=%req_id, "This error indicates Wasmtime engine configuration failure");
            let resp = ExecuteResponse {
                status: 500,
                headers: Default::default(),
                body_b64: None,
                error: Some(format!("engine_init_failed: {}", e)),
            };
            return Json(resp);
        }
    };

    const DEFAULT_WASM_ENTRY: &str = "dist/main.wasm";
    tracing::info!(request_id=%req_id, tenant=%tenant, extension=%ext, entry=DEFAULT_WASM_ENTRY, "Ensuring WASM binary is cached locally");
    let wasm = match loader
        .load_wasm_module(tenant, ext, &content_hash, DEFAULT_WASM_ENTRY)
        .await
    {
        Ok(b) => {
            tracing::info!(request_id=%req_id, wasm_size=%b.len(), "✓ WASM binary downloaded from bundle store");
            tracing::info!(request_id=%req_id, "WASM binary ready for Wasmtime instantiation");
            b
        }
        Err(e) => {
            tracing::error!(request_id=%req_id, tenant=%tenant, extension=%ext, err=%e.to_string(), "FAILED: WASM binary load failed");
            tracing::error!(request_id=%req_id, "This error indicates the extension bundle could not be retrieved or extracted");
            let resp = ExecuteResponse {
                status: 502,
                headers: Default::default(),
                body_b64: None,
                error: Some(format!("bundle_fetch_failed: {}", e)),
            };
            return Json(resp);
        }
    };

    // Build normalized request JSON for guest handler
    let mut provider_set: HashSet<String> = req
        .providers
        .iter()
        .map(|p| providers::normalize(p))
        .filter(|p| !p.is_empty())
        .collect();
    for cap in providers::default_capabilities() {
        provider_set.insert(cap.to_string());
    }
    if let Err(unknown) = providers::validate(provider_set.iter()) {
        let joined = unknown.join(", ");
        tracing::warn!(tenant=%tenant, extension=%ext, %joined, "unknown capability providers");
        let resp = ExecuteResponse {
            status: 400,
            headers: Default::default(),
            body_b64: None,
            error: Some(format!("unknown_capabilities: {}", joined)),
        };
        return Json(resp);
    }

    tracing::info!(
        request_id=%req_id,
        tenant=%tenant,
        extension=%ext,
        secret_envelope_present=%req.secret_envelope.is_some(),
        "execute secret envelope check"
    );

    let secret_material = match req.secret_envelope.as_ref() {
        Some(env) => match crate::secrets::resolve_secret_material(
            &req.context.tenant_id,
            &req.context.extension_id,
            req.context.install_id.as_deref(),
            env,
        )
        .await
        {
            Ok(material) => Some(material),
            Err(err) => {
                tracing::error!(tenant=%tenant, extension=%ext, err=%err.to_string(), "secret envelope decryption failed");
                let resp = ExecuteResponse {
                    status: 500,
                    headers: Default::default(),
                    body_b64: None,
                    error: Some("secret_decrypt_failed".to_string()),
                };
                return Json(resp);
            }
        },
        None => None,
    };

    let host_ctx = HostExecutionContext {
        request_id: req.context.request_id.clone(),
        tenant_id: Some(req.context.tenant_id.clone()),
        extension_id: Some(req.context.extension_id.clone()),
        install_id: req.context.install_id.clone(),
        version_id: req.context.version_id.clone(),
        config: req.context.config.clone(),
        providers: provider_set.clone(),
        secrets: secret_material,
        user: req.user.clone(),
    };

    let exec_resp = match loader
        .execute_handler(
            &wasm,
            req.limits.timeout_ms,
            req.limits.memory_mb,
            &req,
            host_ctx,
        )
        .await
    {
        Ok(v) => v,
        Err(e) => {
            let dur_ms = started.elapsed().as_millis() as u64;
            tracing::error!(
                request_id=%req_id,
                tenant=%tenant,
                extension=%ext,
                duration_ms=%dur_ms,
                timeout_ms=?req.limits.timeout_ms,
                mem_mb=?req.limits.memory_mb,
                err_display=%e.to_string(),
                err_debug=?e,
                "execute failed"
            );
            let resp = ExecuteResponse {
                status: 500,
                headers: Default::default(),
                body_b64: None,
                error: Some(format!("execute_failed: {}", e)),
            };
            return Json(resp);
        }
    };

    let dur_ms = started.elapsed().as_millis() as u64;
    let body_len = exec_resp.body_b64.as_ref().map(|s| s.len()).unwrap_or(0);
    tracing::info!(request_id=%req_id, tenant=%tenant, extension=%ext, duration_ms=%dur_ms, status=%exec_resp.status, resp_b64_len=%body_len, timeout_ms=?req.limits.timeout_ms, mem_mb=?req.limits.memory_mb, "execute done");
    let resp = ExecuteResponse {
        status: exec_resp.status,
        headers: exec_resp.headers,
        body_b64: exec_resp.body_b64,
        error: exec_resp.error,
    };

    if !idem.is_empty() {
        let mut map = state.idempotency.lock().await;
        map.insert(idem, resp.clone());
    }

    Json(resp)
}

#[derive(serde::Deserialize)]
struct LookupResp {
    tenant_id: String,
    extension_id: String,
    content_hash: String,
}

async fn root_dispatch(State(rstate): State<RootState>, headers: HeaderMap) -> Response {
    let host = headers
        .get(axum::http::header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    tracing::info!(host=%host, "Root dispatch request received - resolving extension by host");

    if host.is_empty() {
        tracing::warn!(host=%host, "Root dispatch failed: missing host header");
        return StatusCode::BAD_REQUEST.into_response();
    }

    tracing::info!(host=%host, "Host header validated - querying registry for extension");

    // Build registry URL: {REGISTRY_BASE_URL}/api/installs/lookup-by-host?host=...
    let base = match std::env::var("REGISTRY_BASE_URL") {
        Ok(v) => {
            tracing::info!(host=%host, REGISTRY_BASE_URL=%v, "Registry base URL loaded from environment");
            v
        }
        Err(e) => {
            tracing::error!(host=%host, err=%e.to_string(), "CRITICAL: REGISTRY_BASE_URL not set");
            tracing::error!(host=%host, "Cannot perform extension lookup without registry base URL");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };

    let mut url = match Url::parse(&base) {
        Ok(u) => {
            tracing::info!(host=%host, registry_base=%base, "Registry base URL parsed successfully");
            u
        }
        Err(e) => {
            tracing::error!(host=%host, base=%base, err=%e.to_string(), "REGISTRY_BASE_URL parse failed - invalid URL format");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };
    url.set_path("api/installs/lookup-by-host");
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let clean_host = host.split(':').next().unwrap_or("");
    url.query_pairs_mut()
        .append_pair("host", clean_host)
        .append_pair("ts", &now_ms.to_string());

    tracing::info!(host=%host, lookup_url=%url.to_string(), "Registry lookup URL constructed");

    let http = match reqwest::Client::builder().build() {
        Ok(c) => {
            tracing::info!(host=%host, "HTTP client initialized for registry communication");
            c
        }
        Err(e) => {
            tracing::error!(host=%host, err=%e.to_string(), "CRITICAL: Failed to build HTTP client for registry requests");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };

    // Attach ALGA_AUTH_KEY if present for registry auth and log masked presence
    let mut rb = http.get(url.clone());
    match rstate.api_key.as_ref() {
        Some(key) if !key.is_empty() => {
            let prefix: String = key.chars().take(4).collect();
            let len = key.len();
            tracing::info!(host=%host, key_len=len, key_prefix=%prefix, "ALGA_AUTH_KEY present - attaching to registry request");
            rb = rb.header("x-api-key", key);
        }
        _ => {
            tracing::warn!(host=%host, "ALGA_AUTH_KEY not configured - registry request may be unauthorized");
        }
    }

    tracing::info!(host=%host, lookup_url=%url.to_string(), "Sending extension lookup request to registry");
    tracing::info!(host=%host, "Waiting for registry response (request timeout: default)");

    let resp = match rb.send().await {
        Ok(r) => {
            tracing::info!(host=%host, status=%r.status().as_u16(), "Registry response received");
            r
        }
        Err(e) => {
            tracing::error!(host=%host, lookup_url=%url.to_string(), err=%e.to_string(), "FAILED: Registry request failed - network or server error");
            tracing::error!(host=%host, "This indicates registry service is unavailable or unreachable");
            return StatusCode::BAD_GATEWAY.into_response();
        }
    };

    if !resp.status().is_success() {
        let code = resp.status().as_u16();
        let path = url.path().to_string();
        tracing::warn!(host=%host, status=%code, url_path=%path, "Registry returned non-success status for host lookup");
        tracing::warn!(host=%host, "No extension found for this host or extension is not available");
        return StatusCode::NOT_FOUND.into_response();
    }

    tracing::info!(host=%host, status=%resp.status().as_u16(), "Registry lookup successful - parsing response body");
    let text = match resp.text().await {
        Ok(t) => {
            tracing::info!(host=%host, response_bytes=%t.len(), "Registry response body received");
            t
        }
        Err(e) => {
            tracing::error!(host=%host, err=%e.to_string(), "FAILED: Could not read registry response body");
            return StatusCode::BAD_GATEWAY.into_response();
        }
    };
    tracing::info!(host=%host, body_len=%text.len(), body_sample=%text.chars().take(200).collect::<String>(), "Registry response body content");
    let body: LookupResp = match serde_json::from_str::<LookupResp>(&text) {
        Ok(b) => {
            tracing::info!(host=%host, tenant_id=%b.tenant_id, extension_id=%b.extension_id, content_hash=%b.content_hash, "Registry response parsed successfully");
            b
        }
        Err(e) => {
            tracing::error!(host=%host, err=%e.to_string(), "FAILED: Could not parse registry response JSON");
            tracing::error!(host=%host, "Registry response may be malformed or in unexpected format");
            return StatusCode::BAD_GATEWAY.into_response();
        }
    };

    // Include tenant + extension identifiers as query parameters so iframe clients can resolve context without
    // performing additional lookups or parsing path segments.
    let mut query = form_urlencoded::Serializer::new(String::new());
    query.append_pair("tenant", &body.tenant_id);
    query.append_pair("extensionId", &body.extension_id);
    let target = format!(
        "/ext-ui/{}/{}/index.html?{}",
        body.extension_id,
        body.content_hash,
        query.finish()
    );
    tracing::info!("═══════════════════════════════════════════════════════");
    tracing::info!("HOST DISPATCH COMPLETE");
    tracing::info!("Host: {}", host);
    tracing::info!("Tenant: {}", body.tenant_id);
    tracing::info!("Extension: {}", body.extension_id);
    tracing::info!("Content Hash: {}", body.content_hash);
    tracing::info!("Redirect Target: {}", target);
    tracing::info!("═══════════════════════════════════════════════════════");
    tracing::info!(host=%host, target=%target, "Redirecting to extension UI");

    Redirect::temporary(&target).into_response()
}

// Enhanced healthz: verify cache root writability and attempt lightweight HEAD to bundle store.
async fn healthz() -> impl axum::response::IntoResponse {
    use axum::response::Json as AxJson;
    use serde_json::json;
    use tokio::time::{timeout, Duration};

    let cache_root = cache_fs::ext_cache_root_from_env();
    let tmp = cache_root.join("healthz.tmp");

    let cache_writable = match tokio::fs::create_dir_all(&cache_root).await {
        Ok(_) => match tokio::fs::write(&tmp, b"ok").await {
            Ok(_) => {
                let _ = tokio::fs::remove_file(&tmp).await;
                true
            }
            Err(_) => false,
        },
        Err(_) => false,
    };

    let bundle_base = std::env::var("BUNDLE_STORE_BASE").unwrap_or_default();
    let mut degraded_reason = None;
    if !bundle_base.is_empty() {
        let client = reqwest::Client::builder().build();
        if let Ok(client) = client {
            let fut = client.head(bundle_base.trim_end_matches('/')).send();
            let resp_ok = match timeout(Duration::from_millis(1000), fut).await {
                Ok(Ok(resp)) => resp.status().is_success(),
                _ => false,
            };
            if !resp_ok {
                degraded_reason = Some("bundle_store_unreachable");
            }
        } else {
            degraded_reason = Some("http_client_init_failed");
        }
    }

    if !cache_writable {
        tracing::warn!(path=%cache_root.to_string_lossy(), "cache root not writable");
    }
    if let Some(reason) = degraded_reason.as_deref() {
        if reason != "ok" {
            tracing::warn!(bundle_base=%bundle_base, reason=%reason, "bundle store health degraded");
        }
    }
    let status_code = if cache_writable {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    let body = json!({
        "cache_writable": cache_writable,
        "bundle_store": degraded_reason.as_deref().unwrap_or("ok"),
        "ext_cache_max_bytes": std::env::var("EXT_CACHE_MAX_BYTES").ok(),
    });
    (status_code, AxJson(body))
}
