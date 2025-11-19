// Wasmtime engine configuration, module fetch/cache, and instantiation
use crate::engine::stderr_pipe::StderrPipe;
use crate::models::{
    ExecuteRequest as ModelExecuteRequest, ExecuteResponse as ModelExecuteResponse,
};
use anyhow::Context;
use once_cell::sync::Lazy;
use reqwest::Client;
use std::collections::{HashMap, HashSet};
use std::env;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tar::Archive;
use tokio::{
    fs,
    io::AsyncReadExt,
    sync::{Mutex as TokioMutex, RwLock},
};
use wasmtime::{
    component::{Component, Linker, ResourceTable},
    Config, Engine, InstanceAllocationStrategy, PoolingAllocationConfig, ResourceLimiter, Store,
};
use wasmtime_wasi::{WasiCtx, WasiCtxBuilder, WasiCtxView, WasiView};
use wasmtime_wasi_http::{WasiHttpCtx, WasiHttpView};
use zstd::stream::read::Decoder as ZstdDecoder;

use super::component;
use super::host_api::{
    add_component_host, to_component_execute_request, to_model_execute_response, HostRuntimeConfig,
};
use crate::{cache::fs as cache_fs, util::errors::IntegrityError};
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
    bundle_store_base: Url,
    cache_root: PathBuf,
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
        tracing::info!("Initializing Wasmtime ModuleLoader...");
        tracing::info!(
            "Configuring Wasmtime engine with pooling allocator and epoch-based interruption"
        );

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

        tracing::info!("Wasmtime Configuration:");
        tracing::info!("  - Max Components: {}", DEFAULT_POOL_TOTAL_COMPONENTS);
        tracing::info!("  - Max Memories: {}", DEFAULT_POOL_TOTAL_MEMORIES);
        tracing::info!("  - Max Tables: {}", DEFAULT_POOL_TOTAL_TABLES);
        tracing::info!("  - Max Stacks: {}", DEFAULT_POOL_TOTAL_STACKS);
        tracing::info!("  - Async Support: ENABLED");
        tracing::info!("  - Epoch Interruption: ENABLED");

        let engine = Engine::new(&cfg)?;
        tracing::info!("✓ Wasmtime Engine created successfully");

        let http = Client::builder().build()?;
        tracing::info!("✓ HTTP client initialized for MinIO/bundle store communication");

        let runtime_cfg = HostRuntimeConfig::from_env();
        tracing::info!("✓ Host runtime configuration loaded from environment");

        let bundle_store_raw = env::var("BUNDLE_STORE_BASE")
            .map_err(|_| anyhow::anyhow!("BUNDLE_STORE_BASE not configured"))?;
        let bundle_store_base = Url::parse(&bundle_store_raw)?;
        tracing::info!(base=%bundle_store_base.as_str(), "✓ Bundle store base URL parsed");

        let cache_root = cache_fs::ext_cache_root_from_env();
        tracing::info!(cache_root=%cache_root.to_string_lossy(), "✓ Extension cache root resolved");

        let loader = Self {
            engine,
            http,
            cache: Arc::new(RwLock::new(HashMap::new())),
            runtime_cfg,
            bundle_store_base,
            cache_root,
        };
        tracing::info!("✓ ModuleLoader fully initialized and ready");
        tracing::info!("  - In-memory object cache ready");
        tracing::info!("  - HTTP transport ready for MinIO downloads");
        tracing::info!("  - Wasmtime engine ready for component instantiation");
        Ok(loader)
    }

    fn instantiate(
        &self,
        wasm: &[u8],
        timeout_ms: Option<u64>,
        memory_mb: Option<u64>,
    ) -> anyhow::Result<(Store<HostState>, Component, Linker<HostState>)> {
        let wasm_size = wasm.len();
        tracing::info!(wasm_size=%wasm_size, timeout_ms=?timeout_ms, memory_mb=?memory_mb, "Wasmtime component instantiation starting");

        // Parse WASM component
        tracing::info!("Parsing WebAssembly component binary...");
        let component = Component::from_binary(&self.engine, wasm)?;
        tracing::info!("✓ Component binary parsed successfully");

        // Initialize resource table
        let table = ResourceTable::new();
        tracing::info!("✓ Resource table initialized");

        // For now we keep WASI stdio defaulted; stdout/stderr mapping is handled at the
        // logging layer by using the HostExecutionContext + DebugHub. If in the future we
        // attach explicit pipes here, they must forward lines to `emit_stdout_line` /
        // `emit_stderr_line` with the current context.
        // Use a dedicated stderr sink that mirrors guest stderr into the debug hub when enabled.
        // We intentionally keep stdout as-is for now and treat stderr as the primary signal for
        // extension authors; this avoids surprising noise while still surfacing failures.
        tracing::info!("Configuring WASI runtime context with stderr capture");
        let stderr = StderrPipe::new(move |bytes: Vec<u8>| {
            if let Ok(line) = std::str::from_utf8(&bytes) {
                let line = line.trim_end_matches(&['\r', '\n'][..]).to_string();
                if !line.is_empty() {
                    // Best-effort: we don't have the context here yet; the debug hub will
                    // attach request/tenant metadata once the HostExecutionContext is set
                    // on the store before the handler is invoked.
                    let ctx = HostExecutionContext::default();
                    tokio::spawn(async move {
                        crate::engine::debug::emit_stderr_line(&ctx, &line).await;
                    });
                }
            }
        });

        let wasi = WasiCtxBuilder::new()
            .inherit_args() // preserves existing behavior for args
            .inherit_stdin()
            .inherit_stdout()
            .stderr(stderr)
            .build();
        tracing::info!("✓ WASI context configured with stdio handlers");

        let http = WasiHttpCtx::new();
        tracing::info!("✓ WASI HTTP context initialized");

        // Calculate memory limit
        let memory_limit = (memory_mb.unwrap_or(DEFAULT_MAX_MEMORY_MB) as usize) * 1024 * 1024;
        tracing::info!(
            "Memory limit configured: {} bytes ({} MB)",
            memory_limit,
            memory_mb.unwrap_or(DEFAULT_MAX_MEMORY_MB)
        );

        let host_state = HostState {
            max_memory: memory_limit,
            runtime: self.runtime_cfg.clone(),
            context: HostExecutionContext::default(),
            wasi,
            table,
            http,
        };
        let mut store = Store::new(&self.engine, host_state);
        tracing::info!("✓ Host state created with memory limits and runtime config");

        // Apply store-level resource limits if needed
        store.limiter(|s| s);
        tracing::info!("✓ Resource limiter installed on store");

        if let Some(ms) = timeout_ms {
            tracing::info!(timeout_ms=%ms, "Configuring epoch-based timeout ({}ms)", ms);
            self.apply_timeout(&mut store, ms);
            tracing::info!("✓ Timeout configuration applied");
        }

        // Build linker with all required imports
        tracing::info!("Linking component with host APIs...");
        let mut linker: Linker<HostState> = Linker::new(&self.engine);

        tracing::info!("  - Adding WASI (preview2) APIs to linker");
        wasmtime_wasi::p2::add_to_linker_async(&mut linker)?;
        tracing::info!("  - Adding WASI HTTP APIs to linker");
        wasmtime_wasi_http::add_only_http_to_linker_async(&mut linker)?;
        tracing::info!("  - Adding component-specific host APIs to linker");
        add_component_host(&mut linker)?;
        tracing::info!("✓ Component linker fully configured with all host APIs");

        tracing::info!(wasm_size=%wasm_size, "Wasmtime instantiation successful - ready for execution");
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

    pub async fn load_wasm_module(
        &self,
        tenant: &str,
        extension: &str,
        content_hash: &str,
        entry_path: &str,
    ) -> anyhow::Result<Vec<u8>> {
        let hash_hex = content_hash
            .strip_prefix("sha256:")
            .unwrap_or(content_hash)
            .to_ascii_lowercase();
        let cache_key = format!("{}::{}::{}::{}", tenant, extension, hash_hex, entry_path);
        if let Some(bytes) = self.cache.read().await.get(&cache_key).cloned() {
            tracing::info!(tenant=%tenant, extension=%extension, hash=%hash_hex, entry=%entry_path, "Component bytes served from in-memory cache");
            return Ok((*bytes).clone());
        }

        let object_key = format!(
            "tenants/{}/extensions/{}/sha256/{}/bundle.tar.zst",
            tenant, extension, hash_hex
        );
        tracing::info!(tenant=%tenant, extension=%extension, hash=%hash_hex, entry=%entry_path, object_key=%object_key, "Ensuring bundle cached locally");
        let paths = ensure_bundle_cached(
            &self.bundle_store_base,
            &self.cache_root,
            &object_key,
            &hash_hex,
        )
        .await?;

        let wasm_path = paths.bundle_root.join(entry_path);
        tracing::info!(tenant=%tenant, extension=%extension, path=%wasm_path.to_string_lossy(), "Reading WASM component from cache");
        let bytes = fs::read(&wasm_path).await.map_err(|err| {
            tracing::error!(error=%err.to_string(), path=%wasm_path.to_string_lossy(), "Failed to read WASM component from cache");
            err
        })?;
        tracing::info!(tenant=%tenant, extension=%extension, bytes=%bytes.len(), "WASM component loaded from cache");

        let arc = Arc::new(bytes.clone());
        self.cache.write().await.insert(cache_key, arc);
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
        let request_id = request
            .context
            .request_id
            .as_ref()
            .map(|s| s.as_str())
            .unwrap_or("unknown");
        let tenant_id = &request.context.tenant_id;
        let extension_id = &request.context.extension_id;

        tracing::info!(request_id=%request_id, tenant=%tenant_id, extension=%extension_id, "Extension execution started");
        tracing::info!(request_id=%request_id, timeout_ms=?timeout_ms, memory_mb=?memory_mb, "Execution parameters");

        // Ensure baseline capabilities are always present for the guest runtime. Some callers
        // (especially external tooling) may omit them, but the component contract expects the
        // context/read + log emit capabilities to be available at minimum.
        tracing::info!(request_id=%request_id, "Normalizing capability providers");
        if context.providers.is_empty() {
            context.providers = crate::providers::default_capabilities()
                .into_iter()
                .map(|cap| cap.to_ascii_lowercase())
                .collect();
            tracing::info!(request_id=%request_id, provider_count=%context.providers.len(), "Added default capabilities");
        } else {
            for cap in crate::providers::default_capabilities() {
                context.providers.insert(cap.to_ascii_lowercase());
            }
            tracing::info!(request_id=%request_id, provider_count=%context.providers.len(), "Supplemented existing capabilities");
        }
        tracing::info!(
            request_id=%request_id,
            tenant=%tenant_id,
            extension=%extension_id,
            provider_count=%context.providers.len(),
            "Provider normalization complete"
        );

        // Instantiate WASM component
        tracing::info!(request_id=%request_id, "Instantiating WASM component in Wasmtime");
        let (mut store, component, linker) = self.instantiate(wasm, timeout_ms, memory_mb)?;
        tracing::info!(request_id=%request_id, "WASM component instantiated successfully");

        // Set execution context
        store.data_mut().context = context;
        tracing::info!(request_id=%request_id, "Host execution context attached to store");

        // Pre-instantiate component
        tracing::info!(request_id=%request_id, "Pre-instantiating component for execution");
        let instance_pre = linker.instantiate_pre(&component)?;
        tracing::info!(request_id=%request_id, "Component pre-instantiation complete");

        // Instantiate the component
        tracing::info!(request_id=%request_id, "Instantiating component instance");
        let instance = instance_pre.instantiate_async(&mut store).await?;
        tracing::info!(request_id=%request_id, "Component instance created");

        // Get the handler function
        tracing::info!(request_id=%request_id, "Resolving 'handler' function export");
        let handler = instance.get_typed_func::<
            (&component::alga::extension::types::ExecuteRequest,),
            (component::alga::extension::types::ExecuteResponse,),
        >(&mut store, "handler")?;
        tracing::info!(request_id=%request_id, "Handler function resolved successfully");

        // Convert request to component format
        tracing::info!(request_id=%request_id, "Converting request to component format");
        let input = to_component_execute_request(request)?;
        tracing::info!(request_id=%request_id, "Request conversion complete");

        // Call the handler
        tracing::info!(request_id=%request_id, "Calling extension handler function");
        let result = handler.call_async(&mut store, (&input,)).await;

        let (output,) = match result {
            Ok(v) => {
                tracing::info!(request_id=%request_id, "Extension handler executed successfully");
                v
            }
            Err(e) => {
                tracing::error!(request_id=%request_id, error_debug=?e, "Extension handler execution failed");
                tracing::error!(request_id=%request_id, error_display=%e.to_string(), "Handler error details");
                return Err(e.into());
            }
        };

        // Convert response back to model format
        tracing::info!(request_id=%request_id, "Converting response from component format");
        let response = to_model_execute_response(output);
        tracing::info!(request_id=%request_id, status=%response.status, "Extension execution complete - response ready");

        Ok(response)
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
    let path = format!("sha256/{}/bundle.tar.zst", hex);
    bundle_url_for_key(bundle_store_base, &path)
}

pub fn bundle_url_for_key(bundle_store_base: &Url, key: &str) -> anyhow::Result<Url> {
    let trimmed = key.trim_start_matches('/');
    if trimmed.is_empty() {
        anyhow::bail!("empty bundle key");
    }
    let base_str = bundle_store_base.as_str().trim_end_matches('/');
    let full = format!("{}/{}", base_str, trimmed);
    Ok(Url::parse(&full)?)
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
    tracing::info!(expected_hash=%expected_lower, bundle_url=%url.to_string(), "Bundle archive download and hash verification started");
    tracing::info!(expected_hash=%expected_lower, "Archive will be verified against SHA256 hash and extracted to cache");

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
    let mut using_presigned = false;

    if let (Ok(base), Some(access), Some(secret)) = (
        std::env::var("BUNDLE_STORE_BASE"),
        std::env::var("S3_ACCESS_KEY")
            .ok()
            .or_else(|| std::env::var("MINIO_ACCESS_KEY").ok()),
        std::env::var("S3_SECRET_KEY")
            .ok()
            .or_else(|| std::env::var("MINIO_SECRET_KEY").ok()),
    ) {
        tracing::info!(expected_hash=%expected_lower, "S3/MinIO credentials detected - attempting presigned URL generation");
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
                    if let Some((bucket_name, object_key)) =
                        presign_target_from_urls(&base_url, &url)
                    {
                        if let Ok(cfg) = aws_sdk_s3::presigning::PresigningConfig::expires_in(
                            Duration::from_secs(60),
                        ) {
                            match s3
                                .get_object()
                                .bucket(&bucket_name)
                                .key(&object_key)
                                .presigned(cfg)
                                .await
                            {
                                Ok(ps) => {
                                    if let Ok(u) = Url::parse(&ps.uri().to_string()) {
                                        using_presigned = true;
                                        fetch_url = u;
                                        tracing::info!(expected_hash=%expected_lower, bucket=%bucket_name, key=%object_key, "Using presigned S3 GET URL for secure download");
                                    }
                                }
                                Err(e) => {
                                    tracing::warn!(expected_hash=%expected_lower, err=%e.to_string(), bucket=%bucket_name, key=%object_key, "Presigned URL generation failed; falling back to direct URL");
                                }
                            }
                        }
                    } else {
                        tracing::debug!(expected_hash=%expected_lower, bundle_url=%url.to_string(), "Presigned URL skipped; unable to derive bucket/key from URLs");
                    }
                }
            }
        }
    }

    if !using_presigned {
        tracing::info!(expected_hash=%expected_lower, "Using direct URL download (no presigned URL)");
    }

    tracing::info!(expected_hash=%expected_lower, download_url=%fetch_url.to_string(), "Starting bundle download");

    let mut resp = client.get(fetch_url.clone()).send().await?;
    if !resp.status().is_success() {
        tracing::error!(expected_hash=%expected_lower, status=%resp.status().as_u16(), download_url=%fetch_url.to_string(), "Bundle download failed with non-success HTTP status");
        tracing::error!(
            "Expected HTTP 200-299, got HTTP {} for bundle {}",
            resp.status(),
            url.to_string()
        );
        anyhow::bail!("verify_archive_sha256 fetch failed: {}", resp.status());
    }

    tracing::info!(expected_hash=%expected_lower, status=%resp.status().as_u16(), "Bundle download started - streaming to temporary file");

    let mut hasher = Sha256::new();
    let mut file = tfs::File::create(&tmp_path).await?;

    // Stream using reqwest Response::chunk to avoid extra deps
    let mut total: u64 = 0;
    let mut chunks: u64 = 0;
    while let Some(bytes) = resp.chunk().await? {
        hasher.update(&bytes);
        file.write_all(&bytes).await?;
        total += bytes.len() as u64;
        chunks += 1;
        if chunks % 100 == 0 {
            tracing::info!(expected_hash=%expected_lower, bytes_downloaded=%total, chunks_processed=%chunks, "Download progress update");
        }
    }
    file.flush().await?;
    let _ = file.sync_all().await;

    let got = hex::encode(hasher.finalize());
    tracing::info!(expected_hash=%expected_lower, computed_hash=%got, bytes_downloaded=%total, "Download complete - computing hash verification");

    if !got.eq_ignore_ascii_case(&expected_lower) {
        // Integrity failure: remove temp file and return structured error
        let _ = tfs::remove_file(&tmp_path).await;
        tracing::error!("═══════════════════════════════════════════════════════");
        tracing::error!("BUNDLE HASH VERIFICATION FAILED");
        tracing::error!("Expected: {}", expected_lower);
        tracing::error!("Computed: {}", got);
        tracing::error!("Bytes: {}", total);
        tracing::error!("URL: {}", url.to_string());
        tracing::error!("═══════════════════════════════════════════════════════");
        tracing::error!(expected=%expected_lower, computed=%got, bytes=total, download_url=%url.to_string(), "HASH_MISMATCH: Bundle integrity check failed");
        return Err(IntegrityError::ArchiveHashMismatch {
            expected_hex: expected_lower,
            computed_hex: got,
        }
        .into());
    }

    tracing::info!("═══════════════════════════════════════════════════════");
    tracing::info!("BUNDLE HASH VERIFICATION SUCCESSFUL");
    tracing::info!("Expected: {}", expected_lower);
    tracing::info!("Computed: {}", got);
    tracing::info!("Bytes: {}", total);
    tracing::info!("Temporary file: {}", tmp_path.to_string_lossy());
    tracing::info!("═══════════════════════════════════════════════════════");
    tracing::info!(hash=%expected_lower, bytes=%total, temp_path=%tmp_path.to_string_lossy(), "Bundle hash verification PASSED - ready for extraction");

    Ok(tmp_path)
}

