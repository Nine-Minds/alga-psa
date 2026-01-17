//! Skip file detection for different platforms
//!
//! Features:
//! - F275: Windows skip detection (hidden/system attrs, skip Windows dir)
//! - F276: Unix skip detection (dotfiles, proc/sys/dev dirs)

use std::path::Path;

/// Directories that should always be skipped on Windows (F275)
const WINDOWS_SKIP_DIRS: &[&str] = &[
    "Windows",
    "$Recycle.Bin",
    "$RECYCLE.BIN",
    "System Volume Information",
    "Recovery",
    "PerfLogs",
    "Program Files",
    "Program Files (x86)",
    "ProgramData\\Microsoft",
    "AppData\\Local\\Temp",
    "AppData\\Local\\Microsoft",
    "AppData\\Local\\Packages",
    "NTUSER.DAT",
    "pagefile.sys",
    "hiberfil.sys",
    "swapfile.sys",
];

/// Directories that should always be skipped on Unix (F276)
const UNIX_SKIP_DIRS: &[&str] = &[
    "/proc",
    "/sys",
    "/dev",
    "/run",
    "/var/run",
    "/tmp",
    "/var/tmp",
    "/snap",
    "/boot",
    "/lost+found",
    ".cache",
    ".local/share/Trash",
    "node_modules",
    ".git",
    ".svn",
    "__pycache__",
    ".venv",
    "venv",
    ".npm",
    ".yarn",
];

/// Check if a file should be skipped during scanning (F275, F276)
///
/// # Arguments
/// * `path` - The file path to check
/// * `include_hidden` - Whether to include hidden files (dotfiles on Unix, hidden attr on Windows)
///
/// # Returns
/// `true` if the file should be skipped, `false` if it should be scanned
///
/// # Examples
/// ```
/// // Unix
/// assert!(should_skip_file("/proc/1/status", false));
/// assert!(should_skip_file("/home/user/.bashrc", false));
/// assert!(!should_skip_file("/home/user/.bashrc", true)); // include hidden
///
/// // Windows
/// assert!(should_skip_file("C:\\Windows\\System32", false));
/// assert!(should_skip_file("C:\\$Recycle.Bin", false));
/// ```
pub fn should_skip_file(path: &Path, include_hidden: bool) -> bool {
    #[cfg(target_os = "windows")]
    {
        should_skip_file_windows(path, include_hidden)
    }

    #[cfg(not(target_os = "windows"))]
    {
        should_skip_file_unix(path, include_hidden)
    }
}

/// Windows skip file detection (F275)
#[cfg(target_os = "windows")]
fn should_skip_file_windows(path: &Path, include_hidden: bool) -> bool {
    use std::os::windows::fs::MetadataExt;
    use winreg::enums::*;

    let path_str = path.to_string_lossy();

    // Check against skip directories
    for skip_dir in WINDOWS_SKIP_DIRS {
        if path_str.contains(skip_dir) {
            return true;
        }
    }

    // Check file attributes if we can get metadata
    if let Ok(metadata) = path.metadata() {
        let attrs = metadata.file_attributes();

        // FILE_ATTRIBUTE_HIDDEN = 0x2
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
        // FILE_ATTRIBUTE_SYSTEM = 0x4
        const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;

        // T360: Skip hidden files unless include_hidden is true
        if !include_hidden && (attrs & FILE_ATTRIBUTE_HIDDEN) != 0 {
            return true;
        }

        // T361: Always skip system files
        if (attrs & FILE_ATTRIBUTE_SYSTEM) != 0 {
            return true;
        }
    }

    // T362: Check for specific skip patterns
    let file_name = path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    // Skip common Windows temporary/system files
    if file_name.starts_with("~$") || file_name.ends_with(".tmp") {
        return true;
    }

    false
}

/// Stub for non-Windows builds
#[cfg(not(target_os = "windows"))]
fn should_skip_file_windows(path: &Path, include_hidden: bool) -> bool {
    let path_str = path.to_string_lossy();

    // Check against skip directories
    for skip_dir in WINDOWS_SKIP_DIRS {
        if path_str.contains(skip_dir) {
            return true;
        }
    }

    // Check for hidden files (starting with ~$ or having $ prefix)
    let file_name = path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    if !include_hidden && (file_name.starts_with("$") || file_name.starts_with("~$")) {
        return true;
    }

    false
}

