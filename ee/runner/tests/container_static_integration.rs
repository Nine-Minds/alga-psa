use axum::Router;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use rand::{distributions::Alphanumeric, Rng};
use reqwest::Client;
use serde_json::json;
use serial_test::serial;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tar::Builder;
use tokio::net::TcpListener;
use tokio::process::Command;
use tokio::task::JoinHandle;
use tokio::time::sleep;
use tower_http::services::ServeDir;
use zstd::stream::encode_all as zstd_encode_all;

const TENANT_ID: &str = "tenant-a";
const EXTENSION_ID: &str = "demo-ext";
const DYNAMIC_COMPONENT_WASM: &[u8] = include_bytes!("fixtures/dynamic_component/component.wasm");

fn verbose_enabled() -> bool {
    std::env::var("VERBOSE_TESTS").is_ok()
}

fn log(msg: impl AsRef<str>) {
    if verbose_enabled() {
        log_always(msg);
    }
}

fn log_always(msg: impl AsRef<str>) {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    eprintln!(
        "[container-static {:>6}.{:03}] {}",
        now.as_secs(),
        now.subsec_millis(),
        msg.as_ref()
    );
}

fn render_bytes(label: &str, data: &[u8], limit: usize) -> String {
    let text = String::from_utf8_lossy(data);
    if data.is_empty() {
        return format!("{label}: <empty>");
    }
    if verbose_enabled() || text.len() <= limit {
        return format!("{label} ({} bytes):\n{}", data.len(), text);
    }
    let head = &text[..limit.min(text.len())];
    let tail_start = text.len().saturating_sub(limit);
    let tail = &text[tail_start..];
    format!(
        "{label} ({} bytes, showing first/last {} chars):\n{}...\n[truncated]\n...{}",
        data.len(),
        limit,
        head,
        tail
    )
}

#[tokio::test(flavor = "multi_thread")]
#[serial]
async fn runner_container_serves_static_bundle() -> anyhow::Result<()> {
    log("starting runner_container_serves_static_bundle");
    if !docker_available().await {
        log("docker not available; skipping container integration test");
        return Ok(());
    }

    log("creating temporary bundle directory for static bundle test");
    let bundle_dir = tempfile::tempdir()?;
    log(&format!(
        "bundle tempdir created at {}",
        bundle_dir.path().display()
    ));
    let (bundle_hash, index_body) = write_bundle_artifact(bundle_dir.path())?;
    log(&format!(
        "bundle artifact ready with hash sha256:{bundle_hash} (index length: {} bytes)",
        index_body.len()
    ));

    let (bundle_server, bundle_port) = start_bundle_server(bundle_dir.path().to_path_buf()).await?;
    log(&format!("bundle server listening on port {bundle_port}"));

    let image_tag = format!("alga-runner-test:{}", unique_suffix());
    log(&format!("building docker image {image_tag}"));
    docker_build(&image_tag).await?;
    let _image_guard = ImageGuard::new(&image_tag);

    let host_port = allocate_port()?;
    let container_name = format!("alga-runner-container-{}", unique_suffix());
    let mut container_guard = None;

    let run_output = docker_run(
        &image_tag,
        &container_name,
        host_port,
        bundle_port,
        &bundle_hash,
    )
    .await?;
    container_guard = Some(ContainerGuard::new(&container_name));
    log(&format!(
        "container {container_name} started; host port {host_port}, raw output len {} bytes",
        run_output.len()
    ));

    log("waiting for container /healthz endpoint");
    wait_for_health(host_port).await?;
    log("health endpoint reachable");

    log("verifying static index content");
    verify_static_response(host_port, &bundle_hash, &index_body).await?;
    log("static response contains expected contents");

    if let Some(guard) = &container_guard {
        log("stopping container via guard");
        guard.stop().await;
    }
    bundle_server.abort();
    let _ = bundle_server.await;
    log("bundle server aborted and joined");
    log("runner_container_serves_static_bundle completed successfully");

    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
#[serial]
async fn runner_container_executes_dynamic_component() -> anyhow::Result<()> {
    log("starting runner_container_executes_dynamic_component");
    if !docker_available().await {
        log("docker not available; skipping dynamic component test");
        return Ok(());
    }

    log("creating temporary bundle directory for dynamic component");
    let bundle_dir = tempfile::tempdir()?;
    log(&format!(
        "dynamic component tempdir: {}",
        bundle_dir.path().display()
    ));
    let wasm_hash = write_dynamic_component_artifact(bundle_dir.path())?;
    log(&format!("dynamic component bundle hash sha256:{wasm_hash}"));

    let (bundle_server, bundle_port) = start_bundle_server(bundle_dir.path().to_path_buf()).await?;
    log(&format!(
        "dynamic component bundle server listening on port {bundle_port}"
    ));

    let image_tag = format!("alga-runner-test:{}", unique_suffix());
    log(&format!(
        "building docker image {image_tag} for dynamic component test"
    ));
    docker_build(&image_tag).await?;
    let _image_guard = ImageGuard::new(&image_tag);

    let host_port = allocate_port()?;
    let container_name = format!("alga-runner-container-{}", unique_suffix());
    let mut container_guard = None;

    let run_output = docker_run(
        &image_tag,
        &container_name,
        host_port,
        bundle_port,
        &wasm_hash,
    )
    .await?;
    container_guard = Some(ContainerGuard::new(&container_name));
    log(&format!(
        "dynamic component container {container_name} started on host port {host_port} (stdout len {} bytes)",
        run_output.len()
    ));

    log("waiting for dynamic component container /healthz");
    wait_for_health(host_port).await?;
    log("dynamic component health ready");

    log("verifying dynamic component execution");
    if let Err(err) = verify_dynamic_execution(host_port, &wasm_hash).await {
        log_always(&format!(
            "dynamic component execution failed: {err:?}; dumping container logs"
        ));
        dump_container_logs(&container_name).await?;
        dump_docker_state().await?;
        return Err(err);
    }
    log("dynamic component execution verified");

    if let Some(guard) = &container_guard {
        log("stopping dynamic component container via guard");
        guard.stop().await;
    }
    bundle_server.abort();
    let _ = bundle_server.await;
    log("dynamic component bundle server aborted and joined");
    log("runner_container_executes_dynamic_component completed successfully");

    Ok(())
}

fn unique_suffix() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let rand: String = rand::thread_rng()
        .sample_iter(rand::distributions::Alphanumeric)
        .take(6)
        .map(char::from)
        .collect();
    format!("{now}{rand}")
}

