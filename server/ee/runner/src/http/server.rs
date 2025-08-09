use axum::{routing::{post, get}, Json, Router};
use std::net::SocketAddr;

use crate::models::{ExecuteRequest, ExecuteResponse};

pub async fn run() -> anyhow::Result<()> {
    let app = Router::new()
        .route("/v1/execute", post(execute))
        .route("/healthz", get(healthz))
        .route("/warmup", get(warmup));

    let addr: SocketAddr = ([0, 0, 0, 0], 8080).into();
    tracing::info!("listening on {}", addr);
    axum::serve(tokio::net::TcpListener::bind(addr).await?, app).await?;
    Ok(())
}

async fn execute(Json(_req): Json<ExecuteRequest>) -> Json<ExecuteResponse> {
    Json(ExecuteResponse {
        status: 501,
        headers: Default::default(),
        body_b64: Some(base64::encode("not implemented")),
        error: Some("not_implemented".to_string()),
    })
}

async fn healthz() -> &'static str { "ok" }

async fn warmup() -> &'static str { "warmed" }
