// Placeholder LRU cache for content-hash keyed files

pub struct LruCacheConfig {
    pub max_bytes: u64,
}

pub struct LruCache {
    #[allow(dead_code)]
    cfg: LruCacheConfig,
}

impl LruCache {
    pub fn new(cfg: LruCacheConfig) -> Self {
        Self { cfg }
    }
}
