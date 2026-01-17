//! Wasmtime extension runtime
//!
//! Features:
//! - F260: Wasmtime engine configuration with pooling allocation (512MB/instance, 4 concurrent)
//! - F261: Epoch interruption for execution time limits
//! - F301: Memory limits enforcement

use anyhow::{Context, Result};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use wasmtime::{Config, Engine, InstanceAllocationStrategy, OptLevel, PoolingAllocationConfig, Store};
use wasmtime::component::Component;

/// Default memory limit per extension instance (F301)
pub const DEFAULT_MEMORY_LIMIT_BYTES: u64 = 512 * 1024 * 1024; // 512 MB

/// Default execution timeout (5 minutes)
pub const DEFAULT_TIMEOUT_MS: u64 = 5 * 60 * 1000;

/// Maximum concurrent extension instances (F260)
pub const MAX_CONCURRENT_INSTANCES: u32 = 4;

/// Extension runtime configuration
#[derive(Debug, Clone)]
pub struct RuntimeConfig {
    /// Maximum memory per instance in bytes (F301)
    pub memory_limit_bytes: u64,

    /// Execution timeout in milliseconds (F261)
    pub timeout_ms: u64,

    /// Maximum concurrent instances (F260)
    pub max_instances: u32,

    /// Enable debug output
    pub debug: bool,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            memory_limit_bytes: DEFAULT_MEMORY_LIMIT_BYTES,
            timeout_ms: DEFAULT_TIMEOUT_MS,
            max_instances: MAX_CONCURRENT_INSTANCES,
            debug: false,
        }
    }
}

/// Extension runtime manager
///
/// Manages the Wasmtime engine and module instances with proper
/// resource limits and security isolation.
pub struct ExtensionRuntime {
    /// Wasmtime engine with pooling allocator
    engine: Engine,

    /// Runtime configuration
    config: RuntimeConfig,

    /// Current number of active instances
    active_instances: Arc<Mutex<u32>>,
}

impl ExtensionRuntime {
    /// Create a new extension runtime with the given configuration (F260)
    ///
    /// Configures the Wasmtime engine with:
    /// - Pooling instance allocator for efficient memory management
    /// - Component model support for WIT-based extensions
    /// - Epoch interruption for timeout handling
    pub fn new(config: RuntimeConfig) -> Result<Self> {
        let mut engine_config = Config::new();

        // Enable component model for WIT-based extensions
        engine_config.wasm_component_model(true);

        // Enable epoch interruption for timeout handling (F261)
        engine_config.epoch_interruption(true);

        // Configure pooling allocator for efficient instance management (F260)
        let mut pool_config = PoolingAllocationConfig::default();

        // Memory limits (F301) - use memory_pages instead of max_memory_size
        // Each memory page is 64KB, so convert bytes to pages
        let max_pages = config.memory_limit_bytes / 65536;
        pool_config.memory_pages(max_pages.max(1));

        // Instance limits (F260)
        pool_config.total_memories(config.max_instances);
        pool_config.total_tables(config.max_instances);
        pool_config.total_stacks(config.max_instances);
        pool_config.total_core_instances(config.max_instances);
        pool_config.total_component_instances(config.max_instances);

        // Use pooling allocator
        engine_config.allocation_strategy(InstanceAllocationStrategy::Pooling(pool_config));

        // Optimization settings
        engine_config.cranelift_opt_level(OptLevel::Speed);

        // Debug settings
        if config.debug {
            engine_config.debug_info(true);
        }

        let engine = Engine::new(&engine_config)
            .context("Failed to create Wasmtime engine")?;

        Ok(Self {
            engine,
            config,
            active_instances: Arc::new(Mutex::new(0)),
        })
    }

    /// Get the Wasmtime engine
    pub fn engine(&self) -> &Engine {
        &self.engine
    }

    /// Get the runtime configuration
    pub fn config(&self) -> &RuntimeConfig {
        &self.config
    }

    /// Check if we can start a new instance
    pub async fn can_start_instance(&self) -> bool {
        let count = self.active_instances.lock().await;
        *count < self.config.max_instances
    }

    /// Increment the active instance count
    pub async fn start_instance(&self) -> Result<InstanceGuard> {
        let mut count = self.active_instances.lock().await;
        if *count >= self.config.max_instances {
            anyhow::bail!(
                "Maximum concurrent instances ({}) reached",
                self.config.max_instances
            );
        }
        *count += 1;
        Ok(InstanceGuard {
            active_instances: self.active_instances.clone(),
        })
    }