async fn docker_available() -> bool {
    match Command::new("docker")
        .arg("version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
    {
        Ok(status) => {
            log(&format!("docker version status: {status}"));
            status.success()
        }
        Err(err) => {
            log(&format!("failed to invoke docker: {err}"));
            false
        }
    }
}

async fn docker_build(image_tag: &str) -> anyhow::Result<()> {
    log(&format!("docker_build start for {image_tag}"));
    let mut cmd = Command::new("docker");
    cmd.arg("build")
        .arg("-t")
        .arg(image_tag)
        .arg("-f")
        .arg("Dockerfile")
        .arg(".")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let output = cmd.output().await?;
    log(&format!(
        "docker_build completed for {image_tag} (status: {}, stdout: {} bytes, stderr: {} bytes)",
        output.status,
        output.stdout.len(),
        output.stderr.len()
    ));
    ensure_success(&output, "docker build")?;
    Ok(())
}

async fn docker_run(
    image_tag: &str,
    container_name: &str,
    host_port: u16,
    bundle_port: u16,
    bundle_hash: &str,
) -> anyhow::Result<String> {
    let bundle_base = format!("http://host.docker.internal:{bundle_port}/");
    let mut cmd = Command::new("docker");
    cmd.arg("run")
        .arg("-d")
        .arg("--rm")
        .arg("--name")
        .arg(container_name)
        .arg("--add-host")
        .arg("host.docker.internal:host-gateway")
        .arg("--add-host")
        .arg("host.testcontainers.internal:host-gateway")
        .arg("-p")
        .arg(format!("{host_port}:8080"))
        .arg("-e")
        .arg("ALGA_AUTH_KEY=test-key")
        .arg("-e")
        .arg("EXT_STATIC_STRICT_VALIDATION=false")
        .arg("-e")
        .arg("REGISTRY_BASE_URL=http://localhost:9001")
        .arg("-e")
        .arg(format!(
            "RUST_LOG={}",
            std::env::var("RUNNER_CONTAINER_RUST_LOG").unwrap_or_else(|_| "info".to_string())
        ))
        .arg("-e")
        .arg("WASMTIME_BACKTRACE_DETAILS=1")
        .arg("-e")
        .arg(format!("BUNDLE_STORE_BASE={bundle_base}"))
        .arg(image_tag)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    log(&format!(
        "docker_run start: image={image_tag}, container={container_name}, host_port={host_port}, bundle_port={bundle_port}"
    ));
    let output = cmd.output().await?;
    log(&format!(
        "docker_run completed (status: {}, stdout: {} bytes, stderr: {} bytes)",
        output.status,
        output.stdout.len(),
        output.stderr.len()
    ));
    ensure_success(&output, "docker run")?;
    let id = String::from_utf8_lossy(&output.stdout).trim().to_string();
    tracing::info!(container_id=%id, bundle_hash=%bundle_hash, "started runner container");
    log(&format!("docker_run spawned container id: {id}"));
    Ok(id)
}

async fn wait_for_health(port: u16) -> anyhow::Result<()> {
    let client = Client::builder().timeout(Duration::from_secs(3)).build()?;
    let health_url = format!("http://127.0.0.1:{port}/healthz");
    let deadline = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        + Duration::from_secs(30);
    log(&format!(
        "wait_for_health polling {health_url} with 30s deadline"
    ));
    let mut attempts = 0usize;
    loop {
        attempts += 1;
        match client.get(&health_url).send().await {
            Ok(resp) if resp.status().is_success() => {
                log(&format!("wait_for_health succeeded on attempt {attempts}"));
                return Ok(());
            }
            Ok(resp) => {
                log(&format!(
                    "wait_for_health attempt {attempts} received status {}",
                    resp.status()
                ));
            }
            Err(err) => {
                log(&format!("wait_for_health attempt {attempts} error: {err}"));
            }
        }
        if SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            >= deadline
        {
            anyhow::bail!("runner container did not become healthy in time");
        }
        if attempts % 10 == 0 {
            log(&format!(
                "wait_for_health still waiting after {attempts} attempts"
            ));
        }
        sleep(Duration::from_millis(200)).await;
    }
}

async fn verify_static_response(
    port: u16,
    bundle_hash: &str,
    expected_body: &str,
) -> anyhow::Result<()> {
    let client = Client::builder().timeout(Duration::from_secs(5)).build()?;
    let url = format!(
        "http://127.0.0.1:{}/ext-ui/{}/sha256:{}/index.html",
        port, EXTENSION_ID, bundle_hash
    );
    log(&format!("verify_static_response requesting {url}"));
    let resp = client
        .get(url)
        .header("x-tenant-id", TENANT_ID)
        .header("x-request-id", "container-test")
        .send()
        .await?;
    if !resp.status().is_success() {
        log(&format!(
            "verify_static_response non-success status: {}",
            resp.status()
        ));
        anyhow::bail!("unexpected status from runner: {}", resp.status());
    }
    let body = resp.text().await?;
    log(&format!(
        "verify_static_response body length: {}, preview: {}",
        body.len(),
        body.chars().take(100).collect::<String>()
    ));
    assert!(
        body.contains(expected_body),
        "runner response missing expected bundle contents"
    );
    Ok(())
}

async fn verify_dynamic_execution(port: u16, wasm_hash: &str) -> anyhow::Result<()> {
    // Give the runner ample time to compile the wasm component on the first request.
    let client = Client::builder().timeout(Duration::from_secs(20)).build()?;
    let url = format!("http://127.0.0.1:{}/v1/execute", port);
    log(&format!(
        "verify_dynamic_execution posting to {url} for hash sha256:{wasm_hash}"
    ));
    let raw_payload = br#"{\"ping\":true}"#;
    let body_b64 = BASE64_STANDARD.encode(raw_payload);
    let request_json = json!({
        "context": {
            "request_id": "container-dynamic",
            "tenant_id": TENANT_ID,
            "extension_id": EXTENSION_ID,
            "content_hash": format!("sha256:{}", wasm_hash),
            "config": {}
        },
        "http": {
            "method": "POST",
            "path": "/dynamic/echo",
            "query": { "foo": "bar" },
            "headers": {
                "content-type": "application/json"
            },
            "body_b64": body_b64
        },
        "limits": {
            "timeout_ms": 5000
        },
        "providers": [
            "cap:context.read",
            "cap:log.emit"
        ]
    });
    log(&format!(
        "verify_dynamic_execution payload prepared ({} bytes)",
        request_json.to_string().len()
    ));

    let resp = client
        .post(url)
        .header("x-request-id", "container-dynamic-test")
        .header("x-alga-tenant", TENANT_ID)
        .header("x-alga-extension", EXTENSION_ID)
        .json(&request_json)
        .send()
        .await?;

    if !resp.status().is_success() {
        log(&format!(
            "verify_dynamic_execution non-success status: {}",
            resp.status()
        ));
        anyhow::bail!("unexpected status from runner execute: {}", resp.status());
    }

    let payload: serde_json::Value = resp.json().await?;
    log(&format!(
        "verify_dynamic_execution response payload: {}",
        payload
    ));
    let status = payload
        .get("status")
        .and_then(|v| v.as_u64())
        .unwrap_or_default();
    if status != 200 {
        anyhow::bail!("runner execute returned non-200 status: {status}, payload: {payload}");
    }

    let headers = payload
        .get("headers")
        .and_then(|h| h.as_object())
        .expect("headers map present");
    assert_eq!(
        headers.get("content-type").and_then(|v| v.as_str()),
        Some("application/json"),
        "component response missing content-type header"
    );
    assert_eq!(
        headers.get("x-generated-by").and_then(|v| v.as_str()),
        Some("js-component"),
        "component response missing x-generated-by header"
    );

    let body_b64 = payload
        .get("body_b64")
        .and_then(|b| b.as_str())
        .expect("body_b64 present");
    let body_bytes = BASE64_STANDARD
        .decode(body_b64)
        .expect("body base64 decoded");
    let body_json: serde_json::Value = serde_json::from_slice(&body_bytes)?;

    assert_eq!(body_json.get("ok").and_then(|v| v.as_bool()), Some(true));
    assert_eq!(
        body_json.get("tenantId").and_then(|v| v.as_str()),
        Some(TENANT_ID)
    );
    assert_eq!(
        body_json.get("extensionId").and_then(|v| v.as_str()),
        Some(EXTENSION_ID)
    );
    assert_eq!(
        body_json.get("method").and_then(|v| v.as_str()),
        Some("POST")
    );
    assert_eq!(
        body_json.get("path").and_then(|v| v.as_str()),
        Some("/dynamic/echo?foo=bar")
    );

    let expected_echo = raw_payload.as_slice();
    let actual_echo: Vec<u8> = body_json
        .get("echo")
        .and_then(|v| v.as_array())
        .expect("echo array present")
        .iter()
        .map(|v| v.as_u64().unwrap_or_default() as u8)
        .collect();
    assert_eq!(actual_echo, expected_echo, "echo payload mismatch");

    log("verify_dynamic_execution succeeded");
    Ok(())
}

async fn dump_container_logs(container_name: &str) -> anyhow::Result<()> {
    log_always(&format!("fetching logs for container {container_name}"));
    let output = Command::new("docker")
        .arg("logs")
        .arg(container_name)
        .output()
        .await?;
    log_always(render_bytes("docker logs stdout", &output.stdout, 4000));
    if !output.stderr.is_empty() {
        log_always(render_bytes("docker logs stderr", &output.stderr, 1000));
    }
    Ok(())
}

async fn dump_docker_state() -> anyhow::Result<()> {
    let ps = Command::new("docker").arg("ps").arg("-a").output().await?;
    log_always(render_bytes("docker ps -a", &ps.stdout, 1000));
    if !ps.stderr.is_empty() {
        log_always(render_bytes("docker ps -a stderr", &ps.stderr, 500));
    }
    Ok(())
}

fn write_bundle_artifact(root: &Path) -> anyhow::Result<(String, String)> {
    log(&format!(
        "write_bundle_artifact into root {}",
        root.display()
    ));
    let (bundle, hash, index_body) = make_bundle_tarzst();
    let target = root.join(format!(
        "tenants/{}/extensions/{}/sha256/{}/bundle.tar.zst",
        TENANT_ID, EXTENSION_ID, hash
    ));
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&target, &bundle)?;
    log(&format!(
        "bundle artifact written to {} ({} bytes)",
        target.display(),
        bundle.len()
    ));
    Ok((hash, index_body))
}

