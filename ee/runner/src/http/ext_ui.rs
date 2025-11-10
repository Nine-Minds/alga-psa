use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use anyhow::Context;
use axum::{
    extract::{Path as AxPath, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::IntoResponse,
    Json,
};
use once_cell::sync::Lazy;
use serde::Deserialize;
use std::io::ErrorKind;
use std::io::Read;
use tar::Archive;
use tokio::fs;
use tokio::io::AsyncReadExt;
use tokio::sync::RwLock;
use tracing::info;
use url::Url;
use zstd::stream::read::Decoder as ZstdDecoder;

use crate::cache::fs as cache_fs;
use crate::engine::loader::{bundle_url_for_key, verify_archive_sha256};
use crate::registry::client::RegistryClient;
use crate::util::{
    errors::IntegrityError, etag::etag_for_file, mime::content_type_for, path_sanitize,
};
use reqwest::Client as HttpClient;

static TENANT_HINTS: Lazy<RwLock<HashMap<(String, String), String>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

#[derive(Clone)]
pub struct AppState {
    // Existing runner state (idempotency etc.) is defined in server.rs; this is a mirror of fields we need here.
    pub registry: Arc<dyn RegistryClient + Send + Sync>,
    pub cache_root: PathBuf,
    pub bundle_store_base: Url,
    pub max_file_bytes: Option<u64>,
}

#[derive(Deserialize)]
pub struct UiQuery {
    // SPA hydration supports ?path=/client-route; not used for file resolution, only passthrough.
    pub path: Option<String>,
    // Optional tenant id (provided by root dispatcher redirect)
    pub tenant: Option<String>,
}

#[derive(Deserialize, serde::Serialize)]
pub struct WarmupReq {
    pub content_hash: String,
}

#[axum::debug_handler]
/// GET /ext-ui/:extensionId/:contentHash/*path
/// Validates tenant/contentHash (when strict), ensures cache/extract, and serves file with ETag and immutable caching.
pub async fn handle_get(
    AxPath((extension_id, content_hash, path_tail)): AxPath<(String, String, String)>,
    Query(query): Query<UiQuery>,
    headers: HeaderMap,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let started = Instant::now();
    let req_id = headers
        .get("x-request-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let tenant_id = headers
        .get("x-tenant-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let host = headers
        .get(axum::http::header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    tracing::info!(
        request_id=%req_id,
        host=%host,
        extension=%extension_id,
        content_hash=%content_hash,
        has_tenant=%(!tenant_id.is_empty()),
        "ext_ui request start"
    );

    // Normalize content hash: require sha256:<hex> form
    let hash_hex = match normalize_hash(&content_hash) {
        Ok(h) => h,
        Err(e) => {
            tracing::warn!(request_id=%req_id, err=%e.to_string(), "bad content hash");
            return (StatusCode::BAD_REQUEST, "invalid content hash").into_response();
        }
    };

    // Strict validation behavior can be relaxed via EXT_STATIC_STRICT_VALIDATION=false
    let strict = std::env::var("EXT_STATIC_STRICT_VALIDATION")
        .map(|v| {
            let lower = v.to_ascii_lowercase();
            matches!(lower.as_str(), "1" | "true" | "yes")
        })
        .unwrap_or(true);

    // Resolve tenant via header or registry host lookup
    let mut tenant = query.tenant.clone().unwrap_or_else(|| tenant_id.clone());
    if tenant.is_empty() {
        if let Some(cached) = TENANT_HINTS
            .read()
            .await
            .get(&(extension_id.clone(), hash_hex.clone()))
            .cloned()
        {
            tenant = cached;
        }
    }
    if tenant.is_empty() {
        if let Ok(base) = std::env::var("REGISTRY_BASE_URL") {
            if let Ok(mut u) = Url::parse(&base) {
                u.set_path("api/installs/lookup-by-host");
                let now_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0);
                u.query_pairs_mut()
                    .append_pair("host", host.split(':').next().unwrap_or(""))
                    .append_pair("ts", &now_ms.to_string());
                if let Ok(http) = HttpClient::builder().build() {
                    let mut rb = http.get(u.clone());
                    if let Ok(k) = std::env::var("ALGA_AUTH_KEY") {
                        if !k.is_empty() {
                            rb = rb.header("x-api-key", k);
                        }
                    }
                    if let Ok(resp) = rb.send().await {
                        let code = resp.status().as_u16();
                        if code >= 200 && code < 300 {
                            match resp.text().await {
                                Ok(txt) => {
                                    tracing::info!(host=%host, status=%code, body_len=%txt.len(), body_sample=%txt.chars().take(200).collect::<String>(), "fallback lookup body");
                                    if let Ok(json) =
                                        serde_json::from_str::<serde_json::Value>(&txt)
                                    {
                                        if let Some(t) =
                                            json.get("tenant_id").and_then(|v| v.as_str())
                                        {
                                            tenant = t.to_string();
                                        }
                                    }
                                }
                                Err(e) => {
                                    tracing::warn!(err=%e.to_string(), "failed to read fallback lookup body");
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    if !tenant.is_empty() {
        TENANT_HINTS
            .write()
            .await
            .insert((extension_id.clone(), hash_hex.clone()), tenant.clone());
    }
    if strict && tenant.is_empty() {
        tracing::info!(request_id=%req_id, host=%host, "strict validation on and tenant resolution failed");
        return StatusCode::NOT_FOUND.into_response();
    }

    // Validate with registry (cached TTL)
    if strict {
        tracing::info!(request_id=%req_id, tenant=%tenant, extension=%extension_id, content_hash=%content_hash, "registry validation start");
        match state
            .registry
            .validate_install(&tenant, &extension_id, &content_hash)
            .await
        {
            Ok(true) => {}
            Ok(false) => {
                tracing::info!(request_id=%req_id, tenant=%tenant, extension=%extension_id, content_hash=%content_hash, "registry denied");
                return StatusCode::NOT_FOUND.into_response();
            }
            Err(e) => {
                tracing::warn!(request_id=%req_id, tenant=%tenant, extension=%extension_id, err=%e.to_string(), "registry error (strict)");
                return StatusCode::NOT_FOUND.into_response();
            }
        }
        tracing::info!(request_id=%req_id, tenant=%tenant, extension=%extension_id, "registry validation ok");
    } else {
        tracing::info!(request_id=%req_id, extension=%extension_id, "strict validation disabled; skipping registry check");
    }

    // Ensure UI cache is present (first touch may download+extract)
    let exists = cache_fs::exists_ui_index(&state.cache_root, &hash_hex);
    tracing::info!(request_id=%req_id, hash=%hash_hex, cache_index_exists=%exists, "ui cache check");
    if !exists {
        tracing::info!(request_id=%req_id, hash=%hash_hex, "ui cache ensure start");
        // Build tenant-local key for this bundle
        let obj_key = format!(
            "tenants/{}/extensions/{}/sha256/{}/bundle.tar.zst",
            tenant, extension_id, hash_hex
        );
        if let Err(e) = ensure_ui_cache(&state, &hash_hex, &obj_key).await {
            if let Some(IntegrityError::ArchiveHashMismatch {
                expected_hex,
                computed_hex,
            }) = e.downcast_ref::<IntegrityError>()
            {
                tracing::error!(
                    request_id=%req_id,
                    tenant=%tenant_id,
                    extension=%extension_id,
                    expected_hash=%expected_hex,
                    computed_hash=%computed_hex,
                    integrity_archive_sha256_ok=%false,
                    "archive hash mismatch on fetch"
                );
                let body = Json(serde_json::json!({ "code": "archive_hash_mismatch" }));
                return (StatusCode::BAD_GATEWAY, body).into_response();
            }
            tracing::error!(
                request_id=%req_id,
                tenant=%tenant_id,
                extension=%extension_id,
                hash=%hash_hex,
                err=%e.to_string(),
                integrity_archive_sha256_ok=%true,
                "ui cache ensure failed"
            );
            let body = Json(serde_json::json!({ "code": "extract_failed" }));
            return (StatusCode::INTERNAL_SERVER_ERROR, body).into_response();
        }
        tracing::info!(request_id=%req_id, hash=%hash_hex, "ui cache ensure ok");
    }

    // Sanitize the requested path; empty means root (index.html)
    let sanitized = match path_sanitize::sanitize(&path_tail) {
        Ok(p) => p,
        Err(_) => return (StatusCode::BAD_REQUEST, "invalid path").into_response(),
    };

    let ui_root = cache_fs::ui_cache_dir(&state.cache_root, &hash_hex);
    let mut file_path = ui_root.join(&sanitized);

    // If empty or path doesn't exist or is a directory, serve index.html (SPA fallback)
    let mut use_index = sanitized.as_os_str().is_empty();
    if !use_index {
        match fs::metadata(&file_path).await {
            Ok(meta) => {
                if meta.is_dir() {
                    use_index = true;
                }
            }
            Err(_) => {
                // Not found - SPA fallback
                use_index = true;
            }
        }
    }
    if use_index {
        file_path = ui_root.join("index.html");
    }

    // Existence + max size enforcement
    match fs::metadata(&file_path).await {
        Ok(meta) => {
            if let Some(max) = state.max_file_bytes {
                if meta.len() > max {
                    return (StatusCode::PAYLOAD_TOO_LARGE, "asset too large").into_response();
                }
            }
        }
        Err(e) => {
            return match e.kind() {
                ErrorKind::NotFound => StatusCode::NOT_FOUND.into_response(),
                _ => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
            };
        }
    }

    // Compute ETag and handle If-None-Match
    let etag = match etag_for_file(&file_path).await {
        Ok(s) => s,
        Err(_) => return StatusCode::INTERNAL_SERVER_ERROR.into_response(),
    };
    if let Some(inm) = headers
        .get(header::IF_NONE_MATCH)
        .and_then(|v| v.to_str().ok())
    {
        if etag_match(inm, &etag) {
            // 304 with caching headers and ETag
            let mut h = HeaderMap::new();
            h.insert(
                header::ETAG,
                HeaderValue::from_str(&etag).unwrap_or(HeaderValue::from_static("")),
            );
            h.insert(
                header::CACHE_CONTROL,
                HeaderValue::from_static("public, max-age=31536000, immutable"),
            );
            return (StatusCode::NOT_MODIFIED, h, ()).into_response();
        }
    }

    // Read file bytes and respond (using streaming would be better later)
    let data = match fs::read(&file_path).await {
        Ok(b) => b,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };
    let ct = content_type_for(&file_path);

    let mut h = HeaderMap::new();
    h.insert(header::CONTENT_TYPE, ct);
    if let Ok(len) = HeaderValue::from_str(&data.len().to_string()) {
        h.insert(header::CONTENT_LENGTH, len);
    }
    h.insert(
        header::ETAG,
        HeaderValue::from_str(&etag).unwrap_or(HeaderValue::from_static("")),
    );
    h.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=31536000, immutable"),
    );

    // Structured trace
    let dur_ms = started.elapsed().as_millis() as u64;
    let body_len = data.len();
    info!(
        request_id=%req_id,
        tenant=%tenant_id,
        extension=%extension_id,
        content_hash=%content_hash,
        file_path=%file_path.to_string_lossy(),
        status=200,
        duration_ms=%dur_ms,
        bytes=body_len,
        cache_status=%(if use_index { "spa-fallback" } else { "hit" }),
        "ext_ui serve"
    );

    (h, data).into_response()
}

/// POST /warmup { content_hash }
/// Ensures the UI cache for this bundle is extracted.
#[axum::debug_handler]
pub async fn warmup(_state: State<AppState>, Json(_req): Json<WarmupReq>) -> impl IntoResponse {
    // Warmup requires tenant + extension context for tenant-scoped bundles.
    (
        StatusCode::BAD_REQUEST,
        "warmup unsupported without tenant + extension context",
    )
        .into_response()
}

fn normalize_hash(content_hash: &str) -> anyhow::Result<String> {
    let hex = content_hash
        .strip_prefix("sha256:")
        .ok_or_else(|| anyhow::anyhow!("missing sha256: prefix"))?;
    if hex.is_empty() || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        anyhow::bail!("invalid sha256 hex");
    }
    Ok(hex.to_lowercase())
}

fn etag_match(inm_header: &str, etag: &str) -> bool {
    // Simple exact match against a possible list (comma separated ETags)
    inm_header
        .split(',')
        .map(|s| s.trim())
        .any(|candidate| candidate == "*" || candidate == etag)
}

/// Ensure the UI subtree is cached locally; performs first-touch download and extraction if missing.
async fn ensure_ui_cache(state: &AppState, hash_hex: &str, key: &str) -> anyhow::Result<()> {
    if cache_fs::exists_ui_index(&state.cache_root, hash_hex) {
        return Ok(());
    }

    let ui_root = cache_fs::ui_cache_dir(&state.cache_root, hash_hex);
    let tmp_dir = state.cache_root.join("tmp");
    cache_fs::ensure_dir(&tmp_dir).await?;
    cache_fs::ensure_dir(&ui_root).await?;

    // Build tenant-local URL from provided key and fetch+verify archive sha256 to temp file
    let url = bundle_url_for_key(&state.bundle_store_base, key)?;
    tracing::info!(hash=%hash_hex, url=%url.to_string(), "bundle fetch start");
    let tmp_tgz = verify_archive_sha256(&url, hash_hex).await?;

    // Extract ui/ subtree
    if let Err(e) = extract_ui_from_tar_gz(&tmp_tgz, &ui_root).await {
        // Best-effort cleanup of partial subtree
        let _ = fs::remove_dir_all(&ui_root).await;
        // Cleanup tmp archive as well
        let _ = fs::remove_file(&tmp_tgz).await;
        return Err(e);
    }
    tracing::info!(hash=%hash_hex, ui_root=%ui_root.to_string_lossy(), "bundle extract ok");

    // Optional quick sanity check: compute sha256 ETag for index.html
    let index_path = ui_root.join("index.html");
    if let Ok(etag) = etag_for_file(&index_path).await {
        // Log the computed hash for traceability
        tracing::info!(index_etag=%etag, hash=%hash_hex, "ui index etag computed after extraction");
    }

    // Cleanup verified temp archive
    let _ = fs::remove_file(&tmp_tgz).await;
    tracing::info!(hash=%hash_hex, "bundle fetch+extract done");

    Ok(())
}

fn rand_suffix() -> String {
    use rand::{distributions::Alphanumeric, Rng};
    let s: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(6)
        .map(char::from)
        .collect();
    s
}

/// Extract only files under "ui/" prefix from the tar.zst into ui_root, preserving directory structure.
/// Uses write_atomic for files and sets read-only perms.
/// Important: Do not hold non-Send tar iterators across .await points. Collect ops first, then perform async IO.
async fn extract_ui_from_tar_gz(tgz_path: &Path, ui_root: &Path) -> anyhow::Result<()> {
    // Read file into memory, then iterate tar synchronously
    let mut f = fs::File::open(tgz_path).await?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf).await?;
    let z = ZstdDecoder::new(&buf[..])?;
    let mut ar = Archive::new(z);

    // Collect operations to perform after iteration (so no non-Send borrows cross .await)
    enum Op {
        Mkdir(PathBuf),
        Write { path: PathBuf, contents: Vec<u8> },
    }
    let mut ops: Vec<Op> = Vec::new();

    let mut files = 0usize;
    let mut dirs = 0usize;
    for entry in ar.entries().context("tar entries")? {
        let mut entry = entry.context("tar entry")?;
        let path = entry.path().context("entry path")?;
        let mut pstr = path.to_string_lossy().to_string();
        if let Some(stripped) = pstr.strip_prefix("./") {
            pstr = stripped.to_string();
        }

        // Only extract under ui/
        if !pstr.starts_with("ui/") {
            continue;
        }

        // Normalize path (strip "ui/")
        let rel = &pstr["ui/".len()..];
        if rel.is_empty() {
            continue;
        }

        // Disallow hidden dot files or dirs in archive
        if rel.split('/').any(|seg| seg.starts_with('.')) {
            continue;
        }

        let out_path = ui_root.join(rel);

        if entry.header().entry_type().is_dir() {
            ops.push(Op::Mkdir(out_path));
            dirs += 1;
        } else if entry.header().entry_type().is_file() {
            if let Some(parent) = out_path.parent() {
                ops.push(Op::Mkdir(parent.to_path_buf()));
            }
            // Read entry contents fully (sync) and stage write
            let mut contents = Vec::with_capacity(16 * 1024);
            entry.read_to_end(&mut contents).context("read entry")?;
            ops.push(Op::Write {
                path: out_path,
                contents,
            });
            files += 1;
        } else {
            // Skip symlinks or other types for safety
            continue;
        }
    }

    // Perform async filesystem ops
    for op in ops {
        match op {
            Op::Mkdir(p) => {
                cache_fs::ensure_dir(&p).await?;
            }
            Op::Write { path, contents } => {
                cache_fs::write_atomic(&path, &contents).await?;
            }
        }
    }

    tracing::info!(ui_root=%ui_root.to_string_lossy(), files=%files, dirs=%dirs, "ui subtree extracted");

    Ok(())
}
