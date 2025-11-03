// Wasmtime engine configuration, module fetch/cache, and instantiation
use crate::models::{
    ExecuteRequest as ModelExecuteRequest, ExecuteResponse as ModelExecuteResponse,
};
use reqwest::Client;
use std::collections::{HashMap, HashSet};
use std::env;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use wasmtime::{
    component::{Component, Linker, ResourceTable},
    Config, Engine, InstanceAllocationStrategy, PoolingAllocationConfig, ResourceLimiter, Store,
};
use wasmtime_wasi::{WasiCtx, WasiCtxBuilder, WasiCtxView, WasiView};
use wasmtime_wasi_http::{WasiHttpCtx, WasiHttpView};

use super::component;
use super::host_api::{
    add_component_host, to_component_execute_request, to_model_execute_response, HostRuntimeConfig,
};
use crate::cache::fs as cache_fs;
use aws_credential_types::Credentials as AwsCredentials;
use aws_sdk_s3::{config as s3config, Client as S3Client};
use url::Url;

const DEFAULT_MAX_MEMORY_MB: u64 = 256;
const DEFAULT_POOL_TOTAL_COMPONENTS: u32 = 256;
const DEFAULT_POOL_TOTAL_MEMORIES: u32 = 256;
const DEFAULT_POOL_TOTAL_TABLES: u32 = 256;
const DEFAULT_POOL_TOTAL_STACKS: u32 = 512;
const DEFAULT_MAX_CORE_INSTANCE_SIZE: usize = 1 << 20;
const DEFAULT_MAX_COMPONENT_INSTANCE_SIZE: usize = 1 << 20;
const EPOCH_TICK_MS: u64 = 10;

pub struct ModuleLoader {
    pub engine: Engine,
    http: Client,
    cache: Arc<RwLock<HashMap<String, Arc<Vec<u8>>>>>,
    runtime_cfg: HostRuntimeConfig,
}

#[derive(Clone, Default)]
pub struct HostExecutionContext {
    pub request_id: Option<String>,
    pub tenant_id: Option<String>,
    pub extension_id: Option<String>,
    pub install_id: Option<String>,
    pub version_id: Option<String>,
    pub config: HashMap<String, String>,
    pub providers: HashSet<String>,
    pub secrets: Option<SecretMaterial>,
}

#[derive(Clone, Default)]
pub struct SecretMaterial {
    pub values: HashMap<String, String>,
    pub version: Option<String>,
}

pub(crate) struct HostState {
    max_memory: usize,
    pub runtime: HostRuntimeConfig,
    pub context: HostExecutionContext,
    wasi: WasiCtx,
    table: ResourceTable,
    http: WasiHttpCtx,
}

impl ResourceLimiter for HostState {
    fn memory_growing(
        &mut self,
        _current: usize,
        desired: usize,
        _maximum: Option<usize>,
    ) -> Result<bool, wasmtime::Error> {
        Ok(desired <= self.max_memory)
    }
    fn table_growing(
        &mut self,
        _current: usize,
        _desired: usize,
        _maximum: Option<usize>,
    ) -> Result<bool, wasmtime::Error> {
        Ok(true)
    }
}

impl WasiView for HostState {
    fn ctx(&mut self) -> WasiCtxView<'_> {
        WasiCtxView {
            ctx: &mut self.wasi,
            table: &mut self.table,
        }
    }
}

impl WasiHttpView for HostState {
    fn ctx(&mut self) -> &mut WasiHttpCtx {
        &mut self.http
    }

    fn table(&mut self) -> &mut ResourceTable {
        &mut self.table
    }
}

impl ModuleLoader {
    pub fn new() -> anyhow::Result<Self> {
        let mut cfg = Config::default();
        // Enable async + epoch interruption for cooperative timeslicing
        cfg.async_support(true)
            .epoch_interruption(true)
            // Fuel is optional; disabled by default for lower overhead
            .consume_fuel(false)
            .cranelift_debug_verifier(false)
            .parallel_compilation(true);

        // Configure pooling allocator with conservative defaults
        let mut pool = PoolingAllocationConfig::default();
        pool.total_core_instances(DEFAULT_POOL_TOTAL_COMPONENTS)
            .total_memories(DEFAULT_POOL_TOTAL_MEMORIES)
            .total_tables(DEFAULT_POOL_TOTAL_TABLES)
            .total_stacks(DEFAULT_POOL_TOTAL_STACKS)
            .max_core_instance_size(DEFAULT_MAX_CORE_INSTANCE_SIZE)
            .max_component_instance_size(DEFAULT_MAX_COMPONENT_INSTANCE_SIZE)
            // Keep small resident regions to avoid page thrash without bloating RSS
            .linear_memory_keep_resident(0)
            .table_keep_resident(0);
        cfg.allocation_strategy(InstanceAllocationStrategy::Pooling(pool));

        let engine = Engine::new(&cfg)?;
        let http = Client::builder().build()?;
        let runtime_cfg = HostRuntimeConfig::from_env();
        Ok(Self {
            engine,
            http,
            cache: Arc::new(RwLock::new(HashMap::new())),
            runtime_cfg,
        })
    }

