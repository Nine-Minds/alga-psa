//! Scan configuration types

use serde::{Deserialize, Serialize};

/// Scan configuration for the PII scanner
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanConfig {
    /// Maximum file size to scan (bytes)
    pub max_file_size: u64,

    /// Maximum number of files to scan
    pub max_files: u32,

    /// Maximum directory depth
    pub max_depth: u32,

    /// File extensions to scan
    pub file_extensions: Vec<String>,

    /// PII types to detect
    pub pii_types: Vec<String>,

    /// Include patterns (glob)
    pub include_patterns: Vec<String>,

    /// Exclude patterns (glob)
    pub exclude_patterns: Vec<String>,

    /// Whether to follow symlinks
    pub follow_symlinks: bool,

    /// Whether to include hidden files
    pub include_hidden: bool,
}

impl Default for ScanConfig {
    fn default() -> Self {
        Self {
            max_file_size: 50 * 1024 * 1024, // 50 MB
            max_files: 100_000,
            max_depth: 20,
            file_extensions: vec![
                ".txt".to_string(),
                ".csv".to_string(),
                ".json".to_string(),
                ".xml".to_string(),
                ".xlsx".to_string(),
                ".xls".to_string(),
                ".docx".to_string(),
                ".doc".to_string(),
                ".pdf".to_string(),
            ],
            pii_types: vec![
                "ssn".to_string(),
                "credit_card".to_string(),
                "email".to_string(),
                "phone".to_string(),
            ],
            include_patterns: vec![],
            exclude_patterns: vec![
                "**/node_modules/**".to_string(),
                "**/.git/**".to_string(),
                "**/target/**".to_string(),
            ],
            follow_symlinks: false,
            include_hidden: false,
        }
    }
}
