use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ExecuteContext {
    pub request_id: Option<String>,
    pub tenant_id: String,
    pub extension_id: String,
    #[serde(default)]
    pub install_id: Option<String>,
    pub content_hash: String,
    pub version_id: Option<String>,
    #[serde(default)]
    pub config: HashMap<String, String>,
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
pub struct UserInfo {
    pub user_id: String,
    pub user_email: String,
    pub user_name: String,
    pub user_type: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ExecuteRequest {
    pub context: ExecuteContext,
    pub http: HttpPayload,
    #[serde(default)]
    pub limits: Limits,
    #[serde(default, rename = "secret_envelope")]
    pub secret_envelope: Option<SecretEnvelope>,
    #[serde(default)]
    pub providers: Vec<String>,
    #[serde(default)]
    pub user: Option<UserInfo>,
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

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct SecretEnvelope {
    pub ciphertext_b64: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub algorithm: Option<String>,
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub key_path: Option<String>,
    #[serde(default)]
    pub mount: Option<String>,
}
