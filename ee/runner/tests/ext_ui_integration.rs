use axum::{
    body,
    body::Body,
    extract::State,
    http::{header, HeaderValue, Method, Request, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use bytes::Bytes;
use serde_json::json;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tar::Builder;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;
use tower::util::ServiceExt;
use url::Url;
use zstd::stream::encode_all as zstd_encode_all;

use alga_ext_runner::http::ext_ui::{handle_get, warmup, AppState as ExtState, WarmupReq};
use alga_ext_runner::registry::client::RegistryClient;
use alga_ext_runner::util::limits;
use serial_test::serial;

// Added imports
use alga_ext_runner::cache::fs as cache_fs;
use alga_ext_runner::engine::loader::verify_archive_sha256;
use alga_ext_runner::util::errors::IntegrityError;

struct AllowingRegistry;
#[async_trait::async_trait]
impl RegistryClient for AllowingRegistry {
    async fn validate_install(
        &self,
        _tenant_id: &str,
        _extension_id: &str,
        _content_hash: &str,
    ) -> anyhow::Result<bool> {
        Ok(true)
    }
}

struct DenyingRegistry;
#[async_trait::async_trait]
impl RegistryClient for DenyingRegistry {
    async fn validate_install(
        &self,
        _tenant_id: &str,
        _extension_id: &str,
        _content_hash: &str,
    ) -> anyhow::Result<bool> {
        Ok(false)
    }
}

fn make_bundle_tarzst() -> (Vec<u8>, String) {
    // Build a tar bundle in-memory, then zstd-compress to produce bundle.tar.zst
    let mut raw_tar: Vec<u8> = Vec::new();
    {
        let mut tar = Builder::new(&mut raw_tar);

        // index.html
        let mut hdr = tar::Header::new_gnu();
        let content = b"<!doctype html><html><head><meta charset=\"utf-8\" /></head><body>Hello UI</body></html>";
        hdr.set_size(content.len() as u64);
        hdr.set_mode(0o644);
        hdr.set_cksum();
        tar.append_data(&mut hdr, "ui/index.html", &content[..])
            .unwrap();

        // assets/app.js
        let mut hdr2 = tar::Header::new_gnu();
        let js = b"console.log('hello');";
        hdr2.set_size(js.len() as u64);
        hdr2.set_mode(0o644);
        hdr2.set_cksum();
        tar.append_data(&mut hdr2, "ui/assets/app.js", &js[..])
            .unwrap();

        tar.finish().unwrap();
    }

    // zstd-compress the tar bytes
    let tarzst = zstd_encode_all(&raw_tar[..], 0).unwrap();

    // Compute hex of resulting tar.zst bytes
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(&tarzst);
    let hex = hex::encode(hasher.finalize());
    (tarzst, hex)
}

async fn start_bundle_http_server(bytes: Vec<u8>) -> (Url, JoinHandle<()>) {
    // Serve at /sha256/:hex/bundle.tar.zst (hex extracted from request path but we ignore and always return same bytes)
    let app = Router::new().route(
        "/sha256/:hex/bundle.tar.zst",
        get({
            let blob = Bytes::from(bytes);
            move || {
                let b = blob.clone();
                async move {
                    let mut h = axum::http::HeaderMap::new();
                    h.insert(
                        header::CONTENT_TYPE,
                        HeaderValue::from_static("application/octet-stream"),
                    );
                    (StatusCode::OK, h, b).into_response()
                }
            }
        }),
    );

    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let addr = listener.local_addr().unwrap();
    let handle = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let base = Url::parse(&format!("http://{}/", addr)).unwrap();
    (base, handle)
}

fn make_test_state(
    cache_root: PathBuf,
    bundle_base: Url,
    strict: bool,
    registry: Arc<dyn RegistryClient + Send + Sync>,
) -> ExtState {
    // Control strict validation via env the handler reads
    std::env::set_var(
        "EXT_STATIC_STRICT_VALIDATION",
        if strict { "true" } else { "false" },
    );

    ExtState {
        registry,
        cache_root,
        bundle_store_base: bundle_base,
        max_file_bytes: limits::max_file_bytes_from_env(),
    }
}

fn router_for_state(state: ExtState) -> Router {
    Router::new()
        .route("/ext-ui/:extensionId/:contentHash/*path", get(handle_get))
        .route("/warmup", post(warmup))
        .with_state(state)
}

async fn request<R>(app: &Router, req: Request<Body>) -> axum::http::Response<Body>
where
    R: IntoResponse,
{
    app.clone().oneshot(req).await.unwrap()
}

#[tokio::test]
#[serial]
async fn cold_fetch_then_304() {
    // Arrange: server serving bundle
    let (buf, hex) = make_bundle_tarzst();
    let (base, _handle) = start_bundle_http_server(buf).await;

    // Temp cache root
    let tmpdir = tempfile::tempdir().unwrap();
    let cache_root = tmpdir.path().to_path_buf();

    let state = make_test_state(cache_root.clone(), base, false, Arc::new(AllowingRegistry));
    let app = router_for_state(state.clone());

    // Warmup
    let warm = Request::builder()
        .method(Method::POST)
        .uri("/warmup")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&WarmupReq {
                content_hash: format!("sha256:{}", hex),
            })
            .unwrap(),
        ))
        .unwrap();
    let warm_resp = request::<Json<serde_json::Value>>(&app, warm).await;
    assert_eq!(warm_resp.status(), StatusCode::OK);

    // GET index.html
    let get1 = Request::builder()
        .method(Method::GET)
        .uri(format!("/ext-ui/demo-ext/sha256:{}/index.html", hex))
        .header("x-tenant-id", "tenant-a")
        .body(Body::empty())
        .unwrap();

    let resp1 = app.clone().oneshot(get1).await.unwrap();
    assert_eq!(resp1.status(), StatusCode::OK);
    let etag = resp1
        .headers()
        .get(header::ETAG)
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    let ct = resp1
        .headers()
        .get(header::CONTENT_TYPE)
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    assert!(ct.starts_with("text/html"));
    let cache_control = resp1
        .headers()
        .get(header::CACHE_CONTROL)
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    assert!(cache_control.contains("immutable"));

    // Second request with If-None-Match should 304
    let get2 = Request::builder()
        .method(Method::GET)
        .uri(format!("/ext-ui/demo-ext/sha256:{}/index.html", hex))
        .header("x-tenant-id", "tenant-a")
        .header(header::IF_NONE_MATCH, etag)
        .body(Body::empty())
        .unwrap();
    let resp2 = app.clone().oneshot(get2).await.unwrap();
    assert_eq!(resp2.status(), StatusCode::NOT_MODIFIED);
}

