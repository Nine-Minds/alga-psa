use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ExecuteContext {
    pub request_id: Option<String>,
    pub tenant_id: String,
    pub extension_id: String,
    pub content_hash: String,
    pub version_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct HttpPayload {
    pub method: String,
    pub path: String,
    #[serde(default)]
    pub query: HashMap<String, String>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub body_b64: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone, Default)]
pub struct Limits {
    pub timeout_ms: Option<u64>,
    pub memory_mb: Option<u64>,
    pub fuel: Option<u64>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ExecuteRequest {
    pub context: ExecuteContext,
    pub http: HttpPayload,
    #[serde(default)]
    pub limits: Limits,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ExecuteResponse {
    pub status: u16,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub body_b64: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}

