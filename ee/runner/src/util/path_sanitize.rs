use std::path::{Component, PathBuf};

use thiserror::Error;

/// Allowed file extensions for static UI assets.
const ALLOWLIST_EXTS: &[&str] = &[
    "html", "js", "css", "json", "map", "svg", "png", "jpg", "jpeg", "webp", "woff", "woff2",
];

#[derive(Debug, Error)]
pub enum Error {
    #[error("path must be relative")]
    NotRelative,
    #[error("path contains invalid component")]
    InvalidComponent,
    #[error("path contains forbidden characters")]
    ForbiddenChars,
    #[error("hidden files are not allowed")]
    HiddenFile,
    #[error("file extension not allowed")]
    DisallowedExtension,
}

/// Sanitize and normalize a relative path for static asset serving.
///
/// Rules:
/// - Reject absolute paths
/// - Reject `..` components and `.` components
/// - Reject NUL or control characters
/// - On Unix, reject backslashes `\`
/// - Normalize repeated slashes
/// - Allow empty string to represent root
/// - Disallow hidden files (any component starting with '.')
/// - Enforce extension allowlist on file paths (directory-like paths are allowed without extension)
pub fn sanitize(relative: &str) -> Result<PathBuf, Error> {
    if relative.is_empty() {
        return Ok(PathBuf::new());
    }

    // Absolute path check
    if relative.starts_with('/') {
        return Err(Error::NotRelative);
    }

    // Forbidden characters: NUL or control chars
    if relative.chars().any(|c| c == '\0' || c.is_control()) {
        return Err(Error::ForbiddenChars);
    }

    // On Unix, disallow backslashes to avoid Windows-style ambiguity and potential bypass
    #[cfg(unix)]
    {
        if relative.contains('\\') {
            return Err(Error::ForbiddenChars);
        }
    }

    // Normalize by splitting on '/' and filtering empty segments (handles repeated slashes)
    let mut normalized = PathBuf::new();
    let mut last_component_starts_with_dot: Option<bool> = None;

    for seg in relative.split('/') {
        if seg.is_empty() {
            continue;
        }
        if seg == "." || seg == ".." {
            return Err(Error::InvalidComponent);
        }
        // Disallow hidden files or directories (anything starting with '.')
        if seg.starts_with('.') {
            return Err(Error::HiddenFile);
        }
        normalized.push(seg);
        last_component_starts_with_dot = Some(seg.starts_with('.'));
    }

    // If after normalization we got empty, that's allowed (represents root)
    if normalized.as_os_str().is_empty() {
        return Ok(normalized);
    }

    // Ensure no parent/cur components slipped in from OS parsing
    for c in normalized.components() {
        match c {
            Component::Normal(os) => {
                let s = os.to_string_lossy();
                if s.starts_with('.') {
                    return Err(Error::HiddenFile);
                }
            }
            // Any other component is invalid for our purposes
            _ => return Err(Error::InvalidComponent),
        }
    }

    // If the last component looks like a file (has an extension), enforce allowlist.
    // If no extension, we treat it as a directory-like path and allow it (SPA fallback handled by caller).
    if let Some(name) = normalized.file_name().and_then(|n| n.to_str()) {
        if let Some(dot_idx) = name.rfind('.') {
            if dot_idx + 1 < name.len() {
                let ext = &name[dot_idx + 1..].to_ascii_lowercase();
                let allowed = ALLOWLIST_EXTS.iter().any(|e| *e == ext);
                if !allowed {
                    return Err(Error::DisallowedExtension);
                }
            } else {
                // Trailing dot (e.g., "file.") — treat as having empty extension, which is disallowed for files
                return Err(Error::DisallowedExtension);
            }
        }
    }

    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_empty_as_root() {
        let p = sanitize("").unwrap();
        assert!(p.as_os_str().is_empty());
    }

    #[test]
    fn normalizes_repeated_slashes() {
        let p = sanitize("assets//img///logo.png").unwrap();
        assert_eq!(p, PathBuf::from("assets/img/logo.png"));
    }

    #[test]
    fn rejects_absolute() {
        assert!(matches!(sanitize("/etc/passwd"), Err(Error::NotRelative)));
    }

    #[test]
    fn rejects_parent_and_current() {
        assert!(matches!(sanitize("../x"), Err(Error::InvalidComponent)));
        assert!(matches!(sanitize("./x"), Err(Error::InvalidComponent)));
        assert!(matches!(sanitize("a/../b"), Err(Error::InvalidComponent)));
        assert!(matches!(sanitize("a/./b"), Err(Error::InvalidComponent)));
    }

    #[test]
    fn rejects_hidden() {
        assert!(matches!(sanitize(".env"), Err(Error::HiddenFile)));
        assert!(matches!(
            sanitize("assets/.secret/file.txt"),
            Err(Error::HiddenFile)
        ));
    }

    #[test]
    fn enforces_allowlist() {
        assert!(sanitize("index.html").is_ok());
        assert!(sanitize("script.js").is_ok());
        assert!(sanitize("data.json").is_ok());
        assert!(matches!(
            sanitize("bad.exe"),
            Err(Error::DisallowedExtension)
        ));
        assert!(matches!(sanitize("file."), Err(Error::DisallowedExtension)));
    }

    #[test]
    fn allows_directory_like_paths_without_ext() {
        assert!(sanitize("assets").is_ok());
        assert!(sanitize("assets/images").is_ok());
    }

    #[test]
    fn rejects_control_and_nul() {
        assert!(matches!(sanitize("a\u{0001}b"), Err(Error::ForbiddenChars)));
        // NUL test
        let s = format!("a{}b", '\0');
        assert!(matches!(sanitize(&s), Err(Error::ForbiddenChars)));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_backslashes_on_unix() {
        assert!(matches!(
            sanitize("dir\\file.js"),
            Err(Error::ForbiddenChars)
        ));
    }
}
