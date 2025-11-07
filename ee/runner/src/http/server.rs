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
use url::Url;

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
    let core = CoreState {
        idempotency: Arc::new(Mutex::new(HashMap::new())),
    };

    // Load ALGA_AUTH_KEY from env or Vault at startup
    let api_key = crate::secrets::load_alga_auth_key().await;
    if api_key.is_none() {
        let default_path = "/vault/secrets/alga_auth_key";
        return Err(anyhow::anyhow!(
            format!(
                "ALGA_AUTH_KEY unavailable. Provide ALGA_AUTH_KEY or mount a file at ALGA_AUTH_KEY_FILE (default: {})",
                default_path
            )
        ));
    }

    // Validate required registry base URL exists and parses
    let reg_base = std::env::var("REGISTRY_BASE_URL")
        .map_err(|_| anyhow::anyhow!("REGISTRY_BASE_URL not set"))?;
    Url::parse(&reg_base).map_err(|e| anyhow::anyhow!("Invalid REGISTRY_BASE_URL: {}", e))?;

    let registry = Arc::new(HttpRegistryClient::new(api_key.clone())?);
    let cache_root = cache_fs::ext_cache_root_from_env();
    let bundle_store_base = Url::parse(
        &std::env::var("BUNDLE_STORE_BASE")
            .unwrap_or_else(|_| "http://localhost:9000/alga-ext/".into()),
    )?;
    let max_file_bytes = crate::util::limits::max_file_bytes_from_env();

    let ext = crate::http::ext_ui::AppState {
        registry,
        cache_root,
        bundle_store_base,
        max_file_bytes,
    };

    let state = RootState { core, ext, api_key };

    // Single router with routes for both APIs; state extracted via FromRef
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

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(8080);
    let addr: SocketAddr = ([0, 0, 0, 0], port).into();
    tracing::info!("listening on {}", addr);
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

    if !idem.is_empty() {
        let mut map = state.idempotency.lock().await;
        if let Some(prev) = map.get(&idem) {
            return Json(prev.clone());
        }
    }

    // Fetch wasm by content hash (scaffold)
    let content_hash = req.context.content_hash.clone();
    let hash = content_hash
        .strip_prefix("sha256:")
        .unwrap_or(&content_hash);
    let key = format!("sha256/{}/dist/main.wasm", hash);
    let loader = match ModuleLoader::new() {
        Ok(l) => l,
        Err(e) => {
            let resp = ExecuteResponse {
                status: 500,
                headers: Default::default(),
                body_b64: None,
                error: Some(format!("engine_init_failed: {}", e)),
            };
            return Json(resp);
        }
    };
    let wasm = match loader.fetch_object(&key).await {
        Ok(b) => b,
        Err(e) => {
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

    if host.is_empty() {
        tracing::warn!("host header missing on root request");
        return StatusCode::BAD_REQUEST.into_response();
    }

    // Build registry URL: {REGISTRY_BASE_URL}/api/installs/lookup-by-host?host=...
    let base = match std::env::var("REGISTRY_BASE_URL") {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(err=%e.to_string(), host=%host, "REGISTRY_BASE_URL not set");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };

    let mut url = match Url::parse(&base) {
        Ok(u) => u,
        Err(e) => {
            tracing::error!(base=%base, err=%e.to_string(), "REGISTRY_BASE_URL parse failed");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };
    url.set_path("api/installs/lookup-by-host");
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    url.query_pairs_mut()
        .append_pair("host", host.split(':').next().unwrap_or(""))
        .append_pair("ts", &now_ms.to_string());

    let http = match reqwest::Client::builder().build() {
        Ok(c) => c,
        Err(e) => {
            tracing::error!(err=%e.to_string(), "failed to build reqwest client");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };

    // Attach ALGA_AUTH_KEY if present for registry auth and log masked presence
    let mut rb = http.get(url.clone());
    match rstate.api_key.as_ref() {
        Some(key) if !key.is_empty() => {
            let prefix: String = key.chars().take(4).collect();
            let len = key.len();
            tracing::info!(key_len = len, key_prefix = %prefix, "ALGA_AUTH_KEY present; sending x-api-key header");
            rb = rb.header("x-api-key", key);
        }
        _ => {
            tracing::warn!("ALGA_AUTH_KEY not set; registry call may be unauthorized");
        }
    }

    tracing::info!(host=%host, url=%url.to_string(), "lookup-by-host request start");

    let resp = match rb.send().await {
        Ok(r) => r,
        Err(e) => {
            tracing::error!(host=%host, url=%url.to_string(), err=%e.to_string(), "registry request failed");
            return StatusCode::BAD_GATEWAY.into_response();
        }
    };

    if !resp.status().is_success() {
        let code = resp.status().as_u16();
        let path = url.path().to_string();
        tracing::info!(host=%host, status=%code, url_path=%path, "registry returned non-success for lookup-by-host");
        return StatusCode::NOT_FOUND.into_response();
    }

    tracing::info!(host=%host, status=%resp.status().as_u16(), "lookup-by-host response ok; reading body");
    let text = match resp.text().await {
        Ok(t) => t,
        Err(e) => {
            tracing::error!(host=%host, err=%e.to_string(), "failed to read registry response body");
            return StatusCode::BAD_GATEWAY.into_response();
        }
    };
    tracing::info!(host=%host, body_len=%text.len(), body_sample=%text.chars().take(200).collect::<String>(), "lookup-by-host response body");
    let body: LookupResp = match serde_json::from_str(&text) {
        Ok(b) => b,
        Err(e) => {
            tracing::error!(host=%host, err=%e.to_string(), "failed to parse registry response json");
            return StatusCode::BAD_GATEWAY.into_response();
        }
    };

    // Include tenant id as a query parameter to avoid extra lookup in ext-ui
    let target = format!(
        "/ext-ui/{}/{}/index.html?tenant={}",
        body.extension_id, body.content_hash, body.tenant_id
    );
    tracing::info!(host=%host, target=%target, "redirecting to ext-ui");
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
