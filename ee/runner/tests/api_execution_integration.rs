use alga_ext_runner::models::{ExecuteContext, ExecuteRequest, HttpPayload, Limits};
use reqwest::Client;
use std::collections::HashMap;
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

/// Helper to start the runner server in a background task.
/// Returns the base URL of the runner and a shutdown handle.
async fn start_runner_server() -> anyhow::Result<(String, JoinHandle<()>)> {
    // Pick a random port for the runner
    let port = {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let addr = listener.local_addr()?;
        addr.port()
    }; // Listener is dropped here, freeing the port

    // Set necessary environment variables for the runner configuration
    // In a real test, we would likely mock the registry and bundle store too.
    unsafe {
        std::env::set_var("PORT", port.to_string());
        std::env::set_var("REGISTRY_BASE_URL", "http://127.0.0.1:9999"); // Dummy
        std::env::set_var("BUNDLE_STORE_BASE", "http://127.0.0.1:9998"); // Dummy
        std::env::set_var("ALGA_AUTH_KEY", "test-key");
        std::env::set_var("EXT_CACHE_ROOT", std::env::temp_dir().join("alga-runner-test"));
        // Disable strict validation if needed, or just let it fail later
    }

    // Spawn the runner
    let handle = tokio::spawn(async move {
        if let Err(e) = alga_ext_runner::http::server::run().await {
            eprintln!("Runner server exited with error: {}", e);
        }
    });

    // Give it a moment to start listening
    let client = Client::builder()
        .timeout(Duration::from_secs(1))
        .build()?;
    let base_url = format!("http://127.0.0.1:{}", port);
    
    let start = std::time::Instant::now();
    loop {
        if handle.is_finished() {
            anyhow::bail!("Runner server task exited prematurely");
        }
        if start.elapsed() > Duration::from_secs(10) {
            anyhow::bail!("Runner failed to start within 10 seconds");
        }
        // We check healthz. It might return 503 if dependencies (registry) are unreachable, 
        // but that proves the HTTP server is UP.
        match client.get(format!("{}/healthz", base_url)).send().await {
            Ok(resp) => {
                // 503 is expected since we have dummy dependencies
                if resp.status().is_success() || resp.status() == reqwest::StatusCode::SERVICE_UNAVAILABLE {
                    break;
                }
            }
            Err(_) => tokio::time::sleep(Duration::from_millis(100)).await,
        }
    }

    Ok((base_url, handle))
}

#[tokio::test]
async fn test_execute_endpoint_structure() -> anyhow::Result<()> {
    let (base_url, _server_handle) = start_runner_server().await?;
    let client = Client::new();

    let req_body = ExecuteRequest {
        context: ExecuteContext {
            request_id: Some("api-test".to_string()),
            tenant_id: "tenant-1".to_string(),
            extension_id: "ext-1".to_string(),
            install_id: Some("inst-1".to_string()),
            content_hash: "sha256:dummy".to_string(),
            version_id: Some("v1".to_string()),
            config: HashMap::new(),
        },
        http: HttpPayload {
            method: "POST".to_string(),
            path: "/foo".to_string(),
            query: HashMap::new(),
            headers: HashMap::new(),
            body_b64: None,
        },
        limits: Limits::default(),
        secret_envelope: None,
        providers: vec![],
    };

    let resp = client.post(format!("{}/v1/execute", base_url))
        .header("x-request-id", "req-123")
        .header("x-alga-tenant", "tenant-1")
        .header("x-alga-extension", "ext-1")
        .json(&req_body)
        .send()
        .await?;
    
    let status = resp.status();
    println!("Runner response status: {}", status);
    
    // Since our "registry" is 127.0.0.1:9999 (which likely doesn't exist), 
    // the runner should fail inside `execute` when trying to fetch the bundle or init the engine.
    // But the *HTTP endpoint* should be reachable. 
    // It will likely return 500 or 502. 
    // Crucially, it should NOT be 404.
    assert!(status != reqwest::StatusCode::NOT_FOUND);
    
    if let Ok(body_text) = resp.text().await {
         println!("Runner response body: {}", body_text);
    }

    Ok(())
}