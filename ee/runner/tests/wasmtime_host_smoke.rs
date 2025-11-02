use std::collections::{HashMap, HashSet};

use alga_ext_runner::engine::loader::{HostExecutionContext, ModuleLoader};
use alga_ext_runner::models::{ExecuteContext, ExecuteRequest, HttpPayload, Limits};
use alga_ext_runner::providers;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;

const DYNAMIC_COMPONENT_WASM: &[u8] = include_bytes!("fixtures/dynamic_component/component.wasm");

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
