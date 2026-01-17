//! Platform-specific path handling
//!
//! Features:
//! - F269: Windows path normalization (UNC paths, drive letters, backslashes)
//! - F270: Unix path normalization
//! - F271: Home directory tilde expansion
//! - F272: Windows default scan paths
//! - F273: macOS default scan paths
//! - F274: Linux default scan paths

use std::path::{Path, PathBuf};
use std::env;

/// Normalize a path for the current platform (F269, F270)
///
/// On Windows:
/// - Converts forward slashes to backslashes
/// - Normalizes UNC paths (\\\\server\\share)
/// - Preserves drive letters (C:\\)
///
/// On Unix:
/// - Paths are passed through with minimal modification
/// - Trailing slashes are removed
///
/// # Examples
/// ```
/// // Windows
/// assert_eq!(normalize_path("C:/Users/test"), "C:\\Users\\test");
/// assert_eq!(normalize_path("//server/share"), "\\\\server\\share");
///
/// // Unix
/// assert_eq!(normalize_path("/home/user/"), "/home/user");
/// ```
pub fn normalize_path(path: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        normalize_path_windows(path)
    }

    #[cfg(not(target_os = "windows"))]
    {
        normalize_path_unix(path)
    }
}

/// Windows-specific path normalization (F269)
#[cfg(target_os = "windows")]
fn normalize_path_windows(path: &str) -> String {
    let mut result = path.to_string();

    // Convert forward slashes to backslashes
    result = result.replace('/', "\\");

    // Handle UNC paths: //server/share or \\server\share
    if result.starts_with("\\\\") {
        // Already in UNC format, normalize any double backslashes
        while result.contains("\\\\\\") {
            result = result.replace("\\\\\\", "\\\\");
        }
    }

    // Remove trailing backslash unless it's a root path (C:\ or \\)
    if result.len() > 3 && result.ends_with('\\') {
        result.pop();
    }

    // Normalize drive letter to uppercase
    if result.len() >= 2 {
        let chars: Vec<char> = result.chars().collect();
        if chars[1] == ':' && chars[0].is_ascii_alphabetic() {
            result = format!("{}{}", chars[0].to_ascii_uppercase(), &result[1..]);
        }
    }

    result
}

/// Stub for non-Windows builds
#[cfg(not(target_os = "windows"))]
fn normalize_path_windows(path: &str) -> String {
    // Convert backslashes to forward slashes for testing on Unix
    let mut result = path.replace('\\', "/");

    // Handle UNC-style paths
    if result.starts_with("//") {
        result = format!("\\\\{}", &result[2..].replace('/', "\\"));
    }

    // Handle drive letters for testing
    if result.len() >= 2 {
        let chars: Vec<char> = result.chars().collect();
        if chars[1] == ':' && chars[0].is_ascii_alphabetic() {
            result = format!("{}:{}", chars[0].to_ascii_uppercase(), &result[2..].replace('/', "\\"));
        }
    }

    result
}

/// Unix-specific path normalization (F270)
fn normalize_path_unix(path: &str) -> String {
    let mut result = path.to_string();

    // Remove trailing slash unless it's the root
    if result.len() > 1 && result.ends_with('/') {
        result.pop();
    }

    // Collapse multiple slashes
    while result.contains("//") {
        result = result.replace("//", "/");
    }

    result
}

/// Expand tilde (~) to home directory (F271)
///
/// # Examples
/// ```
/// // On Unix with HOME=/home/user
/// assert_eq!(expand_home("~/Documents"), "/home/user/Documents");
/// assert_eq!(expand_home("~"), "/home/user");
///
/// // Paths without tilde pass through unchanged
/// assert_eq!(expand_home("/etc/config"), "/etc/config");
/// ```
pub fn expand_home(path: &str) -> String {
    if !path.starts_with('~') {
        return path.to_string();
    }

    let home = dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| {
            // Fallback to environment variable
            env::var("HOME")
                .or_else(|_| env::var("USERPROFILE"))
                .unwrap_or_default()
        });

    if path == "~" {
        return home;
    }

    if path.starts_with("~/") || path.starts_with("~\\") {
        return format!("{}{}", home, &path[1..]);
    }

    // ~username syntax (Unix-style) - not fully supported, return as-is
    path.to_string()
}

