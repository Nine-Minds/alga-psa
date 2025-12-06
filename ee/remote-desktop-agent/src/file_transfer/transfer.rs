//! File Transfer Utilities
//!
//! Helper functions and types for file transfer operations.

use std::path::Path;

use anyhow::Result;

/// MIME type detection based on file extension
pub fn detect_mime_type(path: &Path) -> Option<String> {
    let extension = path.extension()?.to_str()?.to_lowercase();

    let mime = match extension.as_str() {
        // Text
        "txt" => "text/plain",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" => "text/javascript",
        "json" => "application/json",
        "xml" => "application/xml",
        "csv" => "text/csv",
        "md" => "text/markdown",

        // Images
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",

        // Audio
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        "aac" => "audio/aac",

        // Video
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "avi" => "video/x-msvideo",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",

        // Archives
        "zip" => "application/zip",
        "tar" => "application/x-tar",
        "gz" | "gzip" => "application/gzip",
        "7z" => "application/x-7z-compressed",
        "rar" => "application/vnd.rar",

        // Documents
        "pdf" => "application/pdf",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",

        // Executables and binaries
        "exe" => "application/x-msdownload",
        "dll" => "application/x-msdownload",
        "msi" => "application/x-msi",
        "dmg" => "application/x-apple-diskimage",
        "pkg" => "application/x-newton-compatible-pkg",
        "deb" => "application/x-debian-package",
        "rpm" => "application/x-rpm",

        // Other
        "wasm" => "application/wasm",
        "ttf" => "font/ttf",
        "woff" => "font/woff",
        "woff2" => "font/woff2",

        _ => "application/octet-stream",
    };

    Some(mime.to_string())
}

/// Check if a file should be considered hidden
pub fn is_hidden(path: &Path) -> bool {
    let filename = match path.file_name() {
        Some(name) => name.to_string_lossy(),
        None => return false,
    };

    // Unix-style hidden files
    if filename.starts_with('.') {
        return true;
    }

    // Windows hidden attribute (would need win32 API check)
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if let Ok(metadata) = std::fs::metadata(path) {
            const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
            if metadata.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0 {
                return true;
            }
        }
    }

    false
}

/// List files in a directory
pub async fn list_directory(
    path: &Path,
    include_hidden: bool,
) -> Result<Vec<super::protocol::FileEntry>> {
    use super::protocol::FileEntry;
    use tokio::fs;

    let mut entries = Vec::new();
    let mut read_dir = fs::read_dir(path).await?;

    while let Some(entry) = read_dir.next_entry().await? {
        let entry_path = entry.path();
        let metadata = entry.metadata().await?;

        let hidden = is_hidden(&entry_path);
        if hidden && !include_hidden {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();
        let full_path = entry_path.to_string_lossy().to_string();
        let is_directory = metadata.is_dir();
        let size = if is_directory { 0 } else { metadata.len() };

        let modified = metadata.modified().ok().and_then(|m| {
            m.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_secs())
        });

        let mime_type = if is_directory {
            None
        } else {
            detect_mime_type(&entry_path)
        };

        // Check permissions
        let readable = entry_path.exists(); // Simplified check
        let writable = !metadata.permissions().readonly();

        entries.push(FileEntry {
            name,
            path: full_path,
            is_directory,
            size,
            modified,
            mime_type,
            hidden,
            readable,
            writable,
        });
    }

    // Sort: directories first, then by name
    entries.sort_by(|a, b| {
        match (a.is_directory, b.is_directory) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(entries)
}

/// Get the downloads directory for the current user
pub fn get_downloads_dir() -> std::path::PathBuf {
    dirs::download_dir().unwrap_or_else(|| {
        dirs::home_dir()
            .map(|h| h.join("Downloads"))
            .unwrap_or_else(|| std::path::PathBuf::from("/tmp"))
    })
}

/// Sanitize a filename to prevent path traversal
pub fn sanitize_filename(filename: &str) -> String {
    // Remove path separators and other dangerous characters
    filename
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | '\0' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        .collect::<String>()
        .trim()
        .to_string()
}

/// Generate a unique filename if the file already exists
pub async fn unique_filename(dir: &Path, filename: &str) -> std::path::PathBuf {
    let sanitized = sanitize_filename(filename);
    let path = dir.join(&sanitized);

    if !path.exists() {
        return path;
    }

    let stem = std::path::Path::new(&sanitized)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| sanitized.clone());

    let extension = std::path::Path::new(&sanitized)
        .extension()
        .map(|s| format!(".{}", s.to_string_lossy()))
        .unwrap_or_default();

    for i in 1..1000 {
        let new_name = format!("{} ({}){}", stem, i, extension);
        let new_path = dir.join(&new_name);
        if !new_path.exists() {
            return new_path;
        }
    }

    // Fallback: use timestamp
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    dir.join(format!("{}_{}{}", stem, timestamp, extension))
}

/// Format file size for display
pub fn format_file_size(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;

    if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.2} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.2} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

/// Format transfer speed for display
pub fn format_speed(bytes_per_second: u64) -> String {
    format!("{}/s", format_file_size(bytes_per_second))
}

/// Format estimated time remaining
pub fn format_eta(seconds: u32) -> String {
    if seconds < 60 {
        format!("{}s", seconds)
    } else if seconds < 3600 {
        let minutes = seconds / 60;
        let secs = seconds % 60;
        format!("{}m {}s", minutes, secs)
    } else {
        let hours = seconds / 3600;
        let minutes = (seconds % 3600) / 60;
        format!("{}h {}m", hours, minutes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_detect_mime_type() {
        assert_eq!(detect_mime_type(Path::new("test.txt")), Some("text/plain".to_string()));
        assert_eq!(detect_mime_type(Path::new("image.png")), Some("image/png".to_string()));
        assert_eq!(detect_mime_type(Path::new("archive.zip")), Some("application/zip".to_string()));
    }

    #[test]
    fn test_sanitize_filename() {
        assert_eq!(sanitize_filename("normal.txt"), "normal.txt");
        assert_eq!(sanitize_filename("../../../etc/passwd"), "etcpasswd");
        assert_eq!(sanitize_filename("file<>:name.txt"), "filename.txt");
    }

    #[test]
    fn test_format_file_size() {
        assert_eq!(format_file_size(100), "100 B");
        assert_eq!(format_file_size(1024), "1.00 KB");
        assert_eq!(format_file_size(1024 * 1024), "1.00 MB");
        assert_eq!(format_file_size(1024 * 1024 * 1024), "1.00 GB");
    }

    #[test]
    fn test_format_eta() {
        assert_eq!(format_eta(30), "30s");
        assert_eq!(format_eta(90), "1m 30s");
        assert_eq!(format_eta(3700), "1h 1m");
    }
}
