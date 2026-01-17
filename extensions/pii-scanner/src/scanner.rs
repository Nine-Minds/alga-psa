//! File scanner implementation
//!
//! Features:
//! - F087: File system walker with include/exclude path logic
//! - F088: File extension filtering
//! - F089: Wildcard path matching for include/exclude
//!
//! Note: This WASM component receives file contents from the host agent.
//! The host handles filesystem access and passes text content for scanning.

use crate::patterns::{detect_pii, PiiMatch, PiiType};
use crate::{PiiFinding, PiiScanResponse, ScanProfile, ScanStatus};

/// File scanner
pub struct Scanner<'a> {
    profile: &'a ScanProfile,
    pii_types: Vec<PiiType>,
}

impl<'a> Scanner<'a> {
    /// Create a new scanner with the given profile
    pub fn new(profile: &'a ScanProfile) -> Self {
        // Parse PII types from strings
        let pii_types: Vec<PiiType> = profile
            .pii_types
            .iter()
            .filter_map(|s| PiiType::from_str(s))
            .collect();

        Self { profile, pii_types }
    }

    /// Execute the scan on provided file contents (F087, F088, F089, F090)
    ///
    /// The host agent provides file paths and contents. This function
    /// scans the text content for PII patterns.
    pub fn scan(&self, request_id: &str) -> PiiScanResponse {
        // In WASM context, the host provides files via the request
        // For now, return an empty response - the host will call scan_text for each file
        PiiScanResponse {
            request_id: request_id.to_string(),
            profile_id: self.profile.profile_id.clone(),
            status: ScanStatus::Completed,
            files_scanned: 0,
            files_skipped: 0,
            bytes_scanned: 0,
            duration_ms: 0,
            findings: Vec::new(),
            errors: Vec::new(),
        }
    }

    /// Scan a single file's text content
    ///
    /// Called by the host for each file that needs scanning.
    pub fn scan_text(&self, file_path: &str, text: &str) -> Vec<PiiFinding> {
        let matches = detect_pii(text, &self.pii_types);

        matches
            .into_iter()
            .enumerate()
            .map(|(i, m)| self.match_to_finding(file_path, &m, i))
            .collect()
    }

    /// Build glob patterns for file extensions (F088)
    pub fn build_extension_patterns(&self) -> Vec<String> {
        if self.profile.file_extensions.is_empty() {
            // Default extensions
            vec![
                "**/*.txt".to_string(),
                "**/*.csv".to_string(),
                "**/*.json".to_string(),
                "**/*.xml".to_string(),
                "**/*.xlsx".to_string(),
                "**/*.xls".to_string(),
                "**/*.docx".to_string(),
                "**/*.doc".to_string(),
                "**/*.pdf".to_string(),
            ]
        } else {
            self.profile
                .file_extensions
                .iter()
                .map(|ext| {
                    let ext = ext.trim_start_matches('.');
                    format!("**/*.{}", ext)
                })
                .collect()
        }
    }

    /// Convert a PII match to a finding (without actual PII value)
    fn match_to_finding(&self, file_path: &str, pii_match: &PiiMatch, index: usize) -> PiiFinding {
        // Generate finding ID
        let finding_id = format!(
            "{}-{}-{}",
            &self.profile.profile_id[..8.min(self.profile.profile_id.len())],
            file_path.len() % 1000,
            index
        );

        // Create redacted context (shows location without actual PII)
        let context = format!(
            "Line {}, Column {}: [REDACTED {}]",
            pii_match.line,
            pii_match.column,
            pii_match.pii_type.as_str().to_uppercase()
        );

        PiiFinding {
            finding_id,
            pii_type: pii_match.pii_type.as_str().to_string(),
            file_path: file_path.to_string(),
            line_number: pii_match.line,
            column: pii_match.column,
            context,
            confidence: pii_match.confidence,
            severity: pii_match.pii_type.severity().to_string(),
        }
    }
}

