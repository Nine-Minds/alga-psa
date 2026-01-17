//! Extension bundle loading and caching
//!
//! Features:
//! - F280: Fetch bundle from object storage on cache miss
//! - F281: Verify bundle signature and content hash
//! - F282: Invalidate cache on version_id change

use anyhow::{Context, Result};
use sha2::{Sha256, Digest};
use std::path::{Path, PathBuf};
use tokio::fs;
use tokio::io::AsyncWriteExt;

use crate::platform::cache::{get_cache_dir, CacheEntry};

/// Extension manifest from the server
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ExtensionManifest {
    /// Extension ID
    pub extension_id: String,

    /// Version ID (changes on each update)
    pub version_id: String,

    /// Content hash (SHA-256 of the WASM bytes)
    pub content_hash: String,

    /// Download URL for the bundle
    pub download_url: String,

    /// File size in bytes
    pub size_bytes: u64,

    /// Signature (optional, for verification)
    pub signature: Option<String>,
}

/// Extension loader for fetching and caching bundles
pub struct ExtensionLoader {
    /// HTTP client for downloading bundles
    client: reqwest::Client,

    /// Cache directory
    cache_dir: PathBuf,
}

impl ExtensionLoader {
    /// Create a new extension loader
    pub fn new() -> Result<Self> {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(300)) // 5 minute timeout for downloads
            .build()
            .context("Failed to create HTTP client")?;

        let cache_dir = get_cache_dir();

        Ok(Self { client, cache_dir })
    }

    /// Load an extension, using cache if available (F280, F282)
    ///
    /// 1. Check if the extension is cached with the correct version
    /// 2. If cached and valid, return the cached bytes
    /// 3. If not cached or version mismatch, download and cache
    pub async fn load_extension(&self, manifest: &ExtensionManifest) -> Result<Vec<u8>> {
        // Check cache first
        if let Some(bytes) = self.try_load_from_cache(manifest).await? {
            tracing::info!(
                extension_id = %manifest.extension_id,
                version_id = %manifest.version_id,
                "Loaded extension from cache"
            );
            return Ok(bytes);
        }

        // Cache miss - download the bundle (F280)
        tracing::info!(
            extension_id = %manifest.extension_id,
            version_id = %manifest.version_id,
            url = %manifest.download_url,
            "Downloading extension bundle"
        );

        let bytes = self.download_bundle(manifest).await?;

        // Verify the bundle (F281)
        self.verify_bundle(&bytes, manifest)?;

        // Cache the bundle
        self.cache_bundle(manifest, &bytes).await?;

        Ok(bytes)
    }

    /// Try to load from cache (F282 - checks version_id)
    async fn try_load_from_cache(&self, manifest: &ExtensionManifest) -> Result<Option<Vec<u8>>> {
        let cache_path = self.get_cache_path(&manifest.extension_id, &manifest.version_id);
        let meta_path = self.get_meta_path(&manifest.extension_id);

        // Check if cache file exists
        if !cache_path.exists() {
            return Ok(None);
        }

        // Load and verify metadata
        if let Ok(meta_bytes) = fs::read(&meta_path).await {
            if let Ok(entry) = serde_json::from_slice::<CacheEntry>(&meta_bytes) {
                // F282: Check version_id matches (invalidate on version change)
                if entry.version_id != manifest.version_id {
                    tracing::debug!(
                        extension_id = %manifest.extension_id,
                        cached_version = %entry.version_id,
                        expected_version = %manifest.version_id,
                        "Cache invalidated due to version change"
                    );
                    // Remove old cache
                    let _ = fs::remove_file(&cache_path).await;
                    let _ = fs::remove_file(&meta_path).await;
                    return Ok(None);
                }

                // Check content hash matches
                if entry.content_hash != manifest.content_hash {
                    tracing::warn!(
                        extension_id = %manifest.extension_id,
                        "Cache invalidated due to hash mismatch"
                    );
                    let _ = fs::remove_file(&cache_path).await;
                    let _ = fs::remove_file(&meta_path).await;
                    return Ok(None);
                }
            }
        }

        // Read and return cached bytes
        match fs::read(&cache_path).await {
            Ok(bytes) => {
                // Verify hash of cached bytes (F281)
                let hash = self.compute_hash(&bytes);
                if hash != manifest.content_hash {
                    tracing::warn!("Cached file hash mismatch, re-downloading");
                    let _ = fs::remove_file(&cache_path).await;
                    return Ok(None);
                }
                Ok(Some(bytes))
            }
            Err(_) => Ok(None),
        }
    }

    /// Download bundle from server (F280)
    async fn download_bundle(&self, manifest: &ExtensionManifest) -> Result<Vec<u8>> {
        let response = self
            .client
            .get(&manifest.download_url)
            .send()
            .await
            .context("Failed to download extension bundle")?;

        if !response.status().is_success() {
            anyhow::bail!(
                "Failed to download extension: HTTP {}",
                response.status()
            );
        }

        let bytes = response
            .bytes()
            .await
            .context("Failed to read extension bytes")?;

        // Check size matches
        if bytes.len() as u64 != manifest.size_bytes {
            anyhow::bail!(
                "Downloaded bundle size mismatch: expected {} bytes, got {} bytes",
                manifest.size_bytes,
                bytes.len()
            );
        }

        Ok(bytes.to_vec())
    }

    /// Verify bundle signature and hash (F281)
    fn verify_bundle(&self, bytes: &[u8], manifest: &ExtensionManifest) -> Result<()> {
        // T371: Verify content hash
        let hash = self.compute_hash(bytes);
        if hash != manifest.content_hash {
            anyhow::bail!(
                "Bundle hash mismatch: expected {}, got {}",
                manifest.content_hash,
                hash
            );
        }

        // T369, T370: Verify signature if provided
        if let Some(signature) = &manifest.signature {
            self.verify_signature(bytes, signature)?;
        }

        Ok(())
    }

    /// Compute SHA-256 hash of bytes
    fn compute_hash(&self, bytes: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        let result = hasher.finalize();
        hex::encode(result)
    }

    /// Verify cryptographic signature (F281)
    fn verify_signature(&self, _bytes: &[u8], _signature: &str) -> Result<()> {
        // TODO: Implement actual signature verification using ring
        // For now, accept any signature if present
        // In production, this would verify against a public key
        tracing::debug!("Signature verification placeholder - implement with ring crate");
        Ok(())
    }

    /// Cache the bundle to disk
    async fn cache_bundle(&self, manifest: &ExtensionManifest, bytes: &[u8]) -> Result<()> {
        let cache_path = self.get_cache_path(&manifest.extension_id, &manifest.version_id);
        let meta_path = self.get_meta_path(&manifest.extension_id);

        // Ensure cache directory exists
        if let Some(parent) = cache_path.parent() {
            fs::create_dir_all(parent)
                .await
                .context("Failed to create cache directory")?;
        }

        // Write the WASM bytes
        let mut file = fs::File::create(&cache_path)
            .await
            .context("Failed to create cache file")?;

        file.write_all(bytes)
            .await
            .context("Failed to write cache file")?;

        file.flush().await?;

        // Write metadata
        let entry = CacheEntry {
            extension_id: manifest.extension_id.clone(),
            version_id: manifest.version_id.clone(),
            content_hash: manifest.content_hash.clone(),
            wasm_path: cache_path.clone(),
            cached_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            size_bytes: bytes.len() as u64,
        };

        let meta_json = serde_json::to_vec_pretty(&entry)
            .context("Failed to serialize cache metadata")?;

        fs::write(&meta_path, &meta_json)
            .await
            .context("Failed to write cache metadata")?;

        tracing::info!(
            extension_id = %manifest.extension_id,
            version_id = %manifest.version_id,
            path = %cache_path.display(),
            size = bytes.len(),
            "Cached extension bundle"
        );

        Ok(())
    }

    /// Get the cache path for an extension
    fn get_cache_path(&self, extension_id: &str, version_id: &str) -> PathBuf {
        self.cache_dir
            .join(extension_id)
            .join(format!("{}.wasm", version_id))
    }

    /// Get the metadata path for an extension
    fn get_meta_path(&self, extension_id: &str) -> PathBuf {
        self.cache_dir
            .join(extension_id)
            .join("metadata.json")
    }

    /// Clear the cache for a specific extension
    pub async fn clear_cache(&self, extension_id: &str) -> Result<()> {
        let ext_dir = self.cache_dir.join(extension_id);
        if ext_dir.exists() {
            fs::remove_dir_all(&ext_dir)
                .await
                .context("Failed to clear extension cache")?;
        }
        Ok(())
    }

    /// Get cache statistics
    pub async fn get_cache_stats(&self) -> Result<CacheStats> {
        let mut stats = CacheStats::default();

        if !self.cache_dir.exists() {
            return Ok(stats);
        }

        let mut entries = fs::read_dir(&self.cache_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            if entry.file_type().await?.is_dir() {
                stats.extension_count += 1;

                let mut ext_entries = fs::read_dir(entry.path()).await?;
                while let Some(ext_entry) = ext_entries.next_entry().await? {
                    if ext_entry.path().extension().map(|e| e == "wasm").unwrap_or(false) {
                        if let Ok(meta) = ext_entry.metadata().await {
                            stats.total_size_bytes += meta.len();
                            stats.file_count += 1;
                        }
                    }
                }
            }
        }

        Ok(stats)
    }
}