    fn instantiate(
        &self,
        wasm: &[u8],
        timeout_ms: Option<u64>,
        memory_mb: Option<u64>,
    ) -> anyhow::Result<(Store<HostState>, Component, Linker<HostState>)> {
        let component = Component::from_binary(&self.engine, wasm)?;
        let table = ResourceTable::new();
        let wasi = WasiCtxBuilder::new().build();
        let http = WasiHttpCtx::new();
        let host_state = HostState {
            max_memory: (memory_mb.unwrap_or(DEFAULT_MAX_MEMORY_MB) as usize) * 1024 * 1024,
            runtime: self.runtime_cfg.clone(),
            context: HostExecutionContext::default(),
            wasi,
            table,
            http,
        };
        let mut store = Store::new(&self.engine, host_state);

        // Apply store-level resource limits if needed
        store.limiter(|s| s);

        if let Some(ms) = timeout_ms {
            tracing::debug!(timeout_ms=%ms, "applying execute timeout");
            self.apply_timeout(&mut store, ms);
        }
        let mut linker: Linker<HostState> = Linker::new(&self.engine);
        wasmtime_wasi::p2::add_to_linker_async(&mut linker)?;
        wasmtime_wasi_http::add_only_http_to_linker_async(&mut linker)?;
        add_component_host(&mut linker)?;
        Ok((store, component, linker))
    }

    fn apply_timeout(&self, store: &mut Store<HostState>, ms: u64) {
        // Use epoch-based interruption. Map ms to ticks by incrementing the engine epoch every 10ms.
        let ticks = deadline_ticks_for_timeout(ms);
        store.set_epoch_deadline(ticks);
        // For async configs, yield and update to continue if host wants to resume (not used yet)
        let _ = store.epoch_deadline_trap();

        // Spawn a background task to bump the engine epoch periodically until the deadline is likely reached.
        let engine = self.engine.clone();
        std::thread::spawn(move || {
            let steps = ticks + 2;
            for _ in 0..steps {
                std::thread::sleep(Duration::from_millis(EPOCH_TICK_MS));
                engine.increment_epoch();
            }
        });
    }

    pub async fn fetch_object(&self, key: &str) -> anyhow::Result<Vec<u8>> {
        // Cache lookup
        if let Some(v) = self.cache.read().await.get(key).cloned() {
            return Ok((*v).clone());
        }
        // Build from BUNDLE_STORE_BASE like http://minio:9000/alga-extensions
        let base = env::var("BUNDLE_STORE_BASE")?;
        tracing::debug!(%key, %base, "fetch_object starting http fetch");
        let url = format!(
            "{}/{}",
            base.trim_end_matches('/'),
            key.trim_start_matches('/')
        );
        let resp = self.http.get(url).send().await?;
        if !resp.status().is_success() {
            tracing::warn!(status=%resp.status(), %key, "fetch_object received non-success status");
            anyhow::bail!("fetch failed: {}", resp.status());
        }
        let bytes = resp.bytes().await?.to_vec();
        tracing::debug!(%key, size=bytes.len(), "fetch_object downloaded bytes");
        // Hash verification: expect key under sha256/<hash>/...
        if let Some((_prefix, rest)) = key.split_once("sha256/") {
            if let Some((hash, _tail)) = rest.split_once('/') {
                use sha2::{Digest, Sha256};
                let mut hasher = Sha256::new();
                hasher.update(&bytes);
                let digest = hasher.finalize();
                let got = hex::encode(digest);
                if got != hash {
                    anyhow::bail!("hash_mismatch: expected {} got {}", hash, got);
                }
            }
        }
        // TODO: signature verification using SIGNING_TRUST_BUNDLE and sha256/<hash>/SIGNATURE
        let arc = Arc::new(bytes.clone());
        self.cache.write().await.insert(key.to_string(), arc);
        Ok(bytes)
    }

