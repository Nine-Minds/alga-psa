use anyhow::Result;
use std::env;
use std::path::{Path, PathBuf};
use tokio::fs;
use tokio::io::AsyncWriteExt;

/// Compute the UI cache directory for a given content hash (hex-only).
pub fn ui_cache_dir(root: &Path, hash_hex: &str) -> PathBuf {
    root.join(hash_hex).join("ui")
}

/// Check whether index.html exists for the given hash in the UI cache.
pub fn exists_ui_index(root: &Path, hash_hex: &str) -> bool {
    let p = ui_cache_dir(root, hash_hex).join("index.html");
    std::fs::metadata(p).is_ok()
}

/// Ensure directory exists (create all parents).
pub async fn ensure_dir(path: &Path) -> Result<()> {
    fs::create_dir_all(path).await?;
    Ok(())
}

/// Atomically write bytes to destination path:
/// - write to dest.tmp
/// - flush + sync
/// - rename to dest
/// - set readonly permissions
pub async fn write_atomic(dest: &Path, bytes: impl AsRef<[u8]>) -> Result<()> {
    let tmp_path = dest.with_extension("tmp");
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).await?;
    }
    let mut f = fs::File::create(&tmp_path).await?;
    f.write_all(bytes.as_ref()).await?;
    f.flush().await?;
    #[cfg(unix)]
    {
        use std::os::unix::prelude::PermissionsExt;
        // Attempt to fsync for durability
        let _ = f.sync_all().await;
        // Set readonly perms after rename for final file
        drop(f);
        fs::rename(&tmp_path, dest).await?;
        let mut perms = fs::metadata(dest).await?.permissions();
        perms.set_mode(0o444);
        fs::set_permissions(dest, perms).await?;
        return Ok(());
    }
    #[cfg(not(unix))]
    {
        // Best-effort on non-unix
        let _ = f.sync_all().await;
        drop(f);
        fs::rename(&tmp_path, dest).await?;
        // Set readonly if supported
        let mut perms = fs::metadata(dest).await?.permissions();
        perms.set_readonly(true);
        fs::set_permissions(dest, perms).await?;
        return Ok(());
    }
}

/// Resolve EXT_CACHE_ROOT from environment with sensible default.
pub fn ext_cache_root_from_env() -> PathBuf {
    env::var("EXT_CACHE_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp/alga-ext-cache"))
}