/// Cache statistics
#[derive(Debug, Default)]
pub struct CacheStats {
    /// Number of cached extensions
    pub extension_count: u64,

    /// Number of WASM files
    pub file_count: u64,

    /// Total size in bytes
    pub total_size_bytes: u64,
}

// Add hex encoding dependency
mod hex {
    pub fn encode(bytes: impl AsRef<[u8]>) -> String {
        bytes.as_ref().iter().map(|b| format!("{:02x}", b)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_hash() {
        let loader = ExtensionLoader {
            client: reqwest::Client::new(),
            cache_dir: PathBuf::from("/tmp/test-cache"),
        };

        let hash = loader.compute_hash(b"test content");
        assert!(!hash.is_empty());
        assert_eq!(hash.len(), 64); // SHA-256 produces 64 hex characters
    }

    #[test]
    fn test_cache_paths() {
        let loader = ExtensionLoader {
            client: reqwest::Client::new(),
            cache_dir: PathBuf::from("/cache"),
        };

        let cache_path = loader.get_cache_path("test-ext", "v1.0.0");
        assert!(cache_path.to_string_lossy().contains("test-ext"));
        assert!(cache_path.to_string_lossy().contains("v1.0.0"));
        assert!(cache_path.to_string_lossy().ends_with(".wasm"));

        let meta_path = loader.get_meta_path("test-ext");
        assert!(meta_path.to_string_lossy().contains("test-ext"));
        assert!(meta_path.to_string_lossy().contains("metadata.json"));
    }
}