#[tokio::test]
#[serial]
async fn strict_validation_denied_is_404() {
    // Arrange bundle server
    let (buf, hex) = make_bundle_tarzst();
    let (base, _handle) = start_bundle_http_server(buf).await;

    let tmpdir = tempfile::tempdir().unwrap();
    let cache_root = tmpdir.path().to_path_buf();

    // Strict true with DenyingRegistry
    let state = make_test_state(cache_root, base, true, Arc::new(DenyingRegistry));
    let app = router_for_state(state);

    let get = Request::builder()
        .method(Method::GET)
        .uri(format!("/ext-ui/demo-ext/sha256:{}/index.html", hex))
        .header("x-tenant-id", "tenant-a")
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(get).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
#[serial]
async fn traversal_is_rejected() {
    // Arrange server + state
    let (buf, hex) = make_bundle_tarzst();
    let (base, _handle) = start_bundle_http_server(buf).await;

    let tmpdir = tempfile::tempdir().unwrap();
    let cache_root = tmpdir.path().to_path_buf();
    let state = make_test_state(cache_root, base, false, Arc::new(AllowingRegistry));
    let app = router_for_state(state);

    let get = Request::builder()
        .method(Method::GET)
        .uri(format!("/ext-ui/demo-ext/sha256:{}/../secret.txt", hex))
        .header("x-tenant-id", "tenant-a")
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(get).await.unwrap();
    // Our sanitizer returns 400 for invalid path
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
#[serial]
async fn oversize_asset_returns_413() {
    // Arrange bundle with large file
    // Create a big asset under ui/assets/big.bin
    let mut raw_tar: Vec<u8> = Vec::new();
    {
        let mut tar = Builder::new(&mut raw_tar);
        // index.html small
        let mut hdr = tar::Header::new_gnu();
        let content = b"<html>ok</html>";
        hdr.set_size(content.len() as u64);
        hdr.set_mode(0o644);
        hdr.set_cksum();
        tar.append_data(&mut hdr, "ui/index.html", &content[..])
            .unwrap();
        // big file (use allowed extension so we don't fail sanitizer)
        let big = vec![0u8; 128 * 1024]; // 128KiB
        let mut hdr2 = tar::Header::new_gnu();
        hdr2.set_size(big.len() as u64);
        hdr2.set_mode(0o644);
        hdr2.set_cksum();
        tar.append_data(&mut hdr2, "ui/assets/big.png", &big[..])
            .unwrap();
        tar.finish().unwrap();
    }
    let tarzst = zstd_encode_all(&raw_tar[..], 0).unwrap();
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(&tarzst);
    let hex = hex::encode(hasher.finalize());
    let (base, _handle) = start_bundle_http_server(tarzst).await;

    let tmpdir = tempfile::tempdir().unwrap();
    let cache_root = tmpdir.path().to_path_buf();

    // Set max file bytes small
    std::env::set_var("EXT_STATIC_MAX_FILE_BYTES", "1024"); // 1KiB
    let state = ExtState {
        registry: Arc::new(AllowingRegistry),
        cache_root,
        bundle_store_base: base,
        max_file_bytes: limits::max_file_bytes_from_env(),
    };
    let app = router_for_state(state);

    // Warmup
    let warm = Request::builder()
        .method(Method::POST)
        .uri("/warmup")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            serde_json::to_vec(&WarmupReq {
                content_hash: format!("sha256:{}", hex),
            })
            .unwrap(),
        ))
        .unwrap();
    let warm_resp = app.clone().oneshot(warm).await.unwrap();
    assert_eq!(warm_resp.status(), StatusCode::OK);

    // Request the oversize asset
    let get = Request::builder()
        .method(Method::GET)
        .uri(format!("/ext-ui/demo-ext/sha256:{}/assets/big.png", hex))
        .header("x-tenant-id", "tenant-a")
        .body(Body::empty())
        .unwrap();
    let resp = app.clone().oneshot(get).await.unwrap();
    assert_eq!(resp.status(), StatusCode::PAYLOAD_TOO_LARGE);
}

