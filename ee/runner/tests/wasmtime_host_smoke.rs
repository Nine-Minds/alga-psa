use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::sync::Arc;

use alga_ext_runner::engine::loader::{HostExecutionContext, ModuleLoader, SecretMaterial};
use alga_ext_runner::models::{ExecuteContext, ExecuteRequest, HttpPayload, Limits};
use alga_ext_runner::providers;
use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use serial_test::serial;
use tokio::sync::oneshot;
const DYNAMIC_COMPONENT_WASM: &[u8] = include_bytes!("fixtures/dynamic_component/component.wasm");

struct EnvGuard {
    keys: Vec<String>,
}

impl EnvGuard {
    fn set(pairs: &[(&str, &str)]) -> Self {
        for (key, value) in pairs {
            std::env::set_var(key, value);
        }
        Self {
            keys: pairs.iter().map(|(key, _)| (*key).to_string()).collect(),
        }
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        for key in &self.keys {
            std::env::remove_var(key);
        }
    }
}

#[tokio::test]
async fn executes_dynamic_component_in_process() -> anyhow::Result<()> {
    let loader = ModuleLoader::new()?;

    let raw_payload = br#"{\"ping\":true}"#;
    let mut query = HashMap::new();
    query.insert("foo".to_string(), "bar".to_string());

    let mut headers = HashMap::new();
    headers.insert("content-type".to_string(), "application/json".to_string());

    let request = ExecuteRequest {
        context: ExecuteContext {
            request_id: Some("smoke-test".to_string()),
            tenant_id: "tenant-a".to_string(),
            extension_id: "demo-ext".to_string(),
            install_id: Some("install-1".to_string()),
            content_hash: "sha256:fixture".to_string(),
            version_id: Some("v1".to_string()),
            config: HashMap::new(),
        },
        http: HttpPayload {
            method: "POST".to_string(),
            path: "/dynamic/echo".to_string(),
            query,
            headers,
            body_b64: Some(BASE64_STANDARD.encode(raw_payload)),
        },
        limits: Limits {
            // Compilation of the JS component inside Wasmtime takes a noticeable amount of time on
            // cold runs. Give the host the same 5s window that the container test uses so the epoch
            // interrupt guard does not fire spuriously during local/CI runs.
            timeout_ms: Some(5_000),
            memory_mb: Some(64),
            fuel: None,
        },
        secret_envelope: None,
        providers: Vec::new(),
    };

    let providers: HashSet<String> = providers::default_capabilities()
        .into_iter()
        .map(|cap| cap.to_string())
        .collect();

    let host_ctx = HostExecutionContext {
        request_id: request.context.request_id.clone(),
        tenant_id: Some(request.context.tenant_id.clone()),
        extension_id: Some(request.context.extension_id.clone()),
        install_id: request.context.install_id.clone(),
        version_id: request.context.version_id.clone(),
        config: request.context.config.clone(),
        providers,
        secrets: None,
    };

    let response = loader
        .execute_handler(
            DYNAMIC_COMPONENT_WASM,
            request.limits.timeout_ms,
            request.limits.memory_mb,
            &request,
            host_ctx,
        )
        .await?;

    assert_eq!(response.status, 200);
    assert_eq!(
        response.headers.get("content-type"),
        Some(&"application/json".to_string())
    );
    assert_eq!(
        response.headers.get("x-generated-by"),
        Some(&"js-component".to_string())
    );

    let body_b64 = response.body_b64.expect("component returned body");
    let body_bytes = BASE64_STANDARD.decode(body_b64)?;
    let body_json: serde_json::Value = serde_json::from_slice(&body_bytes)?;

    assert_eq!(body_json.get("ok").and_then(|v| v.as_bool()), Some(true));
    assert_eq!(
        body_json.get("tenantId").and_then(|v| v.as_str()),
        Some("tenant-a")
    );
    assert_eq!(
        body_json.get("extensionId").and_then(|v| v.as_str()),
        Some("demo-ext")
    );
    assert_eq!(
        body_json.get("method").and_then(|v| v.as_str()),
        Some("POST")
    );
    assert_eq!(
        body_json.get("path").and_then(|v| v.as_str()),
        Some("/dynamic/echo?foo=bar")
    );

    let echo: Vec<u8> = body_json
        .get("echo")
        .and_then(|v| v.as_array())
        .expect("echo array present")
        .iter()
        .map(|v| v.as_u64().unwrap_or_default() as u8)
        .collect();
    assert_eq!(echo, raw_payload);

    Ok(())
}