    pub async fn execute_handler(
        &self,
        wasm: &[u8],
        timeout_ms: Option<u64>,
        memory_mb: Option<u64>,
        request: &ModelExecuteRequest,
        mut context: HostExecutionContext,
    ) -> anyhow::Result<ModelExecuteResponse> {
        // Ensure baseline capabilities are always present for the guest runtime. Some callers
        // (especially external tooling) may omit them, but the component contract expects the
        // context/read + log emit capabilities to be available at minimum.
        if context.providers.is_empty() {
            context.providers = crate::providers::default_capabilities()
                .into_iter()
                .map(|cap| cap.to_ascii_lowercase())
                .collect();
        } else {
            for cap in crate::providers::default_capabilities() {
                context.providers.insert(cap.to_ascii_lowercase());
            }
        }
        tracing::info!(
            request_id = ?request.context.request_id,
            tenant = ?request.context.tenant_id,
            extension = ?request.context.extension_id,
            providers = ?context.providers,
            "execute_handler normalized providers"
        );
        let (mut store, component, linker) = self.instantiate(wasm, timeout_ms, memory_mb)?;
        tracing::debug!(timeout_ms=?timeout_ms, memory_mb=?memory_mb, "instantiate complete");
        store.data_mut().context = context;
        let instance_pre = linker.instantiate_pre(&component)?;
        let instance = instance_pre.instantiate_async(&mut store).await?;
        let handler = instance.get_typed_func::<
            (&component::alga::extension::types::ExecuteRequest,),
            (component::alga::extension::types::ExecuteResponse,),
        >(&mut store, "handler")?;
        let input = to_component_execute_request(request)?;
        let result = handler.call_async(&mut store, (&input,)).await;
        let (output,) = match result {
            Ok(v) => v,
            Err(e) => {
                tracing::error!(error_debug=?e, "component call failed");
                return Err(e.into());
            }
        };
        Ok(to_model_execute_response(output))
    }
}

/// Fetch a URL (bundle/object) and write atomically to a destination file.
/// Currently buffers response fully; can be optimized later to chunked write.
pub async fn fetch_to_file(url: &str, dest_tmp: &Path) -> anyhow::Result<()> {
    let client = reqwest::Client::builder().build()?;
    let resp = client.get(url).send().await?;
    if !resp.status().is_success() {
        anyhow::bail!("fetch_to_file failed: {}", resp.status());
    }
    let bytes = resp.bytes().await?;
    cache_fs::write_atomic(dest_tmp, &bytes).await?;
    Ok(())
}

fn deadline_ticks_for_timeout(timeout_ms: u64) -> u64 {
    (timeout_ms / EPOCH_TICK_MS).max(1)
}

/// Build the bundle URL from BUNDLE_STORE_BASE and a content hash "sha256:<hex>" or "<hex>".
/// Result: <base>/sha256/<hex>/bundle.tar.zst
pub fn bundle_url(bundle_store_base: &Url, content_hash: &str) -> anyhow::Result<Url> {
    let hex = content_hash.strip_prefix("sha256:").unwrap_or(content_hash);
    if hex.is_empty() {
        anyhow::bail!("empty content hash");
    }
    let mut base = bundle_store_base.clone();
    // Ensure trailing slash handling
    let path = format!("sha256/{}/bundle.tar.zst", hex);
    let joined = base.join(&path)?;
    Ok(joined)
}

pub fn bundle_url_for_key(bundle_store_base: &Url, key: &str) -> anyhow::Result<Url> {
    let mut base = bundle_store_base.clone();
    let joined = base.join(key.trim_start_matches('/'))?;
    Ok(joined)
}

