use axum::{routing::{post, get}, Json, Router, extract::State, http::HeaderMap};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use std::net::SocketAddr;

use crate::models::{ExecuteRequest, ExecuteResponse};

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
    tracing::info!("execute called", request_id=%req_id, idempotency=%idem, tenant=%tenant, extension=%ext);

    if !idem.is_empty() {
        let mut map = state.idempotency.lock().await;
        if let Some(prev) = map.get(&idem) {
            return Json(prev.clone());
        }
    }

    let mut resp = ExecuteResponse {
        status: 501,
        headers: Default::default(),
        body_b64: Some(base64::encode("not implemented")),
        error: Some("not_implemented".to_string()),
    };

    if !idem.is_empty() {
        let mut map = state.idempotency.lock().await;
        map.insert(idem, resp.clone());
    }

    Json(resp)
        status: 501,
        headers: Default::default(),
        body_b64: Some(base64::encode("not implemented")),
        error: Some("not_implemented".to_string()),
    })
}

async fn healthz() -> &'static str { "ok" }

async fn warmup() -> &'static str { "warmed" }
