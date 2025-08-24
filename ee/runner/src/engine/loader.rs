// Wasmtime engine configuration, module fetch/cache, and instantiation
use wasmtime::{Config, Engine, Store, Module, Linker, ResourceLimiter, InstanceAllocationStrategy, PoolingAllocationConfig, Instance};
use reqwest::Client;
use std::env;
use std::time::Duration;
use std::sync::Arc;
use tokio::sync::RwLock;
use std::collections::HashMap;
use std::path::Path;

use super::host_api::{add_host_imports, HostApiConfig};
use url::Url;
use tokio_util::io::StreamReader;
use tokio::io::AsyncReadExt as _;
use crate::cache::fs as cache_fs;
use aws_sdk_s3::{Client as S3Client, config as s3config};
use aws_credential_types::Credentials as AwsCredentials;

pub struct ModuleLoader {
    pub engine: Engine,
    http: Client,
    cache: Arc<RwLock<HashMap<String, Arc<Vec<u8>>>>>,
}

pub(crate) struct Limits {
    max_memory: usize,
}

impl ResourceLimiter for Limits {
    fn memory_growing(&mut self, _current: usize, desired: usize, _maximum: Option<usize>) -> Result<bool, wasmtime::Error> {
        Ok(desired <= self.max_memory)
    }
    fn table_growing(&mut self, _current: u32, _desired: u32, _maximum: Option<u32>) -> Result<bool, wasmtime::Error> { Ok(true) }
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
            .parallel_compilation(true)
            // Use static memories up to 256 MiB per memory (adjustable later)
            .static_memory_maximum_size(256 << 20)
            .static_memory_guard_size(1 << 31) // 2 GiB guard on 64-bit hosts
            .dynamic_memory_guard_size(64 << 10); // 64 KiB for dynamic

        // Configure pooling allocator with conservative defaults
        let mut pool = PoolingAllocationConfig::default();
        pool.total_core_instances(256)
            .total_memories(256)
            .total_tables(256)
            .total_stacks(512)
            .max_core_instance_size(1 << 20)
            .max_component_instance_size(1 << 20)
            // Limit per-memory committed pages (64KiB/page). 256 pages ~= 16 MiB committed cap per instance memory
            .memory_pages(256)
            // Keep small resident regions to avoid page thrash without bloating RSS
            .linear_memory_keep_resident(0)
            .table_keep_resident(0);
        cfg.allocation_strategy(InstanceAllocationStrategy::Pooling(pool));

