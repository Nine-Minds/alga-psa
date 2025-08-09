// Wasmtime engine configuration, module fetch/cache, and instantiation
use wasmtime::{Config, Engine, Store, Module, Linker, ResourceLimiter, InstanceAllocationStrategy, PoolingAllocationConfig, Instance};
use reqwest::Client;
use std::env;
use std::time::Duration;
use std::sync::Arc;
use tokio::sync::RwLock;
use std::collections::HashMap;

use super::host_api::{add_host_imports, HostApiConfig};

pub struct ModuleLoader {
    pub engine: Engine,
    http: Client,
    cache: Arc<RwLock<HashMap<String, Arc<Vec<u8>>>>>,
}

struct Limits {
    max_memory: usize,
}

impl ResourceLimiter for Limits {
    fn memory_growing(&mut self, _current: usize, desired: usize, _maximum: Option<usize>) -> bool {
        desired <= self.max_memory
    }
    fn table_growing(&mut self, _current: u32, _desired: u32, _maximum: Option<u32>) -> bool { true }
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
        let host_cfg = HostApiConfig::default();
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
        // TODO: signature/hash verification here (trust bundle)
        let arc = Arc::new(bytes.clone());
        self.cache.write().await.insert(key.to_string(), arc);
        Ok(bytes)
    }

    pub fn instantiate_and_maybe_call(&self, wasm: &[u8], timeout_ms: Option<u64>, memory_mb: Option<u64>) -> anyhow::Result<Option<i32>> {
        let (mut store, mut linker, module) = self.instantiate(wasm, timeout_ms, memory_mb)?;
        let instance = linker.instantiate(&mut store, &module)?;
        // Try calling an optional exported function `handler` with no params -> i32
        if let Some(func) = instance.get_func(&mut store, "handler") {
            if let Ok(typed) = func.typed::<(), i32>(&store) {
                let result = typed.call(&mut store, ())?;
                return Ok(Some(result));
            }
        }
        Ok(None)
    }
}