fn write_dynamic_component_artifact(root: &Path) -> anyhow::Result<String> {
    use sha2::{Digest, Sha256};

    log(&format!(
        "write_dynamic_component_artifact into {}",
        root.display()
    ));

    let mut raw_tar: Vec<u8> = Vec::new();
    {
        let mut tar = Builder::new(&mut raw_tar);

        let mut hdr = tar::Header::new_gnu();
        hdr.set_size(DYNAMIC_COMPONENT_WASM.len() as u64);
        hdr.set_mode(0o644);
        hdr.set_cksum();
        tar.append_data(&mut hdr, "dist/main.wasm", DYNAMIC_COMPONENT_WASM)?;

        tar.finish()?;
    }

    let tarzst = zstd_encode_all(&raw_tar[..], 0)?;
    let mut hasher = Sha256::new();
    hasher.update(&tarzst);
    let hex = hex::encode(hasher.finalize());

    let target = root.join(format!(
        "tenants/{}/extensions/{}/sha256/{}/bundle.tar.zst",
        TENANT_ID, EXTENSION_ID, hex
    ));
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&target, &tarzst)?;

    log(&format!(
        "dynamic component bundle written to {} ({} bytes, hash sha256:{hex})",
        target.display(),
        tarzst.len()
    ));

    Ok(hex)
}