#[derive(Clone, Debug)]
pub struct BundleCachePaths {
    pub bundle_root: PathBuf,
    pub ui_root: PathBuf,
}

static BUNDLE_EXTRACT_LOCK: Lazy<TokioMutex<()>> = Lazy::new(|| TokioMutex::new(()));

pub async fn ensure_bundle_cached(
    bundle_store_base: &Url,
    cache_root: &Path,
    object_key: &str,
    hash_hex: &str,
) -> anyhow::Result<BundleCachePaths> {
    let normalized_hash = hash_hex.to_ascii_lowercase();
    let bundle_root = cache_root.join(&normalized_hash).join("bundle");
    let ui_root = cache_root.join(&normalized_hash).join("ui");
    let marker = bundle_root.join(".ready");

    if fs::metadata(&marker).await.is_ok() {
        return Ok(BundleCachePaths {
            bundle_root,
            ui_root,
        });
    }

    let _guard = BUNDLE_EXTRACT_LOCK.lock().await;
    if fs::metadata(&marker).await.is_ok() {
        return Ok(BundleCachePaths {
            bundle_root,
            ui_root,
        });
    }

    let url = bundle_url_for_key(bundle_store_base, object_key)?;
    tracing::info!(hash=%normalized_hash, object_key=%object_key, url=%url.to_string(), "Bundle archive fetch start");
    let tmp_archive = verify_archive_sha256(&url, &normalized_hash).await?;

    if let Err(err) = extract_bundle_archive(&tmp_archive, &bundle_root, &ui_root).await {
        let _ = fs::remove_dir_all(&bundle_root).await;
        let _ = fs::remove_dir_all(&ui_root).await;
        let _ = fs::remove_file(&tmp_archive).await;
        return Err(err);
    }

    cache_fs::write_atomic(&marker, b"ok").await?;
    let _ = fs::remove_file(&tmp_archive).await;
    tracing::info!(hash=%normalized_hash, bundle_root=%bundle_root.to_string_lossy(), "Bundle archive cached locally");

    Ok(BundleCachePaths {
        bundle_root,
        ui_root,
    })
}