fn decode_body(body_b64: &str) -> anyhow::Result<serde_json::Value> {
    let bytes = BASE64_STANDARD.decode(body_b64)?;
    Ok(serde_json::from_slice(&bytes)?)
}

#[tokio::test]
async fn executes_dynamic_component_with_secrets_capability() -> anyhow::Result<()> {
    let loader = ModuleLoader::new()?;

    let request = ExecuteRequest {
        context: ExecuteContext {
            request_id: Some("secrets-test".to_string()),
            tenant_id: "tenant-secrets".to_string(),
            extension_id: "ext-secrets".to_string(),
            install_id: Some("install-secrets".to_string()),
            content_hash: "sha256:fixture".to_string(),
            version_id: Some("v1".to_string()),
            config: HashMap::new(),
        },
        http: HttpPayload {
            method: "GET".to_string(),
            path: "/dynamic/secrets".to_string(),
            query: HashMap::new(),
            headers: HashMap::new(),
            body_b64: None,
        },
        limits: Limits {
            // Match the generous 5s window used by the container integration tests so the initial
            // component instantiation and proxy round-trip complete without the epoch watchdog
            // interrupting execution during cold runs.
            timeout_ms: Some(5_000),
            memory_mb: Some(64),
            fuel: None,
        },
        secret_envelope: None,
        providers: Vec::new(),
    };

    let mut providers: HashSet<String> = providers::default_capabilities()
        .into_iter()
        .map(|cap| cap.to_string())
        .collect();
    providers.insert("cap:secrets.get".to_string());

    let mut secret_values = HashMap::new();
    secret_values.insert("ALGA_API_KEY".to_string(), "sk_live_secret".to_string());
    secret_values.insert("OTHER_TOKEN".to_string(), "tok_secondary".to_string());

    let host_ctx = HostExecutionContext {
        request_id: request.context.request_id.clone(),
        tenant_id: Some(request.context.tenant_id.clone()),
        extension_id: Some(request.context.extension_id.clone()),
        install_id: request.context.install_id.clone(),
        version_id: request.context.version_id.clone(),
        config: request.context.config.clone(),
        providers,
        secrets: Some(SecretMaterial {
            values: secret_values,
            version: Some("v42".to_string()),
        }),
    };

    let response = loader
        .execute_handler(
            DYNAMIC_COMPONENT_WASM,
            request.limits.timeout_ms,
            request.limits.memory_mb,
            &request,
            host_ctx,
        )
        .await?;

    assert_eq!(response.status, 200);
    let body_json = decode_body(response.body_b64.as_ref().expect("body_b64 present"))?;
    assert_eq!(body_json.get("ok").and_then(|v| v.as_bool()), Some(true));

    let secrets = body_json
        .get("secrets")
        .and_then(|v| v.as_object())
        .expect("secrets object present");
    assert_eq!(
        secrets.get("value").and_then(|v| v.as_str()),
        Some("sk_live_secret")
    );
    let keys = secrets
        .get("keys")
        .and_then(|v| v.as_array())
        .expect("keys array present");
    let key_set: HashSet<String> = keys
        .iter()
        .filter_map(|v| v.as_str().map(|s| s.to_string()))
        .collect();
    assert!(key_set.contains("ALGA_API_KEY"));
    assert!(key_set.contains("OTHER_TOKEN"));
    assert!(secrets.get("error").and_then(|v| v.as_str()).is_none());
    Ok(())
}