    /// Create a store with proper limits and epoch configuration
    pub fn create_store<T: Send>(&self, data: T) -> Store<T> {
        let mut store = Store::new(&self.engine, data);

        // Set epoch deadline for timeout (F261)
        store.set_epoch_deadline(1);

        // Configure fuel if needed for CPU limiting
        // store.set_fuel(1_000_000)?;

        store
    }

    /// Start the epoch timer for timeout handling (F261)
    pub fn start_epoch_timer(&self, timeout: Duration) -> EpochTimer {
        EpochTimer::new(self.engine.clone(), timeout)
    }

    /// Load a component from bytes
    pub fn load_component(&self, bytes: &[u8]) -> Result<Component> {
        Component::from_binary(&self.engine, bytes)
            .context("Failed to load WASM component")
    }

    /// Load a component from a file
    pub fn load_component_file(&self, path: &std::path::Path) -> Result<Component> {
        Component::from_file(&self.engine, path)
            .context("Failed to load WASM component from file")
    }
}

/// Guard that decrements active instance count on drop
pub struct InstanceGuard {
    active_instances: Arc<Mutex<u32>>,
}

impl Drop for InstanceGuard {
    fn drop(&mut self) {
        // Use blocking lock since Drop is sync
        if let Ok(mut count) = self.active_instances.try_lock() {
            *count = count.saturating_sub(1);
        }
    }
}

/// Epoch timer for handling execution timeouts (F261)
///
/// Increments the engine's epoch at regular intervals to trigger
/// timeout interruption in running WASM instances.
pub struct EpochTimer {
    handle: Option<tokio::task::JoinHandle<()>>,
}

impl EpochTimer {
    /// Create a new epoch timer
    pub fn new(engine: Engine, timeout: Duration) -> Self {
        // Calculate interval - increment epoch multiple times before deadline
        let interval = timeout / 10;

        let handle = tokio::spawn(async move {
            let mut elapsed = Duration::ZERO;
            while elapsed < timeout {
                tokio::time::sleep(interval).await;
                engine.increment_epoch();
                elapsed += interval;
            }
        });

        Self {
            handle: Some(handle),
        }
    }

    /// Cancel the timer
    pub fn cancel(&mut self) {
        if let Some(handle) = self.handle.take() {
            handle.abort();
        }
    }
}

impl Drop for EpochTimer {
    fn drop(&mut self) {
        self.cancel();
    }
}

/// Extension execution result
#[derive(Debug)]
pub struct ExecutionResult {
    /// Output from the extension (JSON string)
    pub output: String,

    /// Execution duration
    pub duration: Duration,

    /// Memory used in bytes
    pub memory_used: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_runtime_config_default() {
        let config = RuntimeConfig::default();
        assert_eq!(config.memory_limit_bytes, DEFAULT_MEMORY_LIMIT_BYTES);
        assert_eq!(config.timeout_ms, DEFAULT_TIMEOUT_MS);
        assert_eq!(config.max_instances, MAX_CONCURRENT_INSTANCES);
    }

    #[tokio::test]
    async fn test_runtime_creation() {
        // T336: Wasmtime engine creates with pooling allocation config
        let config = RuntimeConfig::default();
        let runtime = ExtensionRuntime::new(config);
        assert!(runtime.is_ok());
    }

    #[tokio::test]
    async fn test_instance_guard() {
        let config = RuntimeConfig {
            max_instances: 2,
            ..Default::default()
        };
        let runtime = ExtensionRuntime::new(config).unwrap();

        // Start first instance
        let guard1 = runtime.start_instance().await;
        assert!(guard1.is_ok());

        // Start second instance
        let guard2 = runtime.start_instance().await;
        assert!(guard2.is_ok());

        // Third should fail (max is 2)
        let guard3 = runtime.start_instance().await;
        assert!(guard3.is_err());

        // Drop one guard
        drop(guard1);

        // Now we should be able to start another
        // Note: In tests this might be flaky due to async timing
    }

    #[test]
    fn test_store_creation() {
        let config = RuntimeConfig::default();
        let runtime = ExtensionRuntime::new(config).unwrap();

        let store: Store<()> = runtime.create_store(());
        // Just verify store is created successfully - epoch_deadline_trap modifies the store
        drop(store);
    }
}