async fn extract_bundle_archive(
    archive_path: &Path,
    bundle_root: &Path,
    ui_root: &Path,
) -> anyhow::Result<()> {
    tracing::info!(archive=%archive_path.to_string_lossy(), bundle_root=%bundle_root.to_string_lossy(), ui_root=%ui_root.to_string_lossy(), "Extracting bundle archive to cache");

    let mut file = fs::File::open(archive_path).await?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).await?;
    tracing::info!(archive=%archive_path.to_string_lossy(), bytes=%buf.len(), "Archive loaded into memory for extraction");

    let decoder = ZstdDecoder::new(&buf[..])?;
    let mut archive = Archive::new(decoder);

    let _ = fs::remove_dir_all(bundle_root).await;
    cache_fs::ensure_dir(bundle_root).await?;
    let _ = fs::remove_dir_all(ui_root).await;
    cache_fs::ensure_dir(ui_root).await?;

    enum Op {
        Mkdir(PathBuf),
        Write { path: PathBuf, contents: Vec<u8> },
    }
    let mut ops: Vec<Op> = Vec::new();

    for entry in archive.entries().context("tar entries")? {
        let mut entry = entry.context("tar entry")?;
        let path = entry.path().context("entry path")?;
        let mut rel = path.to_string_lossy().to_string();
        while rel.starts_with("./") {
            rel = rel[2..].to_string();
        }
        if rel.is_empty() {
            continue;
        }
        if rel.starts_with('/') || rel.contains("..") {
            continue;
        }
        if rel
            .split('/')
            .any(|seg| seg.is_empty() || seg.starts_with('.'))
        {
            continue;
        }

        let (target_root, relative) = if rel.starts_with("ui/") {
            let trimmed = &rel["ui/".len()..];
            if trimmed.is_empty() {
                continue;
            }
            (ui_root, trimmed)
        } else {
            (bundle_root, rel.as_str())
        };

        let out_path = target_root.join(relative);
        if entry.header().entry_type().is_dir() {
            ops.push(Op::Mkdir(out_path));
        } else if entry.header().entry_type().is_file() {
            if let Some(parent) = out_path.parent() {
                ops.push(Op::Mkdir(parent.to_path_buf()));
            }
            let mut contents = Vec::with_capacity(16 * 1024);
            entry.read_to_end(&mut contents).context("read entry")?;
            ops.push(Op::Write {
                path: out_path,
                contents,
            });
        }
    }

    for op in ops {
        match op {
            Op::Mkdir(path) => cache_fs::ensure_dir(&path).await?,
            Op::Write { path, contents } => cache_fs::write_atomic(&path, contents).await?,
        }
    }

    tracing::info!(bundle_root=%bundle_root.to_string_lossy(), ui_root=%ui_root.to_string_lossy(), "Bundle archive extraction complete");
    Ok(())
}