#[tokio::test]
async fn secrets_capability_denied() -> anyhow::Result<()> {
    let loader = ModuleLoader::new()?;

    let request = ExecuteRequest {
        context: ExecuteContext {
            request_id: Some("secrets-denied".to_string()),
            tenant_id: "tenant-denied".to_string(),
            extension_id: "ext-denied".to_string(),
            install_id: Some("install-denied".to_string()),
            content_hash: "sha256:fixture".to_string(),
            version_id: Some("v1".to_string()),
            config: HashMap::new(),
        },
        http: HttpPayload {
            method: "GET".to_string(),
            path: "/dynamic/secrets".to_string(),
            query: HashMap::new(),
            headers: HashMap::new(),
            body_b64: None,
        },
        limits: Limits {
            timeout_ms: Some(1_000),
            memory_mb: Some(64),
            fuel: None,
        },
        secret_envelope: None,
        providers: Vec::new(),
    };

    let providers: HashSet<String> = providers::default_capabilities()
        .into_iter()
        .map(|cap| cap.to_string())
        .collect();

    let mut secret_values = HashMap::new();
    secret_values.insert("ALGA_API_KEY".to_string(), "sk_live_secret".to_string());

    let host_ctx = HostExecutionContext {
        request_id: request.context.request_id.clone(),
        tenant_id: Some(request.context.tenant_id.clone()),
        extension_id: Some(request.context.extension_id.clone()),
        install_id: request.context.install_id.clone(),
        version_id: request.context.version_id.clone(),
        config: request.context.config.clone(),
        providers,
        secrets: Some(SecretMaterial {
            values: secret_values,
            version: Some("v1".to_string()),
        }),
    };

    let response = loader
        .execute_handler(
            DYNAMIC_COMPONENT_WASM,
            request.limits.timeout_ms,
            request.limits.memory_mb,
            &request,
            host_ctx,
        )
        .await?;

    assert_eq!(response.status, 200);
    let body_json = decode_body(response.body_b64.as_ref().expect("body_b64 present"))?;
    assert_eq!(body_json.get("ok").and_then(|v| v.as_bool()), Some(false));
    let secrets = body_json
        .get("secrets")
        .and_then(|v| v.as_object())
        .expect("secrets object present");
    let err = secrets
        .get("error")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    assert!(
        err.contains("denied"),
        "expected error message to mention denied, got {err:?}"
    );
    Ok(())
}

