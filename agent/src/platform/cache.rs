//! Extension cache directory management
//!
//! Features:
//! - F277: Windows cache directory (C:\ProgramData\AlgaAgent\cache)
//! - F278: macOS cache directory (/Library/Application Support/AlgaAgent/cache)
//! - F279: Linux cache directory (/var/lib/alga-agent/cache)

use std::path::PathBuf;

/// Get the cache directory for extension bundles (F277-F279)
///
/// Returns the platform-specific directory where extension WASM bundles
/// are cached after download.
///
/// # Platform-specific paths
///
/// - **Windows (F277)**: `C:\ProgramData\AlgaAgent\cache`
/// - **macOS (F278)**: `/Library/Application Support/AlgaAgent/cache`
/// - **Linux (F279)**: `/var/lib/alga-agent/cache`
///
/// # Fallback
///
/// If the system directory is not writable, falls back to a user-specific
/// directory under the home folder.
pub fn get_cache_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        get_cache_dir_windows()
    }

    #[cfg(target_os = "macos")]
    {
        get_cache_dir_macos()
    }

    #[cfg(target_os = "linux")]
    {
        get_cache_dir_linux()
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        // Fallback for other platforms
        directories::ProjectDirs::from("com", "algapsa", "agent")
            .map(|d| d.cache_dir().to_path_buf())
            .unwrap_or_else(|| PathBuf::from(".alga-agent-cache"))
    }
}

/// Windows cache directory (F277)
#[cfg(target_os = "windows")]
fn get_cache_dir_windows() -> PathBuf {
    // Primary: System-wide ProgramData
    let program_data = std::env::var("ProgramData")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(r"C:\ProgramData"));

    let system_cache = program_data.join("AlgaAgent").join("cache");

    // Check if we can use the system directory
    if is_dir_writable(&system_cache) {
        return system_cache;
    }

    // Fallback: User-specific directory
    directories::ProjectDirs::from("com", "algapsa", "agent")
        .map(|d| d.cache_dir().to_path_buf())
        .unwrap_or_else(|| {
            std::env::var("LOCALAPPDATA")
                .map(|p| PathBuf::from(p).join("AlgaAgent").join("cache"))
                .unwrap_or_else(|_| PathBuf::from(r"C:\ProgramData\AlgaAgent\cache"))
        })
}

/// Stub for non-Windows
#[cfg(not(target_os = "windows"))]
fn get_cache_dir_windows() -> PathBuf {
    PathBuf::from(r"C:\ProgramData\AlgaAgent\cache")
}

/// macOS cache directory (F278)
#[cfg(target_os = "macos")]
fn get_cache_dir_macos() -> PathBuf {
    // Primary: System-wide Application Support
    let system_cache = PathBuf::from("/Library/Application Support/AlgaAgent/cache");

    if is_dir_writable(&system_cache) {
        return system_cache;
    }

    // Fallback: User-specific directory
    directories::ProjectDirs::from("com", "algapsa", "agent")
        .map(|d| d.cache_dir().to_path_buf())
        .unwrap_or_else(|| {
            directories::BaseDirs::new()
                .map(|d| d.home_dir().join("Library/Caches/AlgaAgent"))
                .unwrap_or_else(|| PathBuf::from("/Library/Application Support/AlgaAgent/cache"))
        })
}

/// Stub for non-macOS
#[cfg(not(target_os = "macos"))]
fn get_cache_dir_macos() -> PathBuf {
    PathBuf::from("/Library/Application Support/AlgaAgent/cache")
}

/// Linux cache directory (F279)
#[cfg(target_os = "linux")]
fn get_cache_dir_linux() -> PathBuf {
    // Primary: System-wide /var/lib
    let system_cache = PathBuf::from("/var/lib/alga-agent/cache");

    if is_dir_writable(&system_cache) {
        return system_cache;
    }

    // Fallback: User-specific directory
    directories::ProjectDirs::from("com", "algapsa", "agent")
        .map(|d| d.cache_dir().to_path_buf())
        .unwrap_or_else(|| {
            std::env::var("HOME")
                .map(|h| PathBuf::from(h).join(".cache/alga-agent"))
                .unwrap_or_else(|_| PathBuf::from("/var/lib/alga-agent/cache"))
        })
}

/// Stub for non-Linux
#[cfg(not(target_os = "linux"))]
fn get_cache_dir_linux() -> PathBuf {
    PathBuf::from("/var/lib/alga-agent/cache")
}

