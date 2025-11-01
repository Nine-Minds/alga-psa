use axum::Router;
use rand::{distributions::Alphanumeric, Rng};
use reqwest::Client;
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

#[tokio::test(flavor = "multi_thread")]
#[serial]
async fn runner_container_serves_static_bundle() -> anyhow::Result<()> {
    if !docker_available().await {
        eprintln!("docker not available; skipping container integration test");
        return Ok(());
    }

    let bundle_dir = tempfile::tempdir()?;
    let (bundle_hash, index_body) = write_bundle_artifact(bundle_dir.path())?;

    let (bundle_server, bundle_port) = start_bundle_server(bundle_dir.path().to_path_buf()).await?;

    let image_tag = format!("alga-runner-test:{}", unique_suffix());
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

    wait_for_health(host_port).await?;
    verify_static_response(host_port, &bundle_hash, &index_body).await?;

    if let Some(guard) = &container_guard {
        guard.stop().await;
    }
    bundle_server.abort();
    let _ = bundle_server.await;

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
        Ok(status) => status.success(),
        Err(_) => false,
    }
}

async fn docker_build(image_tag: &str) -> anyhow::Result<()> {
    let mut cmd = Command::new("docker");
    cmd.arg("build")
        .arg("-t")
        .arg(image_tag)
        .arg("-f")
        .arg("ee/runner/Dockerfile")
        .arg("ee/runner")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let output = cmd.output().await?;
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
        .arg(format!("BUNDLE_STORE_BASE={bundle_base}"))
        .arg(image_tag)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = cmd.output().await?;
    ensure_success(&output, "docker run")?;
    let id = String::from_utf8_lossy(&output.stdout).trim().to_string();
    tracing::info!(container_id=%id, bundle_hash=%bundle_hash, "started runner container");
    Ok(id)
}

async fn wait_for_health(port: u16) -> anyhow::Result<()> {
    let client = Client::builder().timeout(Duration::from_secs(3)).build()?;
    let health_url = format!("http://127.0.0.1:{port}/healthz");
    let deadline = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        + Duration::from_secs(30);
    loop {
        match client.get(&health_url).send().await {
            Ok(resp) if resp.status().is_success() => return Ok(()),
            Ok(_) | Err(_) => {
                if SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    >= deadline
                {
                    anyhow::bail!("runner container did not become healthy in time");
                }
                sleep(Duration::from_millis(200)).await;
            }
        }
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
    let resp = client
        .get(url)
        .header("x-tenant-id", TENANT_ID)
        .header("x-request-id", "container-test")
        .send()
        .await?;
    if !resp.status().is_success() {
        anyhow::bail!("unexpected status from runner: {}", resp.status());
    }
    let body = resp.text().await?;
    assert!(
        body.contains(expected_body),
        "runner response missing expected bundle contents"
    );
    Ok(())
}

fn write_bundle_artifact(root: &Path) -> anyhow::Result<(String, String)> {
    let (bundle, hash, index_body) = make_bundle_tarzst();
    let target = root.join(format!(
        "tenants/{}/extensions/{}/sha256/{}/bundle.tar.zst",
        TENANT_ID, EXTENSION_ID, hash
    ));
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&target, &bundle)?;
    Ok((hash, index_body))
}

fn make_bundle_tarzst() -> (Vec<u8>, String, String) {
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
    (tarzst, hex, index_body.to_string())
}

async fn start_bundle_server(root: PathBuf) -> anyhow::Result<(JoinHandle<()>, u16)> {
    let service = ServeDir::new(root);
    let app = Router::new().nest_service("/", service);
    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let port = listener.local_addr()?.port();
    let handle = tokio::spawn(async move {
        if let Err(err) = axum::serve(listener, app).await {
            eprintln!("bundle server error: {err}");
        }
    });
    Ok((handle, port))
}

fn ensure_success(output: &std::process::Output, context: &str) -> anyhow::Result<()> {
    if output.status.success() {
        Ok(())
    } else {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("{context} failed\nstdout:\n{}\nstderr:\n{}", stdout, stderr);
    }
}

fn allocate_port() -> anyhow::Result<u16> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

struct ContainerGuard {
    name: String,
}

impl ContainerGuard {
    fn new(name: &str) -> Self {
        Self {
            name: name.to_string(),
        }
    }

    async fn stop(&self) {
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
        Self {
            tag: tag.to_string(),
        }
    }
}

impl Drop for ImageGuard {
    fn drop(&mut self) {
        let _ = std::process::Command::new("docker")
            .arg("rmi")
            .arg("-f")
            .arg(&self.tag)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}