fn presign_target_from_urls(base_url: &Url, bundle_url: &Url) -> Option<(String, String)> {
    let bucket = base_url
        .path()
        .trim_matches('/')
        .split('/')
        .next()
        .unwrap_or("")
        .to_string();
    if bucket.is_empty() {
        return None;
    }

    let mut key = bundle_url.path().trim_start_matches('/').to_string();
    let prefix = format!("{}/", bucket);
    if key.starts_with(&prefix) {
        key = key[prefix.len()..].to_string();
    } else if key == bucket {
        key.clear();
    }

    if key.is_empty() {
        None
    } else {
        Some((bucket, key))
    }
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

    #[test]
    fn bundle_url_for_key_retains_bucket_without_trailing_slash() {
        let base = Url::parse("http://host.docker.internal:9000/extensions").unwrap();
        let url = bundle_url_for_key(
            &base,
            "tenants/abc/extensions/def/sha256/123/bundle.tar.zst",
        )
        .unwrap();
        assert_eq!(
            url.as_str(),
            "http://host.docker.internal:9000/extensions/tenants/abc/extensions/def/sha256/123/bundle.tar.zst"
        );
    }

    #[test]
    fn bundle_url_for_key_retains_bucket_with_trailing_slash() {
        let base = Url::parse("http://host.docker.internal:9000/extensions/").unwrap();
        let url = bundle_url_for_key(
            &base,
            "/tenants/foo/extensions/bar/sha256/abc/bundle.tar.zst",
        )
        .unwrap();
        assert_eq!(
            url.as_str(),
            "http://host.docker.internal:9000/extensions/tenants/foo/extensions/bar/sha256/abc/bundle.tar.zst"
        );
    }

    #[test]
    fn bundle_url_uses_bundle_key_builder() {
        let base = Url::parse("http://host.docker.internal:9000/extensions").unwrap();
        let url = bundle_url(&base, "sha256:deadbeef").unwrap();
        assert_eq!(
            url.as_str(),
            "http://host.docker.internal:9000/extensions/sha256/deadbeef/bundle.tar.zst"
        );
    }

    #[test]
    fn presign_target_handles_url_with_bucket_segment() {
        let base = Url::parse("http://host:9000/extensions").unwrap();
        let bundle = Url::parse(
            "http://host:9000/extensions/tenants/t1/extensions/e1/sha256/h/bundle.tar.zst",
        )
        .unwrap();
        let (bucket, key) = presign_target_from_urls(&base, &bundle).unwrap();
        assert_eq!(bucket, "extensions");
        assert_eq!(key, "tenants/t1/extensions/e1/sha256/h/bundle.tar.zst");
    }

    #[test]
    fn presign_target_handles_url_without_bucket_segment() {
        let base = Url::parse("http://host:9000/extensions").unwrap();
        let bundle =
            Url::parse("http://host:9000/tenants/t1/extensions/e1/sha256/h/bundle.tar.zst")
                .unwrap();
        let (bucket, key) = presign_target_from_urls(&base, &bundle).unwrap();
        assert_eq!(bucket, "extensions");
        assert_eq!(key, "tenants/t1/extensions/e1/sha256/h/bundle.tar.zst");
    }
}
