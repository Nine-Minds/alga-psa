// Weight-aware LRU bounding the runner's in-process caches.
//
// The shared ModuleLoader's module-bytes cache and compiled-component cache
// were plain HashMaps: every distinct content hash seen since boot pinned its
// entry forever, so superseded extension versions accumulated until the pod
// restarted. This LRU enforces an entry-count cap and a total-weight cap
// (bytes for the module cache, 1 per entry for the compiled cache), evicting
// least-recently-used entries first.
//
// Lookup is O(n) in the (small, tens-to-hundreds of entries) cap; these
// caches bound memory pressure rather than serve raw throughput, and a hit
// still short-circuits the fetch/compile work behind it.

use std::collections::{HashMap, VecDeque};
use std::hash::Hash;

pub struct LruCacheConfig {
    pub max_entries: usize,
    pub max_bytes: usize,
}

impl Default for LruCacheConfig {
    fn default() -> Self {
        Self {
            max_entries: usize::MAX,
            max_bytes: usize::MAX,
        }
    }
}

pub struct LruCache<K, V> {
    order: VecDeque<K>,
    entries: HashMap<K, (V, usize)>,
    cfg: LruCacheConfig,
    total_bytes: usize,
}

impl<K: Eq + Hash + Clone, V: Clone> LruCache<K, V> {
    pub fn new(cfg: LruCacheConfig) -> Self {
        Self {
            order: VecDeque::new(),
            entries: HashMap::new(),
            cfg,
            total_bytes: 0,
        }
    }

    /// Returns the value for `key` and marks it most-recently-used.
    pub fn get(&mut self, key: &K) -> Option<V> {
        let idx = self.order.iter().position(|k| k == key)?;
        let key = self.order.remove(idx)?;
        let entry = self.entries.get(&key)?.clone();
        self.order.push_back(key);
        Some(entry.0)
    }

    /// Inserts `value` with the given `weight`, then evicts LRU entries until
    /// both caps hold. Returns the evicted keys. A single value heavier than
    /// the byte cap is not cached — it would evict everything on arrival.
    pub fn insert(&mut self, key: K, value: V, weight: usize) -> Vec<K> {
        if weight > self.cfg.max_bytes {
            return Vec::new();
        }
        if let Some((_, prev_weight)) = self.entries.remove(&key) {
            self.total_bytes = self.total_bytes.saturating_sub(prev_weight);
            self.order.retain(|k| k != &key);
        }
        self.order.push_back(key.clone());
        self.total_bytes += weight;
        self.entries.insert(key, (value, weight));

        let mut evicted = Vec::new();
        while self.entries.len() > self.cfg.max_entries || self.total_bytes > self.cfg.max_bytes {
            match self.order.pop_front() {
                Some(old) => {
                    if let Some((_, w)) = self.entries.remove(&old) {
                        self.total_bytes = self.total_bytes.saturating_sub(w);
                    }
                    evicted.push(old);
                }
                None => break,
            }
        }
        evicted
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn total_bytes(&self) -> usize {
        self.total_bytes
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn capped(max_entries: usize, max_bytes: usize) -> LruCache<String, Vec<u8>> {
        LruCache::new(LruCacheConfig {
            max_entries,
            max_bytes,
        })
    }

    #[test]
    fn evicts_least_recently_used_first() {
        let mut lru = capped(2, usize::MAX);
        lru.insert("a".into(), vec![1], 1);
        lru.insert("b".into(), vec![2], 1);
        // Touching "a" makes "b" the oldest.
        assert!(lru.get(&"a".to_string()).is_some());
        let evicted = lru.insert("c".into(), vec![3], 1);
        assert_eq!(evicted, vec!["b".to_string()]);
        assert!(lru.get(&"b".to_string()).is_none());
        assert!(lru.get(&"a".to_string()).is_some());
        assert!(lru.get(&"c".to_string()).is_some());
        assert_eq!(lru.len(), 2);
    }

    #[test]
    fn evicts_to_byte_budget_oldest_first() {
        let mut lru = capped(100, 10);
        lru.insert("a".into(), vec![0; 4], 4);
        lru.insert("b".into(), vec![0; 4], 4);
        let evicted = lru.insert("c".into(), vec![0; 4], 4);
        assert_eq!(evicted, vec!["a".to_string()]);
        assert_eq!(lru.total_bytes(), 8);
    }

    #[test]
    fn oversized_value_is_not_cached() {
        let mut lru = capped(2, 10);
        let evicted = lru.insert("big".into(), vec![0; 11], 11);
        assert!(evicted.is_empty());
        assert!(lru.is_empty());
        assert_eq!(lru.total_bytes(), 0);
    }

    #[test]
    fn reinsert_updates_weight_without_duplicates() {
        let mut lru = capped(2, 10);
        lru.insert("a".into(), vec![0; 2], 3);
        lru.insert("a".into(), vec![0; 6], 8);
        assert_eq!(lru.len(), 1);
        assert_eq!(lru.total_bytes(), 8);
        assert_eq!(lru.get(&"a".to_string()).map(|v| v.len()), Some(6));
    }

    #[test]
    fn zero_entry_cap_caches_nothing() {
        let mut lru = capped(0, usize::MAX);
        let evicted = lru.insert("a".into(), vec![1], 1);
        assert_eq!(evicted, vec!["a".to_string()]);
        assert!(lru.is_empty());
    }
}