/// Get default scan paths for the current platform (F272-F274)
///
/// Returns a list of paths that should be scanned by default for PII.
///
/// # Windows (F272)
/// - C:\Users
/// - C:\ProgramData
///
/// # macOS (F273)
/// - /Users
/// - /Volumes
///
/// # Linux (F274)
/// - /home
/// - /root
pub fn default_scan_paths() -> Vec<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        default_scan_paths_windows()
    }

    #[cfg(target_os = "macos")]
    {
        default_scan_paths_macos()
    }

    #[cfg(target_os = "linux")]
    {
        default_scan_paths_linux()
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        vec![]
    }
}

/// Windows default scan paths (F272)
#[cfg(target_os = "windows")]
fn default_scan_paths_windows() -> Vec<PathBuf> {
    let mut paths = vec![
        PathBuf::from(r"C:\Users"),
        PathBuf::from(r"C:\ProgramData"),
    ];

    // Add additional drives if they exist
    for drive in ['D', 'E', 'F'] {
        let drive_path = PathBuf::from(format!("{}:\\Users", drive));
        if drive_path.exists() {
            paths.push(drive_path);
        }
    }

    paths
}

/// Stub for non-Windows builds
#[cfg(not(target_os = "windows"))]
fn default_scan_paths_windows() -> Vec<PathBuf> {
    vec![
        PathBuf::from(r"C:\Users"),
        PathBuf::from(r"C:\ProgramData"),
    ]
}

/// macOS default scan paths (F273)
#[cfg(target_os = "macos")]
fn default_scan_paths_macos() -> Vec<PathBuf> {
    vec![
        PathBuf::from("/Users"),
        PathBuf::from("/Volumes"),
    ]
}

/// Stub for non-macOS builds
#[cfg(not(target_os = "macos"))]
fn default_scan_paths_macos() -> Vec<PathBuf> {
    vec![
        PathBuf::from("/Users"),
        PathBuf::from("/Volumes"),
    ]
}

/// Linux default scan paths (F274)
#[cfg(target_os = "linux")]
fn default_scan_paths_linux() -> Vec<PathBuf> {
    vec![
        PathBuf::from("/home"),
        PathBuf::from("/root"),
    ]
}

/// Stub for non-Linux builds
#[cfg(not(target_os = "linux"))]
fn default_scan_paths_linux() -> Vec<PathBuf> {
    vec![
        PathBuf::from("/home"),
        PathBuf::from("/root"),
    ]
}

// Use the directories crate for home directory
mod dirs {
    use std::path::PathBuf;

    pub fn home_dir() -> Option<PathBuf> {
        directories::BaseDirs::new().map(|d| d.home_dir().to_path_buf())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_path_unix() {
        // T354: Unix paths pass through unchanged
        assert_eq!(normalize_path_unix("/home/user/docs"), "/home/user/docs");

        // Trailing slashes removed
        assert_eq!(normalize_path_unix("/home/user/"), "/home/user");

        // Root slash preserved
        assert_eq!(normalize_path_unix("/"), "/");

        // Multiple slashes collapsed
        assert_eq!(normalize_path_unix("/home//user///docs"), "/home/user/docs");
    }

    #[test]
    fn test_expand_home() {
        // T355: Tilde expands to home directory
        let expanded = expand_home("~/Documents");
        assert!(!expanded.starts_with('~'));
        assert!(expanded.contains("Documents"));

        // T356: Paths without tilde pass through
        assert_eq!(expand_home("/etc/config"), "/etc/config");
        assert_eq!(expand_home("C:\\Users"), "C:\\Users");
    }

    #[test]
    fn test_default_scan_paths_not_empty() {
        let paths = default_scan_paths();
        assert!(!paths.is_empty());
    }

    #[test]
    fn test_normalize_path_windows_simulation() {
        // T351-T353: Windows path normalization (simulated on any platform)
        let result = normalize_path_windows("C:/Users/test");
        assert!(result.contains("Users"));

        // UNC paths
        let unc = normalize_path_windows("//server/share/path");
        assert!(unc.starts_with("\\\\"));
    }
}