/// Stream a bundle archive to a temp file while computing sha256, verifying against expected hex.
/// On success returns the path to the temp file. On mismatch deletes the temp and returns IntegrityError::ArchiveHashMismatch.
pub async fn verify_archive_sha256(
    url: &Url,
    expected_hex: &str,
) -> anyhow::Result<std::path::PathBuf> {
    use rand::{distributions::Alphanumeric, Rng};
    use sha2::{Digest, Sha256};
    use tokio::fs as tfs;
    use tokio::io::AsyncWriteExt;

    let expected_lower = expected_hex.to_ascii_lowercase();
    tracing::info!(expected_hash=%expected_lower, url=%url.to_string(), "verify archive start");
    let cache_root = cache_fs::ext_cache_root_from_env();
    let tmp_dir = cache_root.join("tmp");
    cache_fs::ensure_dir(&tmp_dir).await?;
    let rand_suffix: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(6)
        .map(char::from)
        .collect();
    let tmp_path = tmp_dir.join(format!("{}.{}.tar.zst", expected_lower, rand_suffix));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()?;

    // Prefer presigned S3 GET if credentials are available; fallback to direct URL
    let mut fetch_url = url.clone();
    if let (Ok(base), Some(access), Some(secret)) = (
        std::env::var("BUNDLE_STORE_BASE"),
        std::env::var("S3_ACCESS_KEY")
            .ok()
            .or_else(|| std::env::var("MINIO_ACCESS_KEY").ok()),
        std::env::var("S3_SECRET_KEY")
            .ok()
            .or_else(|| std::env::var("MINIO_SECRET_KEY").ok()),
    ) {
        if let Ok(base_url) = Url::parse(&base) {
            let bucket = base_url
                .path()
                .trim_matches('/')
                .split('/')
                .next()
                .unwrap_or("");
            if !bucket.is_empty() {
                let endpoint = match (base_url.scheme(), base_url.host_str(), base_url.port()) {
                    (scheme, Some(host), Some(port)) => format!("{}://{}:{}", scheme, host, port),
                    (scheme, Some(host), None) => format!("{}://{}", scheme, host),
                    _ => String::new(),
                };
                if !endpoint.is_empty() {
                    let region =
                        std::env::var("S3_REGION").unwrap_or_else(|_| "us-east-1".to_string());
                    let creds = AwsCredentials::new(
                        access.clone(),
                        secret.clone(),
                        None,
                        None,
                        "alga-ext-runner",
                    );
                    let conf = s3config::Builder::new()
                        .region(s3config::Region::new(region))
                        .endpoint_url(endpoint)
                        .credentials_provider(creds)
                        .force_path_style(true)
                        .build();
                    let s3 = S3Client::from_conf(conf);
                    // Derive object key from URL path by stripping the bucket segment
                    let full_path = url.path().trim_start_matches('/');
                    let mut parts = full_path.splitn(2, '/');
                    let _bucket_seg = parts.next();
                    let key = parts.next().unwrap_or("").to_string();
                    if let Ok(cfg) = aws_sdk_s3::presigning::PresigningConfig::expires_in(
                        Duration::from_secs(60),
                    ) {
                        match s3
                            .get_object()
                            .bucket(bucket)
                            .key(&key)
                            .presigned(cfg)
                            .await
                        {
                            Ok(ps) => {
                                if let Ok(u) = Url::parse(&ps.uri().to_string()) {
                                    tracing::info!(bucket=%bucket, key=%key, "using presigned S3 GET");
                                    fetch_url = u;
                                }
                            }
                            Err(e) => {
                                tracing::warn!(err=%e.to_string(), bucket=%bucket, key=%key, "presign failed; falling back to direct URL");
                            }
                        }
                    }
                }
            }
        }
    }

    let mut resp = client.get(fetch_url.clone()).send().await?;
    if !resp.status().is_success() {
        tracing::error!(status=%resp.status().as_u16(), url=%fetch_url.to_string(), "verify archive fetch failed");
        anyhow::bail!("verify_archive_sha256 fetch failed: {}", resp.status());
    }

    let mut hasher = Sha256::new();
    let mut file = tfs::File::create(&tmp_path).await?;

    // Stream using reqwest Response::chunk to avoid extra deps
    let mut total: u64 = 0;
    while let Some(bytes) = resp.chunk().await? {
        hasher.update(&bytes);
        file.write_all(&bytes).await?;
        total += bytes.len() as u64;
    }
    file.flush().await?;
    let _ = file.sync_all().await;

    let got = hex::encode(hasher.finalize());
    if !got.eq_ignore_ascii_case(&expected_lower) {
        // Integrity failure: remove temp file and return structured error
        let _ = tfs::remove_file(&tmp_path).await;
        tracing::error!(expected=%expected_lower, computed=%got, bytes=total, "verify archive hash mismatch");
        return Err(crate::util::errors::IntegrityError::ArchiveHashMismatch {
            expected_hex: expected_lower,
            computed_hex: got,
        }
        .into());
    }
    tracing::info!(hash=%expected_lower, bytes=total, path=%tmp_path.to_string_lossy(), "verify archive ok");
    Ok(tmp_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasmtime_wasi::WasiCtxBuilder;
    use wasmtime_wasi_http::WasiHttpCtx;

    fn make_host_state(max_memory_mb: u64, runtime: HostRuntimeConfig) -> HostState {
        let table = ResourceTable::new();
        let wasi = WasiCtxBuilder::new().build();
        let http = WasiHttpCtx::new();
        HostState {
            max_memory: (max_memory_mb as usize) * 1024 * 1024,
            runtime,
            context: HostExecutionContext::default(),
            wasi,
            table,
            http,
        }
    }

    #[test]
    fn memory_growing_enforces_limits() {
        let runtime = HostRuntimeConfig::default();
        let mut state = make_host_state(8, runtime);

        // Allow growth when within the limit.
        assert!(state.memory_growing(0, 2 * 1024 * 1024, None).unwrap());

        // Deny growth above the configured limit.
        assert!(!state.memory_growing(0, 16 * 1024 * 1024, None).unwrap());
    }

    #[test]
    fn timeout_ms_maps_to_deadline_ticks() {
        assert_eq!(deadline_ticks_for_timeout(1), 1);
        assert_eq!(deadline_ticks_for_timeout(EPOCH_TICK_MS), 1);
        assert_eq!(deadline_ticks_for_timeout(EPOCH_TICK_MS + 1), 1);
        assert_eq!(deadline_ticks_for_timeout(25), 2);
    }
}