fn make_bundle_tarzst() -> (Vec<u8>, String, String) {
    log("make_bundle_tarzst generating bundle tarball");
    let mut raw_tar: Vec<u8> = Vec::new();
    let index_body =
        "<!doctype html><html><head><meta charset=\"utf-8\" /></head><body>Hello Container UI</body></html>";
    {
        let mut tar = Builder::new(&mut raw_tar);

        let mut hdr = tar::Header::new_gnu();
        hdr.set_size(index_body.as_bytes().len() as u64);
        hdr.set_mode(0o644);
        hdr.set_cksum();
        tar.append_data(&mut hdr, "ui/index.html", &index_body.as_bytes()[..])
            .unwrap();

        let mut hdr2 = tar::Header::new_gnu();
        let js = b"console.log('hello from container');";
        hdr2.set_size(js.len() as u64);
        hdr2.set_mode(0o644);
        hdr2.set_cksum();
        tar.append_data(&mut hdr2, "ui/assets/app.js", &js[..])
            .unwrap();

        tar.finish().unwrap();
    }

    let tarzst = zstd_encode_all(&raw_tar[..], 0).unwrap();
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(&tarzst);
    let hex = hex::encode(hasher.finalize());
    log(&format!(
        "make_bundle_tarzst produced raw tar {} bytes, compressed {} bytes, hash {hex}",
        raw_tar.len(),
        tarzst.len()
    ));
    (tarzst, hex, index_body.to_string())
}

