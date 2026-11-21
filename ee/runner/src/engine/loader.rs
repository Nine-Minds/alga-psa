// Wasmtime engine configuration, module fetch/cache, and instantiation
use crate::engine::stderr_pipe::StderrPipe;
use crate::models::{
    ExecuteRequest as ModelExecuteRequest, ExecuteResponse as ModelExecuteResponse, UserInfo,
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
    sync::Mutex as TokioMutex,
};
use wasmtime::{
    component::{Component, Linker, ResourceTable},
    Config, Engine, InstanceAllocationStrategy, PoolingAllocationConfig, ResourceLimiter, Store,
};
use wasmtime_wasi::{WasiCtx, WasiCtxBuilder, WasiCtxView, WasiView};
use wasmtime_wasi_http::{
    p2::{WasiHttpCtxView, WasiHttpView},
    WasiHttpCtx,
};
use zstd::stream::read::Decoder as ZstdDecoder;

use super::component;
use super::host_api::{
    add_component_host, to_component_execute_request, to_model_execute_response, HostRuntimeConfig,
};
use crate::{
    cache::fs as cache_fs,
    cache::lru::{LruCache, LruCacheConfig},
    util::errors::IntegrityError,
};
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

const DEFAULT_MODULE_CACHE_MAX_ENTRIES: usize = 64;
const DEFAULT_MODULE_CACHE_MAX_BYTES: usize = 512 * 1024 * 1024;
const DEFAULT_COMPILED_CACHE_MAX_ENTRIES: usize = 16;

