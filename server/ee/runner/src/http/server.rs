use axum::{routing::{post, get}, Json, Router, extract::State, http::HeaderMap};
use base64::Engine;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use std::net::SocketAddr;

use crate::models::{ExecuteRequest, ExecuteResponse};
use crate::engine::loader::ModuleLoader;

type IdemMap = Arc<Mutex<HashMap<String, crate::models::ExecuteResponse>>>;

#[derive(Clone)]
struct AppState {
    idempotency: IdemMap,
}

pub async fn run() -> anyhow::Result<()> {
    let state = AppState { idempotency: Arc::new(Mutex::new(HashMap::new())) };
    let app = Router::new()
        .route("/v1/execute", post(execute))
        .route("/healthz", get(healthz))
        .route("/warmup", get(warmup))
        .with_state(state);

    let addr: SocketAddr = ([0, 0, 0, 0], 8080).into();
    tracing::info!("listening on {}", addr);
    axum::serve(tokio::net::TcpListener::bind(addr).await?, app).await?;
    Ok(())
}

async fn execute(State(state): State<AppState>, headers: HeaderMap, Json(req): Json<ExecuteRequest>) -> Json<ExecuteResponse> {
    let req_id = headers.get("x-request-id").and_then(|v| v.to_str().ok()).unwrap_or("");
    let idem = headers.get("x-idempotency-key").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let tenant = headers.get("x-alga-tenant").and_then(|v| v.to_str().ok()).unwrap_or("");
    let ext = headers.get("x-alga-extension").and_then(|v| v.to_str().ok()).unwrap_or("");
    tracing::info!(request_id=%req_id, idempotency=%idem, tenant=%tenant, extension=%ext, "execute called");

    if !idem.is_empty() {
        let mut map = state.idempotency.lock().await;
        if let Some(prev) = map.get(&idem) {
            return Json(prev.clone());
        }
    }

    // Fetch wasm by content hash (scaffold)
    let content_hash = req.context.content_hash.clone();
    let hash = content_hash.strip_prefix("sha256:").unwrap_or(&content_hash);
    let key = format!("sha256/{}/dist/main.wasm", hash);
    let loader = match ModuleLoader::new() {
        Ok(l) => l,
        Err(e) => {
            let resp = ExecuteResponse { status: 500, headers: Default::default(), body_b64: None, error: Some(format!("engine_init_failed: {}", e)) };
            return Json(resp);
        }
    };
    let wasm = match loader.fetch_object(&key).await {
        Ok(b) => b,
        Err(e) => {
            let resp = ExecuteResponse { status: 502, headers: Default::default(), body_b64: None, error: Some(format!("bundle_fetch_failed: {}", e)) };
            return Json(resp);
        }
    };

    // Instantiate and optionally call exported `handler`
    let call_result = match loader.instantiate_and_maybe_call(&wasm, req.limits.timeout_ms, req.limits.memory_mb) {
        Ok(v) => v,
        Err(e) => {
            let resp = ExecuteResponse { status: 500, headers: Default::default(), body_b64: None, error: Some(format!("instantiate_failed: {}", e)) };
            return Json(resp);
        }
    };

    let body = if let Some(n) = call_result { format!("ok: {}", n) } else { "ok".to_string() };
    let resp = ExecuteResponse {
        status: 200,
        headers: Default::default(),
        body_b64: Some(base64::engine::general_purpose::STANDARD.encode(body)),
        error: None,
    };

    if !idem.is_empty() {
        let mut map = state.idempotency.lock().await;
        map.insert(idem, resp.clone());
    }

    Json(resp)
}

async fn healthz() -> &'static str { "ok" }

async fn warmup() -> &'static str { "warmed" }