        let engine = Engine::new(&cfg)?;
        let http = Client::builder().build()?;
        Ok(Self { engine, http, cache: Arc::new(RwLock::new(HashMap::new())) })
    }

    pub fn instantiate(&self, wasm: &[u8], timeout_ms: Option<u64>, memory_mb: Option<u64>) -> anyhow::Result<(Store<Limits>, Linker<Limits>, Module)> {
        let module = Module::new(&self.engine, wasm)?;
        let limits = Limits { max_memory: (memory_mb.unwrap_or(256) as usize) * 1024 * 1024 };
        let mut store = Store::new(&self.engine, limits);

        // Apply store-level resource limits if needed
        store.limiter(|s| s);

        if let Some(ms) = timeout_ms { self.apply_timeout(&mut store, ms); }
        let mut linker: Linker<Limits> = Linker::new(&self.engine);
        // Add host imports
        let host_cfg = HostApiConfig {
            egress_allowlist: std::env::var("EXT_EGRESS_ALLOWLIST").ok()
                .map(|s| s.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect())
                .unwrap_or_default(),
        };
        add_host_imports(&mut linker, &host_cfg)?;
        Ok((store, linker, module))
    }

    fn apply_timeout(&self, store: &mut Store<Limits>, ms: u64) {
        // Use epoch-based interruption. Map ms to ticks by incrementing the engine epoch every 10ms.
        let tick_ms: u64 = 10;
        let ticks = (ms / tick_ms).max(1);
        store.set_epoch_deadline(ticks);
        // For async configs, yield and update to continue if host wants to resume (not used yet)
        let _ = store.epoch_deadline_trap();

        // Spawn a background task to bump the engine epoch periodically until the deadline is likely reached.
        let engine = self.engine.clone();
        tokio::spawn(async move {
            let steps = ticks + 2;
            for _ in 0..steps {
                tokio::time::sleep(Duration::from_millis(tick_ms)).await;
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
        let url = format!("{}/{}", base.trim_end_matches('/'), key.trim_start_matches('/'));
        let resp = self.http.get(url).send().await?;
        if !resp.status().is_success() {
            anyhow::bail!("fetch failed: {}", resp.status());
        }
        let bytes = resp.bytes().await?.to_vec();
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

    pub fn execute_handler(&self, wasm: &[u8], timeout_ms: Option<u64>, memory_mb: Option<u64>, input: &[u8]) -> anyhow::Result<Vec<u8>> {
        let (mut store, mut linker, module) = self.instantiate(wasm, timeout_ms, memory_mb)?;
        let instance = linker.instantiate(&mut store, &module)?;
        // Resolve exports
        let memory = instance.get_memory(&mut store, "memory").ok_or_else(|| anyhow::anyhow!("no memory export"))?;
        let alloc = instance.get_func(&mut store, "alloc").ok_or_else(|| anyhow::anyhow!("no alloc export"))?;
        let dealloc = instance.get_func(&mut store, "dealloc");
        let handler = instance.get_func(&mut store, "handler").ok_or_else(|| anyhow::anyhow!("no handler export"))?;
        // allocate input
        let a = alloc.typed::<i32, i32>(&store)?;
        let in_ptr = a.call(&mut store, input.len() as i32)?;
        let data = memory.data_mut(&mut store);
        let istart = in_ptr as usize;
        let iend = istart.saturating_add(input.len());
        if iend > data.len() { anyhow::bail!("input oob"); }
        data[istart..iend].copy_from_slice(input);
        // allocate out tuple (ptr,len)
        let out_tuple_ptr = a.call(&mut store, 8)?;
        // call handler(req_ptr, req_len, out_ptr) -> i32
        let h = handler.typed::<(i32,i32,i32), i32>(&store)?;
        let rc = h.call(&mut store, (in_ptr, input.len() as i32, out_tuple_ptr))?;
        if rc != 0 { anyhow::bail!("handler error: {}", rc); }
        // read out tuple
        let data = memory.data(&store);
        let ostart = out_tuple_ptr as usize;
        if ostart + 8 > data.len() { anyhow::bail!("out oob"); }
        let resp_ptr = i32::from_le_bytes(data[ostart..ostart+4].try_into().unwrap()) as usize;
        let resp_len = u32::from_le_bytes(data[ostart+4..ostart+8].try_into().unwrap()) as usize;
        if resp_ptr + resp_len > data.len() { anyhow::bail!("resp oob"); }
        let mut out = vec![0u8; resp_len];
        out.copy_from_slice(&data[resp_ptr..resp_ptr+resp_len]);
        // free if dealloc exists
        if let Some(f) = dealloc {
            if let Ok(free) = f.typed::<(i32,i32), ()>(&store) {
                let _ = free.call(&mut store, (in_ptr, input.len() as i32));
                let _ = free.call(&mut store, (resp_ptr as i32, resp_len as i32));
                let _ = free.call(&mut store, (out_tuple_ptr, 8));
            }
        }
        Ok(out)
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

/// Stream a bundle archive to a temp file while computing sha256, verifying against expected hex.
/// On success returns the path to the temp file. On mismatch deletes the temp and returns IntegrityError::ArchiveHashMismatch.
pub async fn verify_archive_sha256(url: &Url, expected_hex: &str) -> anyhow::Result<std::path::PathBuf> {
    use sha2::{Digest, Sha256};
    use tokio::fs as tfs;
    use tokio::io::AsyncWriteExt;
    use rand::{distributions::Alphanumeric, Rng};

    let expected_lower = expected_hex.to_ascii_lowercase();
    tracing::info!(expected_hash=%expected_lower, url=%url.to_string(), "verify archive start");
    let cache_root = cache_fs::ext_cache_root_from_env();
    let tmp_dir = cache_root.join("tmp");
    cache_fs::ensure_dir(&tmp_dir).await?;
    let rand_suffix: String = rand::thread_rng().sample_iter(&Alphanumeric).take(6).map(char::from).collect();
    let tmp_path = tmp_dir.join(format!("{}.{}.tar.zst", expected_lower, rand_suffix));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()?;

    // Prefer presigned S3 GET if credentials are available; fallback to direct URL
    let mut fetch_url = url.clone();
    if let (Ok(base), Some(access), Some(secret)) = (
        std::env::var("BUNDLE_STORE_BASE"),
        std::env::var("S3_ACCESS_KEY").ok().or_else(|| std::env::var("MINIO_ACCESS_KEY").ok()),
        std::env::var("S3_SECRET_KEY").ok().or_else(|| std::env::var("MINIO_SECRET_KEY").ok()),
    ) {
        if let Ok(base_url) = Url::parse(&base) {
            let bucket = base_url.path().trim_matches('/').split('/').next().unwrap_or("");
            if !bucket.is_empty() {
                let endpoint = match (base_url.scheme(), base_url.host_str(), base_url.port()) {
                    (scheme, Some(host), Some(port)) => format!("{}://{}:{}", scheme, host, port),
                    (scheme, Some(host), None) => format!("{}://{}", scheme, host),
                    _ => String::new(),
                };
                if !endpoint.is_empty() {
                    let region = std::env::var("S3_REGION").unwrap_or_else(|_| "us-east-1".to_string());
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
                    let key = format!("sha256/{}/bundle.tar.zst", expected_lower);
                    if let Ok(cfg) = aws_sdk_s3::presigning::PresigningConfig::expires_in(Duration::from_secs(60)) {
                        match s3.get_object().bucket(bucket).key(&key).presigned(cfg).await {
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
        }.into());
    }
    tracing::info!(hash=%expected_lower, bytes=total, path=%tmp_path.to_string_lossy(), "verify archive ok");
    Ok(tmp_path)
}