pub struct ModuleLoader {
    pub engine: Engine,
    http: Client,
    // LRU-bounded: the process-wide loader must not pin every content hash it has
    // ever served, or superseded extension versions accumulate until the pod dies.
    cache: TokioMutex<LruCache<String, Arc<Vec<u8>>>>,
    // Cranelift-compiling a JS component costs seconds of CPU; compile once per content hash.
    compiled: std::sync::Mutex<LruCache<[u8; 32], Component>>,
    // Per-hash compile gates so concurrent first requests for a new hash compile it once.
    compile_locks: std::sync::Mutex<HashMap<[u8; 32], Arc<TokioMutex<()>>>>,
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
    pub user: Option<UserInfo>,
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
    fn http(&mut self) -> WasiHttpCtxView<'_> {
        WasiHttpCtxView {
            ctx: &mut self.http,
            table: &mut self.table,
            hooks: Default::default(),
        }
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
            cache: TokioMutex::new(LruCache::new(LruCacheConfig {
                max_entries: env_usize("RUNNER_MODULE_CACHE_MAX_ENTRIES", DEFAULT_MODULE_CACHE_MAX_ENTRIES),
                max_bytes: env_usize("RUNNER_MODULE_CACHE_MAX_BYTES", DEFAULT_MODULE_CACHE_MAX_BYTES),
            })),
            compiled: std::sync::Mutex::new(LruCache::new(LruCacheConfig {
                max_entries: env_usize("RUNNER_COMPILED_CACHE_MAX_ENTRIES", DEFAULT_COMPILED_CACHE_MAX_ENTRIES),
                // One unit of weight per component; entry count is the meaningful cap.
                max_bytes: usize::MAX,
            })),
            compile_locks: std::sync::Mutex::new(HashMap::new()),
            runtime_cfg,
            bundle_store_base,
            cache_root,
        };
        // Deadlines are relative to the current epoch, so one ticker thread per engine
        // serves every store it creates. Starting it here (not only in shared()) keeps
        // timeouts live on loaders built directly, e.g. the smoke tests. The thread
        // runs for the process lifetime; loaders are long-lived by design.
        let ticker_engine = loader.engine.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(EPOCH_TICK_MS));
            ticker_engine.increment_epoch();
        });

        tracing::info!("✓ ModuleLoader fully initialized and ready");
        tracing::info!("  - In-memory object cache ready");
        tracing::info!("  - HTTP transport ready for MinIO downloads");
        tracing::info!("  - Wasmtime engine ready for component instantiation");
        Ok(loader)
    }

    /// Process-wide loader. Building one per request also rebuilt the Engine and pooling
    /// allocator, and compiled components are only valid for the Engine that made them.
    pub fn shared() -> anyhow::Result<&'static ModuleLoader> {
        static SHARED: once_cell::sync::OnceCell<ModuleLoader> = once_cell::sync::OnceCell::new();
        SHARED.get_or_try_init(ModuleLoader::new)
    }

    async fn compiled_component(&self, wasm: &[u8]) -> anyhow::Result<Component> {
        use sha2::{Digest, Sha256};
        let key: [u8; 32] = Sha256::digest(wasm).into();
        if let Some(component) = self.compiled.lock().unwrap().get(&key) {
            tracing::debug!("Component served from compiled cache");
            return Ok(component);
        }
        // Per-hash gate: concurrent first requests for the same new hash compile
        // once, and the losers take the cached result after waiting.
        let gate = self
            .compile_locks
            .lock()
            .unwrap()
            .entry(key)
            .or_insert_with(|| Arc::new(TokioMutex::new(())))
            .clone();
        let _guard = gate.lock().await;
        if let Some(component) = self.compiled.lock().unwrap().get(&key) {
            tracing::debug!("Component served from compiled cache after compile gate");
            return Ok(component);
        }
        let component = Component::from_binary(&self.engine, wasm)?;
        let evicted = self.compiled.lock().unwrap().insert(key, component.clone(), 1);
        if !evicted.is_empty() {
            tracing::info!(evicted=%evicted.len(), "Compiled-component cache evicted LRU entries");
        }
        // Drop the gate once nothing can be waiting on it any more: 1 count is
        // the map's own Arc, 1 is this call's `gate` clone; anything higher is
        // a live waiter that must still be released through the map entry.
        if let Ok(mut locks) = self.compile_locks.try_lock() {
            if let Some(existing) = locks.get(&key) {
                if Arc::strong_count(existing) <= 2 {
                    locks.remove(&key);
                }
            }
        }
        Ok(component)
    }

    async fn instantiate(
        &self,
        wasm: &[u8],
        timeout_ms: Option<u64>,
        memory_mb: Option<u64>,
    ) -> anyhow::Result<(Store<HostState>, Component, Linker<HostState>)> {
        let wasm_size = wasm.len();
        tracing::debug!(wasm_size=%wasm_size, timeout_ms=?timeout_ms, memory_mb=?memory_mb, "Wasmtime component instantiation starting");

        // Parse WASM component
        tracing::debug!("Parsing WebAssembly component binary...");
        let component = self.compiled_component(wasm).await?;
        tracing::debug!("✓ Component binary parsed successfully");

        // Initialize resource table
        let table = ResourceTable::new();
        tracing::debug!("✓ Resource table initialized");

        // For now we keep WASI stdio defaulted; stdout/stderr mapping is handled at the
        // logging layer by using the HostExecutionContext + DebugHub. If in the future we
        // attach explicit pipes here, they must forward lines to `emit_stdout_line` /
        // `emit_stderr_line` with the current context.
        // Use a dedicated stderr sink that mirrors guest stderr into the debug hub when enabled.
        // We intentionally keep stdout as-is for now and treat stderr as the primary signal for
        // extension authors; this avoids surprising noise while still surfacing failures.
        tracing::debug!("Configuring WASI runtime context with stderr capture");
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
        tracing::debug!("✓ WASI context configured with stdio handlers");

        let http = WasiHttpCtx::new();
        tracing::debug!("✓ WASI HTTP context initialized");

        // Calculate memory limit
        let memory_limit = (memory_mb.unwrap_or(DEFAULT_MAX_MEMORY_MB) as usize) * 1024 * 1024;
        tracing::debug!(
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
        tracing::debug!("✓ Host state created with memory limits and runtime config");

        // Apply store-level resource limits if needed
        store.limiter(|s| s);
        tracing::debug!("✓ Resource limiter installed on store");

        if let Some(ms) = timeout_ms {
            tracing::debug!(timeout_ms=%ms, "Configuring epoch-based timeout ({}ms)", ms);
            self.apply_timeout(&mut store, ms);
            tracing::debug!("✓ Timeout configuration applied");
        } else {
            // The shared epoch ticker never stops, so an unset deadline would trap at once.
            store.set_epoch_deadline(u64::MAX / 2);
        }

        // Build linker with all required imports
        tracing::debug!("Linking component with host APIs...");
        let mut linker: Linker<HostState> = Linker::new(&self.engine);

        tracing::debug!("  - Adding WASI (preview2) APIs to linker");
        wasmtime_wasi::p2::add_to_linker_async(&mut linker)?;
        tracing::debug!("  - Adding WASI HTTP APIs to linker");
        wasmtime_wasi_http::p2::add_only_http_to_linker_async(&mut linker)?;
        tracing::debug!("  - Adding component-specific host APIs to linker");
        add_component_host(&mut linker)?;
        tracing::debug!("✓ Component linker fully configured with all host APIs");

        tracing::debug!(wasm_size=%wasm_size, "Wasmtime instantiation successful - ready for execution");
        Ok((store, component, linker))
    }

    fn apply_timeout(&self, store: &mut Store<HostState>, ms: u64) {
        // Use epoch-based interruption. Map ms to ticks by incrementing the engine epoch every 10ms.
        let ticks = deadline_ticks_for_timeout(ms);
        store.set_epoch_deadline(ticks);
        // For async configs, yield and update to continue if host wants to resume (not used yet)
        let _ = store.epoch_deadline_trap();
    }

    /// Loads the guest module bytes, sharing cached copies via `Arc` so a cache
    /// hit never copies the (potentially multi-MB) binary per request.
    pub async fn load_wasm_module(
        &self,
        tenant: &str,
        extension: &str,
        content_hash: &str,
        entry_path: &str,
    ) -> anyhow::Result<Arc<Vec<u8>>> {
        let hash_hex = content_hash
            .strip_prefix("sha256:")
            .unwrap_or(content_hash)
            .to_ascii_lowercase();
        let cache_key = format!("{}::{}::{}::{}", tenant, extension, hash_hex, entry_path);
        let cached = self.cache.lock().await.get(&cache_key);
        if let Some(bytes) = cached {
            tracing::debug!(tenant=%tenant, extension=%extension, hash=%hash_hex, entry=%entry_path, "Component bytes served from in-memory cache");
            return Ok(bytes);
        }

        let object_key = format!(
            "tenants/{}/extensions/{}/sha256/{}/bundle.tar.zst",
            tenant, extension, hash_hex
        );
        tracing::debug!(tenant=%tenant, extension=%extension, hash=%hash_hex, entry=%entry_path, object_key=%object_key, "Ensuring bundle cached locally");
        let paths = ensure_bundle_cached(
            &self.bundle_store_base,
            &self.cache_root,
            &object_key,
            &hash_hex,
        )
        .await?;

        let wasm_path = paths.bundle_root.join(entry_path);
        tracing::debug!(tenant=%tenant, extension=%extension, path=%wasm_path.to_string_lossy(), "Reading WASM component from cache");
        let bytes = fs::read(&wasm_path).await.map_err(|err| {
            tracing::error!(error=%err.to_string(), path=%wasm_path.to_string_lossy(), "Failed to read WASM component from cache");
            err
        })?;
        tracing::debug!(tenant=%tenant, extension=%extension, bytes=%bytes.len(), "WASM component loaded from cache");

        let arc = Arc::new(bytes);
        let weight = arc.len();
        let evicted = self.cache.lock().await.insert(cache_key, arc.clone(), weight);
        if !evicted.is_empty() {
            tracing::info!(evicted=%evicted.len(), "Module-bytes cache evicted LRU entries");
        }
        Ok(arc)
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

        tracing::debug!(request_id=%request_id, tenant=%tenant_id, extension=%extension_id, "Extension execution started");
        tracing::debug!(request_id=%request_id, timeout_ms=?timeout_ms, memory_mb=?memory_mb, "Execution parameters");

        // Ensure baseline capabilities are always present for the guest runtime. Some callers
        // (especially external tooling) may omit them, but the component contract expects the
        // context/read + log emit capabilities to be available at minimum.
        tracing::debug!(request_id=%request_id, "Normalizing capability providers");
        if context.providers.is_empty() {
            context.providers = crate::providers::default_capabilities()
                .into_iter()
                .map(|cap| cap.to_ascii_lowercase())
                .collect();
            tracing::debug!(request_id=%request_id, provider_count=%context.providers.len(), "Added default capabilities");
        } else {
            for cap in crate::providers::default_capabilities() {
                context.providers.insert(cap.to_ascii_lowercase());
            }
            tracing::debug!(request_id=%request_id, provider_count=%context.providers.len(), "Supplemented existing capabilities");
        }
        tracing::debug!(
            request_id=%request_id,
            tenant=%tenant_id,
            extension=%extension_id,
            provider_count=%context.providers.len(),
            providers=?context.providers,
            "Provider normalization complete"
        );

        // Instantiate WASM component
        tracing::debug!(request_id=%request_id, "Instantiating WASM component in Wasmtime");
        let (mut store, component, linker) = self.instantiate(wasm, timeout_ms, memory_mb).await?;
        tracing::debug!(request_id=%request_id, "WASM component instantiated successfully");

        // Set execution context
        store.data_mut().context = context;
        tracing::debug!(request_id=%request_id, "Host execution context attached to store");

        // Pre-instantiate component
        tracing::debug!(request_id=%request_id, "Pre-instantiating component for execution");
        let instance_pre = linker.instantiate_pre(&component)?;
        tracing::debug!(request_id=%request_id, "Component pre-instantiation complete");

        // Instantiate the component
        tracing::debug!(request_id=%request_id, "Instantiating component instance");
        let instance = instance_pre.instantiate_async(&mut store).await?;
        tracing::debug!(request_id=%request_id, "Component instance created");

        // Get the handler function
        tracing::debug!(request_id=%request_id, "Resolving 'handler' function export");
        let handler = instance.get_typed_func::<
            (&component::alga::extension::types::ExecuteRequest,),
            (component::alga::extension::types::ExecuteResponse,),
        >(&mut store, "handler")?;
        tracing::debug!(request_id=%request_id, "Handler function resolved successfully");

        // Convert request to component format
        tracing::debug!(request_id=%request_id, "Converting request to component format");
        let input = to_component_execute_request(request)?;
        tracing::debug!(request_id=%request_id, "Request conversion complete");

        // Call the handler
        tracing::debug!(request_id=%request_id, "Calling extension handler function");
        let result = handler.call_async(&mut store, (&input,)).await;

        let (output,) = match result {
            Ok(v) => {
                tracing::debug!(request_id=%request_id, "Extension handler executed successfully");
                v
            }
            Err(e) => {
                tracing::error!(request_id=%request_id, error_debug=?e, "Extension handler execution failed");
                tracing::error!(request_id=%request_id, error_display=%e.to_string(), "Handler error details");
                return Err(e.into());
            }
        };

        // Convert response back to model format
        tracing::debug!(request_id=%request_id, "Converting response from component format");
        let response = to_model_execute_response(output);
        tracing::debug!(request_id=%request_id, status=%response.status, "Extension execution complete - response ready");

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
    tracing::info!(expected_hash=%expected_lower, bundle_url=%crate::engine::host_api::redact_url_query(&url.to_string()), "Bundle archive download and hash verification started");
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

    // STORAGE_S3_* is the documented runner config (shared with the server);
    // S3_* / MINIO_* are kept for existing local setups. The precedence winner
    // for each credential is named in the log so a mixed setup is diagnosable.
    let access = first_env_named(&["STORAGE_S3_ACCESS_KEY", "S3_ACCESS_KEY", "MINIO_ACCESS_KEY"]);
    let secret = first_env_named(&["STORAGE_S3_SECRET_KEY", "S3_SECRET_KEY", "MINIO_SECRET_KEY"]);
    if let (Ok(base), Some((access_name, access_value)), Some((secret_name, secret_value))) =
        (std::env::var("BUNDLE_STORE_BASE"), access.as_ref(), secret.as_ref())
    {
        tracing::info!(
            expected_hash=%expected_lower,
            access_key_var=%access_name,
            secret_key_var=%secret_name,
            "S3/MinIO credentials detected - attempting presigned URL generation"
        );
        let access = access_value.clone();
        let secret = secret_value.clone();
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
                    let region = first_env(&["STORAGE_S3_REGION", "S3_REGION"])
                        .unwrap_or_else(|| "us-east-1".to_string());
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

    tracing::info!(expected_hash=%expected_lower, download_url=%crate::engine::host_api::redact_url_query(&fetch_url.to_string()), "Starting bundle download");

    let mut resp = client.get(fetch_url.clone()).send().await?;
    if !resp.status().is_success() {
        tracing::error!(expected_hash=%expected_lower, status=%resp.status().as_u16(), download_url=%crate::engine::host_api::redact_url_query(&fetch_url.to_string()), "Bundle download failed with non-success HTTP status");
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
        tracing::error!(expected=%expected_lower, computed=%got, bytes=total, download_url=%crate::engine::host_api::redact_url_query(&url.to_string()), "HASH_MISMATCH: Bundle integrity check failed");
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
    tracing::info!(hash=%normalized_hash, object_key=%object_key, url=%crate::engine::host_api::redact_url_query(&url.to_string()), "Bundle archive fetch start");
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

/// First of `names` that is set to a non-blank value.
fn first_env(names: &[&str]) -> Option<String> {
    first_env_named(names).map(|(_, value)| value)
}

/// First of `names` set to a non-blank value, paired with the variable name it
/// came from so the precedence winner can be named in logs (STORAGE_S3_*
/// outranks the legacy S3_*/MINIO_* names when both are set).
fn first_env_named(names: &[&str]) -> Option<(String, String)> {
    names.iter().find_map(|name| {
        std::env::var(name)
            .ok()
            .filter(|value| !value.trim().is_empty())
            .map(|value| (name.to_string(), value))
    })
}

/// Parse a usize env override; falls back to `default` when unset, blank, or invalid.
fn env_usize(name: &str, default: usize) -> usize {
    std::env::var(name)
        .ok()
        .and_then(|value| value.trim().parse::<usize>().ok())
        .unwrap_or(default)
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

    #[test]
    fn env_usize_falls_back_on_missing_or_invalid_values() {
        std::env::remove_var("ALGA_TEST_USIZE_SIZE");
        assert_eq!(env_usize("ALGA_TEST_USIZE_SIZE", 7), 7);
        std::env::set_var("ALGA_TEST_USIZE_SIZE", " 12 ");
        assert_eq!(env_usize("ALGA_TEST_USIZE_SIZE", 7), 12);
        std::env::set_var("ALGA_TEST_USIZE_SIZE", "not-a-number");
        assert_eq!(env_usize("ALGA_TEST_USIZE_SIZE", 7), 7);
        std::env::remove_var("ALGA_TEST_USIZE_SIZE");
    }

    #[test]
    fn first_env_named_reports_the_precedence_winner() {
        let (a, b) = ("ALGA_TEST_NAMED_A", "ALGA_TEST_NAMED_B");
        std::env::remove_var(a);
        std::env::set_var(b, "from-b");
        assert_eq!(
            first_env_named(&[a, b]),
            Some((b.to_string(), "from-b".to_string()))
        );
        std::env::set_var(a, "from-a");
        assert_eq!(
            first_env_named(&[a, b]),
            Some((a.to_string(), "from-a".to_string()))
        );
        for name in [a, b] {
            std::env::remove_var(name);
        }
        assert_eq!(first_env_named(&[a, b]), None);
    }

    #[test]
    fn first_env_prefers_earlier_names_and_skips_blank_values() {
        let (a, b, c) = (
            "ALGA_TEST_FIRST_ENV_A",
            "ALGA_TEST_FIRST_ENV_B",
            "ALGA_TEST_FIRST_ENV_C",
        );
        std::env::remove_var(a);
        std::env::set_var(b, "  ");
        std::env::set_var(c, "from-c");
        assert_eq!(first_env(&[a, b, c]).as_deref(), Some("from-c"));

        std::env::set_var(a, "from-a");
        assert_eq!(first_env(&[a, b, c]).as_deref(), Some("from-a"));

        for name in [a, b, c] {
            std::env::remove_var(name);
        }
        assert_eq!(first_env(&[a, b, c]), None);
    }
}