#[tokio::test]
#[serial]
async fn ui_proxy_capability_denied() -> anyhow::Result<()> {
    let loader = ModuleLoader::new()?;

    let body_b64 = BASE64_STANDARD.encode(r#"{"ping":true}"#);
    let request = ExecuteRequest {
        context: ExecuteContext {
            request_id: Some("ui-proxy-denied".to_string()),
            tenant_id: "tenant-denied".to_string(),
            extension_id: "ext-denied".to_string(),
            install_id: Some("install-denied".to_string()),
            content_hash: "sha256:fixture".to_string(),
            version_id: Some("v1".to_string()),
            config: HashMap::new(),
        },
        http: HttpPayload {
            method: "POST".to_string(),
            path: "/dynamic/ui-proxy".to_string(),
            query: HashMap::new(),
            headers: HashMap::new(),
            body_b64: Some(body_b64),
        },
        limits: Limits {
            timeout_ms: Some(5_000),
            memory_mb: Some(64),
            fuel: None,
        },
        secret_envelope: None,
        providers: Vec::new(),
    };

    let providers: HashSet<String> = providers::default_capabilities()
        .into_iter()
        .map(|cap| cap.to_string())
        .collect();

    let host_ctx = HostExecutionContext {
        request_id: request.context.request_id.clone(),
        tenant_id: Some(request.context.tenant_id.clone()),
        extension_id: Some(request.context.extension_id.clone()),
        install_id: request.context.install_id.clone(),
        version_id: request.context.version_id.clone(),
        config: request.context.config.clone(),
        providers,
        secrets: None,
    };

    let response = loader
        .execute_handler(
            DYNAMIC_COMPONENT_WASM,
            request.limits.timeout_ms,
            request.limits.memory_mb,
            &request,
            host_ctx,
        )
        .await?;

    assert_eq!(response.status, 200);
    let body_json = decode_body(response.body_b64.as_ref().expect("body_b64 present"))?;
    assert_eq!(body_json.get("ok").and_then(|v| v.as_bool()), Some(false));
    let proxy = body_json
        .get("proxy")
        .and_then(|v| v.as_object())
        .expect("proxy object present");
    let err = proxy
        .get("error")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    assert!(
        err.contains("denied"),
        "expected proxy error to mention denied, got {err:?}"
    );
    Ok(())
}

#[derive(Clone)]
struct ProxyServerState {
    tenant: String,
    extension: String,
    auth: String,
}

async fn proxy_handler(
    State(state): State<Arc<ProxyServerState>>,
    Path((extension, route)): Path<(String, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    assert_eq!(extension, state.extension);
    assert_eq!(route, "proxy/ping");
    assert_eq!(
        headers
            .get("x-alga-tenant")
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default(),
        state.tenant
    );
    assert_eq!(
        headers
            .get("x-alga-extension")
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default(),
        state.extension
    );
    assert_eq!(
        headers
            .get("x-runner-auth")
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default(),
        state.auth
    );
    assert_eq!(
        headers
            .get("x-request-id")
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default(),
        "ui-proxy-ok"
    );
    assert_eq!(
        headers
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default(),
        "application/json"
    );
    let body_text = String::from_utf8(body.to_vec()).expect("ui proxy body utf8");
    let body_json: serde_json::Value =
        serde_json::from_str(&body_text).expect("ui proxy body json parse");
    assert_eq!(
        body_json.get("limit").and_then(|v| v.as_u64()),
        Some(5),
        "expected limit from proxy payload"
    );

    (
        StatusCode::OK,
        Json(serde_json::json!({
            "ok": true,
            "route": route,
            "tenant": state.tenant,
        })),
    )
}

#[tokio::test]
#[serial]
async fn ui_proxy_forwards_request() -> anyhow::Result<()> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let addr: SocketAddr = listener.local_addr()?;

    let state = Arc::new(ProxyServerState {
        tenant: "tenant-ok".to_string(),
        extension: "ext-ok".to_string(),
        auth: "proxy-secret".to_string(),
    });

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let router = Router::new()
        .route("/api/ui-proxy/:extension/*route", post(proxy_handler))
        .with_state(state.clone());

    let server = tokio::spawn(async move {
        axum::serve(listener, router)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await
            .unwrap();
    });

    let base_url = format!("http://127.0.0.1:{}/api/ui-proxy", addr.port());
    let _env = EnvGuard::set(&[
        ("UI_PROXY_BASE_URL", base_url.as_str()),
        ("UI_PROXY_AUTH_KEY", state.auth.as_str()),
        ("UI_PROXY_TIMEOUT_MS", "2000"),
    ]);

    let loader = ModuleLoader::new()?;

    let body_b64 = BASE64_STANDARD.encode(r#"{"limit":5}"#);
    let request = ExecuteRequest {
        context: ExecuteContext {
            request_id: Some("ui-proxy-ok".to_string()),
            tenant_id: state.tenant.clone(),
            extension_id: state.extension.clone(),
            install_id: Some("install-ok".to_string()),
            content_hash: "sha256:fixture".to_string(),
            version_id: Some("v1".to_string()),
            config: HashMap::new(),
        },
        http: HttpPayload {
            method: "POST".to_string(),
            path: "/dynamic/ui-proxy".to_string(),
            query: HashMap::new(),
            headers: HashMap::new(),
            body_b64: Some(body_b64),
        },
        limits: Limits {
            timeout_ms: Some(1_000),
            memory_mb: Some(64),
            fuel: None,
        },
        secret_envelope: None,
        providers: Vec::new(),
    };

    let mut providers: HashSet<String> = providers::default_capabilities()
        .into_iter()
        .map(|cap| cap.to_string())
        .collect();
    providers.insert("cap:ui.proxy".to_string());

    let host_ctx = HostExecutionContext {
        request_id: request.context.request_id.clone(),
        tenant_id: Some(request.context.tenant_id.clone()),
        extension_id: Some(request.context.extension_id.clone()),
        install_id: request.context.install_id.clone(),
        version_id: request.context.version_id.clone(),
        config: request.context.config.clone(),
        providers,
        secrets: None,
    };

    let response = loader
        .execute_handler(
            DYNAMIC_COMPONENT_WASM,
            request.limits.timeout_ms,
            request.limits.memory_mb,
            &request,
            host_ctx,
        )
        .await?;

    assert_eq!(response.status, 200);
    let body_json = decode_body(response.body_b64.as_ref().expect("body_b64 present"))?;
    let ok_value = body_json.get("ok").and_then(|v| v.as_bool());
    assert_eq!(
        ok_value,
        Some(true),
        "ui proxy response payload: {:?}",
        body_json
    );
    let proxy = body_json
        .get("proxy")
        .and_then(|v| v.as_object())
        .expect("proxy object present");
    assert!(
        proxy.get("error").and_then(|v| v.as_str()).is_none(),
        "proxy error payload: {:?}",
        proxy
    );
    let response_bytes: Vec<u8> = proxy
        .get("response")
        .and_then(|v| v.as_array())
        .expect("proxy response array")
        .iter()
        .map(|v| v.as_u64().unwrap_or_default() as u8)
        .collect();
    let response_text = String::from_utf8(response_bytes)?;
    let response_json: serde_json::Value = serde_json::from_str(&response_text)?;
    assert_eq!(
        response_json.get("ok").and_then(|v| v.as_bool()),
        Some(true)
    );
    assert_eq!(
        response_json.get("route").and_then(|v| v.as_str()),
        Some("proxy/ping")
    );

    shutdown_tx.send(()).ok();
    server.await?;
    Ok(())
}

#[tokio::test]
#[serial]
async fn ui_proxy_route_not_found_without_backend() -> anyhow::Result<()> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let addr: SocketAddr = listener.local_addr()?;
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    let router = Router::new().route(
        "/api/ui-proxy/:extension/*route",
        post(|| async { StatusCode::NOT_FOUND }),
    );

    let server = tokio::spawn(async move {
        axum::serve(listener, router)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await
            .unwrap();
    });

    let base_url = format!("http://127.0.0.1:{}/api/ui-proxy", addr.port());
    let _env = EnvGuard::set(&[("UI_PROXY_BASE_URL", base_url.as_str())]);

    let loader = ModuleLoader::new()?;

    let body_b64 = BASE64_STANDARD.encode(r#"{"ping":true}"#);
    let request = ExecuteRequest {
        context: ExecuteContext {
            request_id: Some("ui-proxy-route".to_string()),
            tenant_id: "tenant-ok".to_string(),
            extension_id: "ext-ok".to_string(),
            install_id: Some("install-ok".to_string()),
            content_hash: "sha256:fixture".to_string(),
            version_id: Some("v1".to_string()),
            config: HashMap::new(),
        },
        http: HttpPayload {
            method: "POST".to_string(),
            path: "/dynamic/ui-proxy".to_string(),
            query: HashMap::new(),
            headers: HashMap::new(),
            body_b64: Some(body_b64),
        },
        limits: Limits {
            timeout_ms: Some(1_000),
            memory_mb: Some(64),
            fuel: None,
        },
        secret_envelope: None,
        providers: Vec::new(),
    };

    let mut providers: HashSet<String> = providers::default_capabilities()
        .into_iter()
        .map(|cap| cap.to_string())
        .collect();
    providers.insert("cap:ui.proxy".to_string());

    let host_ctx = HostExecutionContext {
        request_id: request.context.request_id.clone(),
        tenant_id: Some(request.context.tenant_id.clone()),
        extension_id: Some(request.context.extension_id.clone()),
        install_id: request.context.install_id.clone(),
        version_id: request.context.version_id.clone(),
        config: request.context.config.clone(),
        providers,
        secrets: None,
    };

    let response = loader
        .execute_handler(
            DYNAMIC_COMPONENT_WASM,
            request.limits.timeout_ms,
            request.limits.memory_mb,
            &request,
            host_ctx,
        )
        .await?;

    assert_eq!(response.status, 200);
    let body_json = decode_body(response.body_b64.as_ref().expect("body_b64 present"))?;
    assert_eq!(body_json.get("ok").and_then(|v| v.as_bool()), Some(false));
    let proxy = body_json
        .get("proxy")
        .and_then(|v| v.as_object())
        .expect("proxy object present");
    let err = proxy
        .get("error")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    assert!(
        err.contains("route"),
        "expected proxy error to mention missing route, got {err:?}"
    );
    shutdown_tx.send(()).ok();
    server.await?;
    Ok(())
}