/// Unix skip file detection (F276)
fn should_skip_file_unix(path: &Path, include_hidden: bool) -> bool {
    let path_str = path.to_string_lossy();

    // T364: Check against absolute skip directories
    for skip_dir in UNIX_SKIP_DIRS {
        if skip_dir.starts_with('/') {
            // Absolute path check
            if path_str.starts_with(skip_dir) {
                return true;
            }
        } else {
            // Relative name check - appears anywhere in path
            if path_str.contains(&format!("/{}/", skip_dir))
                || path_str.ends_with(&format!("/{}", skip_dir))
            {
                return true;
            }
        }
    }

    // T363: Check for dotfiles (hidden files)
    if !include_hidden {
        if let Some(file_name) = path.file_name() {
            let name = file_name.to_string_lossy();
            if name.starts_with('.') && name != "." && name != ".." {
                return true;
            }
        }

        // Also check parent directories for hidden folders
        for component in path.components() {
            if let std::path::Component::Normal(name) = component {
                let name_str = name.to_string_lossy();
                if name_str.starts_with('.') {
                    return true;
                }
            }
        }
    }

    // Check for common temporary/cache files
    if let Some(file_name) = path.file_name() {
        let name = file_name.to_string_lossy();
        if name.ends_with('~') || name.ends_with(".swp") || name.ends_with(".swo") {
            return true;
        }
    }

    false
}

/// Check if a file is likely a binary file based on extension
pub fn is_likely_binary(path: &Path) -> bool {
    const BINARY_EXTENSIONS: &[&str] = &[
        "exe", "dll", "so", "dylib", "bin", "obj", "o", "a", "lib",
        "class", "pyc", "pyo", "wasm",
        "jpg", "jpeg", "png", "gif", "bmp", "ico", "webp", "svg",
        "mp3", "mp4", "avi", "mkv", "mov", "wmv", "flv", "webm",
        "ttf", "otf", "woff", "woff2", "eot",
        "gz", "tar", "rar", "7z", "bz2", "xz", "lz", "lzma",
        "iso", "img", "dmg",
        "db", "sqlite", "sqlite3",
    ];

    path.extension()
        .map(|ext| {
            let ext_lower = ext.to_string_lossy().to_lowercase();
            BINARY_EXTENSIONS.contains(&ext_lower.as_str())
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_unix_skip_proc() {
        // T364: /proc should be skipped
        assert!(should_skip_file_unix(&PathBuf::from("/proc/1/status"), false));
    }

    #[test]
    fn test_unix_skip_sys() {
        // T364: /sys should be skipped
        assert!(should_skip_file_unix(&PathBuf::from("/sys/class/net"), false));
    }

    #[test]
    fn test_unix_skip_dev() {
        // T364: /dev should be skipped
        assert!(should_skip_file_unix(&PathBuf::from("/dev/null"), false));
    }

    #[test]
    fn test_unix_skip_dotfiles() {
        // T363: Dotfiles should be skipped unless include_hidden
        assert!(should_skip_file_unix(&PathBuf::from("/home/user/.bashrc"), false));
        assert!(!should_skip_file_unix(&PathBuf::from("/home/user/.bashrc"), true));
    }

    #[test]
    fn test_unix_allow_normal_files() {
        assert!(!should_skip_file_unix(&PathBuf::from("/home/user/document.txt"), false));
        assert!(!should_skip_file_unix(&PathBuf::from("/var/log/syslog"), false));
    }

    #[test]
    fn test_windows_skip_recycle_bin() {
        // T362: $Recycle.Bin should be skipped
        assert!(should_skip_file_windows(&PathBuf::from(r"C:\$Recycle.Bin\file.txt"), false));
    }

    #[test]
    fn test_windows_skip_windows_dir() {
        // T360/T361: Windows directory should be skipped
        assert!(should_skip_file_windows(&PathBuf::from(r"C:\Windows\System32\cmd.exe"), false));
    }

    #[test]
    fn test_is_likely_binary() {
        assert!(is_likely_binary(&PathBuf::from("program.exe")));
        assert!(is_likely_binary(&PathBuf::from("image.jpg")));
        assert!(is_likely_binary(&PathBuf::from("archive.tar.gz")));
        assert!(!is_likely_binary(&PathBuf::from("document.txt")));
        assert!(!is_likely_binary(&PathBuf::from("data.csv")));
        assert!(!is_likely_binary(&PathBuf::from("report.xlsx")));
    }
}