async fn start_bundle_server(root: PathBuf) -> anyhow::Result<(JoinHandle<()>, u16)> {
    log(&format!(
        "start_bundle_server binding with root {}",
        root.display()
    ));
    let service = ServeDir::new(root);
    let app = Router::new().nest_service("/", service);
    // Bind to 0.0.0.0 so that the dockerized runner can reach the bundle server
    // via host.docker.internal. Binding to 127.0.0.1 would confine the listener
    // to loopback only, causing connection refusals from the container.
    let listener = TcpListener::bind(("0.0.0.0", 0)).await?;
    let port = listener.local_addr()?.port();
    let handle = tokio::spawn(async move {
        if let Err(err) = axum::serve(listener, app).await {
            eprintln!("bundle server error: {err}");
        }
    });
    log(&format!("start_bundle_server spawned on port {port}"));
    Ok((handle, port))
}

fn ensure_success(output: &std::process::Output, context: &str) -> anyhow::Result<()> {
    if output.status.success() {
        log(&format!(
            "{context} succeeded with status {}",
            output.status
        ));
        Ok(())
    } else {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        log(&format!(
            "{context} failed (status {}), stdout len {}, stderr len {}",
            output.status,
            stdout.len(),
            stderr.len()
        ));
        anyhow::bail!("{context} failed\nstdout:\n{}\nstderr:\n{}", stdout, stderr);
    }
}

fn allocate_port() -> anyhow::Result<u16> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    log(&format!("allocate_port reserved port {port}"));
    Ok(port)
}

struct ContainerGuard {
    name: String,
}

impl ContainerGuard {
    fn new(name: &str) -> Self {
        log(&format!("ContainerGuard created for {name}"));
        Self {
            name: name.to_string(),
        }
    }

    async fn stop(&self) {
        log(&format!("ContainerGuard stopping {}", self.name));
        let _ = Command::new("docker")
            .arg("stop")
            .arg(&self.name)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await;
    }
}

impl Drop for ContainerGuard {
    fn drop(&mut self) {
        log(&format!(
            "ContainerGuard dropping; removing container {}",
            self.name
        ));
        let _ = std::process::Command::new("docker")
            .arg("rm")
            .arg("-f")
            .arg(&self.name)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

struct ImageGuard {
    tag: String,
}

impl ImageGuard {
    fn new(tag: &str) -> Self {
        log(&format!("ImageGuard created for {tag}"));
        Self {
            tag: tag.to_string(),
        }
    }
}

impl Drop for ImageGuard {
    fn drop(&mut self) {
        log(&format!("ImageGuard dropping; removing image {}", self.tag));
        let _ = std::process::Command::new("docker")
            .arg("rmi")
            .arg("-f")
            .arg(&self.tag)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}