/// Get the configuration directory for the agent
pub fn get_config_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        std::env::var("ProgramData")
            .map(|p| PathBuf::from(p).join("AlgaAgent").join("config"))
            .unwrap_or_else(|_| PathBuf::from(r"C:\ProgramData\AlgaAgent\config"))
    }

    #[cfg(target_os = "macos")]
    {
        PathBuf::from("/Library/Application Support/AlgaAgent/config")
    }

    #[cfg(target_os = "linux")]
    {
        PathBuf::from("/etc/alga-agent")
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        PathBuf::from("./config")
    }
}

/// Get the log directory for the agent
pub fn get_log_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        std::env::var("ProgramData")
            .map(|p| PathBuf::from(p).join("AlgaAgent").join("logs"))
            .unwrap_or_else(|_| PathBuf::from(r"C:\ProgramData\AlgaAgent\logs"))
    }

    #[cfg(target_os = "macos")]
    {
        PathBuf::from("/Library/Logs/AlgaAgent")
    }

    #[cfg(target_os = "linux")]
    {
        PathBuf::from("/var/log/alga-agent")
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        PathBuf::from("./logs")
    }
}

/// Get the path to the agent ID file (F293)
pub fn get_agent_id_path() -> PathBuf {
    get_config_dir().join("agent-id")
}

/// Check if a directory is writable
fn is_dir_writable(path: &PathBuf) -> bool {
    // Try to create the directory if it doesn't exist
    if !path.exists() {
        if let Err(_) = std::fs::create_dir_all(path) {
            return false;
        }
    }

    // Check if we can write to it
    let test_file = path.join(".write_test");
    match std::fs::write(&test_file, b"test") {
        Ok(_) => {
            let _ = std::fs::remove_file(&test_file);
            true
        }
        Err(_) => false,
    }
}

/// Extension cache entry metadata
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct CacheEntry {
    /// Extension ID
    pub extension_id: String,
    /// Version ID from the server
    pub version_id: String,
    /// Content hash (SHA-256)
    pub content_hash: String,
    /// Path to the cached WASM file
    pub wasm_path: PathBuf,
    /// Timestamp when cached
    pub cached_at: u64,
    /// Size in bytes
    pub size_bytes: u64,
}

impl CacheEntry {
    /// Get the expected path for a cached extension
    pub fn cache_path(extension_id: &str, version_id: &str) -> PathBuf {
        get_cache_dir()
            .join(extension_id)
            .join(format!("{}.wasm", version_id))
    }

    /// Check if the cache entry is still valid
    pub fn is_valid(&self, expected_version: &str, expected_hash: &str) -> bool {
        self.version_id == expected_version && self.content_hash == expected_hash
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_cache_dir_windows() {
        // T365: Windows cache path
        let path = get_cache_dir_windows();
        let path_str = path.to_string_lossy();
        assert!(path_str.contains("AlgaAgent") || path_str.contains("alga"));
    }

    #[test]
    fn test_get_cache_dir_macos() {
        // T366: macOS cache path
        let path = get_cache_dir_macos();
        let path_str = path.to_string_lossy();
        assert!(path_str.contains("AlgaAgent") || path_str.contains("alga"));
    }

    #[test]
    fn test_get_cache_dir_linux() {
        // T367: Linux cache path
        let path = get_cache_dir_linux();
        let path_str = path.to_string_lossy();
        assert!(path_str.contains("alga"));
    }

    #[test]
    fn test_cache_entry_path() {
        let path = CacheEntry::cache_path("alga-guard-pii-scanner", "v1.0.0");
        assert!(path.to_string_lossy().contains("alga-guard-pii-scanner"));
        assert!(path.to_string_lossy().contains("v1.0.0"));
    }

    #[test]
    fn test_cache_entry_validity() {
        let entry = CacheEntry {
            extension_id: "test".to_string(),
            version_id: "v1".to_string(),
            content_hash: "abc123".to_string(),
            wasm_path: PathBuf::from("/cache/test/v1.wasm"),
            cached_at: 0,
            size_bytes: 1000,
        };

        assert!(entry.is_valid("v1", "abc123"));
        assert!(!entry.is_valid("v2", "abc123")); // T372: Version change invalidates
        assert!(!entry.is_valid("v1", "def456")); // Hash mismatch
    }
}
