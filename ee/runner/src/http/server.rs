use axum::{routing::{post, get}, Json, Router, extract::State, http::HeaderMap};
use base64::Engine;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use std::net::SocketAddr;
use std::time::Instant;

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
    let started = Instant::now();
    let req_id = headers.get("x-request-id").and_then(|v| v.to_str().ok()).unwrap_or("");
    let idem = headers.get("x-idempotency-key").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let tenant = headers.get("x-alga-tenant").and_then(|v| v.to_str().ok()).unwrap_or("");
    let ext = headers.get("x-alga-extension").and_then(|v| v.to_str().ok()).unwrap_or("");
    tracing::info!(request_id=%req_id, idempotency=%idem, tenant=%tenant, extension=%ext, "execute start");

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

    // Build normalized request JSON for guest handler
    let input = serde_json::json!({
        "context": {
            "request_id": req.context.request_id,
            "tenant_id": req.context.tenant_id,
            "extension_id": req.context.extension_id,
            "version_id": req.context.version_id,
        },
        "http": {
            "method": req.http.method,
            "path": req.http.path,
            "query": req.http.query,
            "headers": req.http.headers,
            "body_b64": req.http.body_b64,
        }
    });
    let input_bytes = match serde_json::to_vec(&input) {
        Ok(b) => b,
        Err(e) => {
            let resp = ExecuteResponse { status: 400, headers: Default::default(), body_b64: None, error: Some(format!("bad_input: {}", e)) };
            return Json(resp);
        }
    };

    let out_bytes = match loader.execute_handler(&wasm, req.limits.timeout_ms, req.limits.memory_mb, &input_bytes) {
        Ok(v) => v,
        Err(e) => {
            let dur_ms = started.elapsed().as_millis() as u64;
            tracing::error!(request_id=%req_id, tenant=%tenant, extension=%ext, duration_ms=%dur_ms, err=%e.to_string(), "execute failed");
            let resp = ExecuteResponse { status: 500, headers: Default::default(), body_b64: None, error: Some(format!("execute_failed: {}", e)) };
            return Json(resp);
        }
    };

    // Expect guest to return normalized response JSON: { status, headers, body_b64 }
    let mut status: u16 = 200;
    let mut headers: HashMap<String, String> = HashMap::new();
    let mut body_b64: Option<String> = None;
    match serde_json::from_slice::<serde_json::Value>(&out_bytes) {
        Ok(v) => {
            status = v.get("status").and_then(|x| x.as_u64()).unwrap_or(200) as u16;
            if let Some(h) = v.get("headers").and_then(|x| x.as_object()) {
                headers = h.iter().map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string())).collect();
            }
            body_b64 = v.get("body_b64").and_then(|x| x.as_str()).map(|s| s.to_string());
        }
        Err(_) => {
            body_b64 = Some(base64::engine::general_purpose::STANDARD.encode(out_bytes));
        }
    }

    let dur_ms = started.elapsed().as_millis() as u64;
    let body_len = body_b64.as_ref().map(|s| s.len()).unwrap_or(0);
    tracing::info!(request_id=%req_id, tenant=%tenant, extension=%ext, duration_ms=%dur_ms, status=%status, resp_b64_len=%body_len, timeout_ms=?req.limits.timeout_ms, mem_mb=?req.limits.memory_mb, "execute done");
    let resp = ExecuteResponse { status, headers, body_b64, error: None };

    if !idem.is_empty() {
        let mut map = state.idempotency.lock().await;
        map.insert(idem, resp.clone());
    }

    Json(resp)
}

async fn healthz() -> &'static str { "ok" }

async fn warmup() -> &'static str { "warmed" }