/// Check if a path matches any of the given glob patterns (F089)
///
/// Simple glob matching for include/exclude patterns.
pub fn matches_glob(path: &str, pattern: &str) -> bool {
    // Handle patterns like **/folder/** (match folder anywhere in path)
    if pattern.starts_with("**/") && pattern.ends_with("/**") {
        let middle = &pattern[3..pattern.len() - 3];
        // Check if the middle part appears as a path component
        return path.contains(&format!("/{}/", middle)) ||
               path.contains(&format!("/{}", middle)) && path.ends_with(middle);
    }

    // Handle patterns like **/.git/** (dotfiles)
    if pattern.contains("/**/") {
        let parts: Vec<&str> = pattern.split("/**/").collect();
        if parts.len() == 2 {
            let before = parts[0].trim_start_matches("**/");
            let after = parts[1].trim_end_matches("/**");

            if before.is_empty() {
                return path.contains(&format!("/{}/", after)) ||
                       path.contains(&format!("/{}", after));
            }
        }
    }

    // Handle ** (match any path segments)
    if pattern.contains("**") {
        let parts: Vec<&str> = pattern.split("**").collect();
        if parts.len() == 2 {
            let prefix = parts[0].trim_end_matches('/');
            let suffix = parts[1].trim_start_matches('/');

            // Check prefix (if any)
            let prefix_matches = prefix.is_empty() || path.starts_with(prefix);

            // Check suffix (if any)
            let suffix_matches = if suffix.is_empty() {
                true
            } else if suffix.starts_with("*.") {
                // Handle **/*.ext pattern - check file extension
                let ext = suffix.trim_start_matches('*');
                path.ends_with(ext)
            } else if suffix.ends_with("/**") {
                // Handle **/folder/** pattern
                let folder = suffix.trim_end_matches("/**");
                path.contains(&format!("/{}/", folder))
            } else {
                // Check if path contains the suffix as a path component
                path.contains(&format!("/{}/", suffix)) ||
                path.contains(&format!("/{}", suffix)) ||
                path.ends_with(suffix)
            };

            return prefix_matches && suffix_matches;
        }
    }

    // Handle * (match any characters except /)
    if pattern.contains('*') && !pattern.contains("**") {
        // Handle *.ext patterns
        if pattern.starts_with("*.") {
            let ext = pattern.trim_start_matches('*');
            return path.to_lowercase().ends_with(&ext.to_lowercase());
        }
    }

    // Exact match
    path == pattern || path.ends_with(&format!("/{}", pattern))
}

/// Check if a path should be excluded (F087)
pub fn should_exclude(path: &str, exclude_patterns: &[String]) -> bool {
    for pattern in exclude_patterns {
        if matches_glob(path, pattern) {
            return true;
        }
    }
    false
}

/// Check if a file extension is supported (F088)
pub fn is_extension_supported(path: &str, extensions: &[String]) -> bool {
    if extensions.is_empty() {
        return true; // No filter means all extensions
    }

    for ext in extensions {
        let ext_lower = ext.trim_start_matches('.').to_lowercase();
        if path.to_lowercase().ends_with(&format!(".{}", ext_lower)) {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extension_patterns_default() {
        let profile = ScanProfile {
            profile_id: "test".to_string(),
            name: "Test".to_string(),
            pii_types: vec!["ssn".to_string()],
            file_extensions: vec![],
            include_paths: vec!["/home".to_string()],
            exclude_paths: vec![],
            max_file_size: 50 * 1024 * 1024,
            max_files: 100_000,
            max_depth: 20,
        };

        let scanner = Scanner::new(&profile);
        let patterns = scanner.build_extension_patterns();

        assert!(patterns.contains(&"**/*.txt".to_string()));
        assert!(patterns.contains(&"**/*.xlsx".to_string()));
    }

    #[test]
    fn test_extension_patterns_custom() {
        let profile = ScanProfile {
            profile_id: "test".to_string(),
            name: "Test".to_string(),
            pii_types: vec!["ssn".to_string()],
            file_extensions: vec![".csv".to_string(), "txt".to_string()],
            include_paths: vec!["/home".to_string()],
            exclude_paths: vec![],
            max_file_size: 50 * 1024 * 1024,
            max_files: 100_000,
            max_depth: 20,
        };

        let scanner = Scanner::new(&profile);
        let patterns = scanner.build_extension_patterns();

        assert_eq!(patterns.len(), 2);
        assert!(patterns.contains(&"**/*.csv".to_string()));
        assert!(patterns.contains(&"**/*.txt".to_string()));
    }

    #[test]
    fn test_matches_glob_double_star() {
        // F089: Wildcard path matching
        assert!(matches_glob("/home/user/docs/file.txt", "**/*.txt"));
        assert!(matches_glob("/var/data/report.csv", "**/*.csv"));
        assert!(!matches_glob("/home/user/docs/file.txt", "**/*.csv"));
    }

    #[test]
    fn test_matches_glob_specific_path() {
        assert!(matches_glob("/home/user/node_modules/pkg/file.js", "**/node_modules/**"));
        assert!(matches_glob("/project/.git/config", "**/.git/**"));
    }

    #[test]
    fn test_should_exclude() {
        let exclude = vec![
            "**/node_modules/**".to_string(),
            "**/.git/**".to_string(),
        ];

        assert!(should_exclude("/home/user/project/node_modules/pkg/file.js", &exclude));
        assert!(should_exclude("/project/.git/config", &exclude));
        assert!(!should_exclude("/home/user/document.txt", &exclude));
    }

    #[test]
    fn test_is_extension_supported() {
        let extensions = vec![".txt".to_string(), ".csv".to_string()];

        assert!(is_extension_supported("/path/to/file.txt", &extensions));
        assert!(is_extension_supported("/path/to/FILE.CSV", &extensions));
        assert!(!is_extension_supported("/path/to/file.xlsx", &extensions));

        // Empty extensions means all supported
        assert!(is_extension_supported("/path/to/any.file", &[]));
    }
}