// New tests for integrity and extraction failure

#[tokio::test]
#[serial]
async fn archive_hash_mismatch_returns_502() {
    // Make a good bundle and its correct hex
    let (good_bytes, good_hex) = make_bundle_tarzst();
    // Create bad bytes by flipping one byte
    let mut bad_bytes = good_bytes.clone();
    if let Some(b) = bad_bytes.get_mut(0) {
        *b ^= 0xFF;
    }
    let (base, _handle) = start_bundle_http_server(bad_bytes).await;

    let tmpdir = tempfile::tempdir().unwrap();
    let cache_root = tmpdir.path().to_path_buf();

    let state = make_test_state(cache_root, base, false, Arc::new(AllowingRegistry));
    let app = router_for_state(state);

    // Direct GET should trigger download+verify and fail with 502
    let req = Request::builder()
        .method(Method::GET)
        .uri(format!("/ext-ui/demo-ext/sha256:{}/index.html", good_hex))
        .header("x-tenant-id", "tenant-a")
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_GATEWAY);
    // Parse JSON error code
    let body_bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let v: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
    assert_eq!(
        v.get("code").and_then(|x| x.as_str()),
        Some("archive_hash_mismatch")
    );
}

#[tokio::test]
#[serial]
async fn partial_extract_cleanup_on_failure() {
    // Create bytes that hash to H but are not a valid tar.gz to force extraction error AFTER hash verification
    // We'll use random bytes; compute their hash and serve them.
    let bad_extraction_bytes: Vec<u8> = vec![0x1Fu8; 1024]; // not a valid gzip
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(&bad_extraction_bytes);
    let hex = hex::encode(hasher.finalize());

    let (base, _handle) = start_bundle_http_server(bad_extraction_bytes).await;

    let tmpdir = tempfile::tempdir().unwrap();
    let cache_root = tmpdir.path().to_path_buf();
    let state = make_test_state(cache_root.clone(), base, false, Arc::new(AllowingRegistry));
    let app = router_for_state(state);

    // Trigger GET (no warmup) to cause extraction attempt
    let req = Request::builder()
        .method(Method::GET)
        .uri(format!("/ext-ui/demo-ext/sha256:{}/index.html", hex))
        .header("x-tenant-id", "tenant-a")
        .body(Body::empty())
        .unwrap();

    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let body_bytes = axum::body::to_bytes(resp.into_body(), 1024 * 1024)
        .await
        .unwrap();
    if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&body_bytes) {
        assert_eq!(
            v.get("code").and_then(|x| x.as_str()),
            Some("extract_failed")
        );
    }
    // Ensure no residual cache subtree exists
    let ui_root = cache_fs::ui_cache_dir(&cache_root, &hex);
    assert!(
        !std::fs::metadata(&ui_root).is_ok(),
        "ui cache dir should not remain on failure"
    );
}

#[tokio::test]
#[serial]
async fn loader_verify_archive_sha256_unit() {
    // Prepare known bytes and its hex; serve via tiny server
    let bytes = b"unit-test-archive-contents".to_vec();
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let hex = hex::encode(hasher.finalize());

    let (base, _handle) = start_bundle_http_server(bytes.clone()).await;
    let url = base
        .join(&format!("sha256/{}/bundle.tar.zst", hex))
        .unwrap();

    // Success case
    let tmp = verify_archive_sha256(&url, &hex)
        .await
        .expect("verify should pass");
    assert!(std::fs::metadata(&tmp).is_ok());
    // Cleanup
    let _ = std::fs::remove_file(&tmp);

    // Mismatch case: use different expected hex
    let bad_url = base
        .join(&format!("sha256/{}/bundle.tar.zst", "deadbeef"))
        .unwrap();
    let err = verify_archive_sha256(&bad_url, "deadbeef")
        .await
        .unwrap_err();
    let ie = err
        .downcast_ref::<IntegrityError>()
        .expect("should be IntegrityError");
    match ie {
        IntegrityError::ArchiveHashMismatch {
            expected_hex,
            computed_hex,
        } => {
            assert_eq!(expected_hex, "deadbeef");
            assert_ne!(computed_hex, expected_hex);
        }
    }
}
