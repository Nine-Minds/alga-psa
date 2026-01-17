//! Alga Guard PII Scanner Extension
//!
//! This WebAssembly component scans files for PII (Personally Identifiable Information)
//! and reports findings without storing or transmitting the actual PII values.
//!
//! Features:
//! - F087: File system walker with include/exclude path logic
//! - F088: File extension filtering
//! - F089: Wildcard path matching for include/exclude
//! - F090: Build response with all results in single PiiScanResponse

pub mod patterns;
pub mod scanner;
pub mod config;

use serde::{Deserialize, Serialize};

pub use config::ScanConfig;
pub use patterns::{PiiType, PiiMatch};
pub use scanner::Scanner;

/// PII scan request from the server
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PiiScanRequest {
    /// Scan profile configuration
    pub profile: ScanProfile,

    /// Request ID for correlation
    pub request_id: String,

    /// Files to scan (path -> content)
    #[serde(default)]
    pub files: Vec<FileToScan>,
}

/// A file to scan
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileToScan {
    /// File path
    pub path: String,

    /// File content (text)
    pub content: String,
}

/// Scan profile from the server
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanProfile {
    /// Profile ID
    pub profile_id: String,

    /// Profile name
    pub name: String,

    /// PII types to detect
    pub pii_types: Vec<String>,

    /// File extensions to scan (e.g., [".txt", ".csv", ".xlsx"])
    pub file_extensions: Vec<String>,

    /// Paths to include in scan (supports wildcards)
    pub include_paths: Vec<String>,

    /// Paths to exclude from scan (supports wildcards)
    pub exclude_paths: Vec<String>,

    /// Maximum file size in bytes (skip larger files)
    #[serde(default = "default_max_file_size")]
    pub max_file_size: u64,

    /// Maximum files to scan
    #[serde(default = "default_max_files")]
    pub max_files: u32,

    /// Maximum directory depth
    #[serde(default = "default_max_depth")]
    pub max_depth: u32,
}

fn default_max_file_size() -> u64 {
    50 * 1024 * 1024 // 50 MB
}

fn default_max_files() -> u32 {
    100_000
}

fn default_max_depth() -> u32 {
    20
}

/// PII scan response (F090)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PiiScanResponse {
    /// Request ID for correlation
    pub request_id: String,

    /// Profile ID
    pub profile_id: String,

    /// Scan status
    pub status: ScanStatus,

    /// Files scanned count
    pub files_scanned: u32,

    /// Files skipped count
    pub files_skipped: u32,

    /// Total bytes scanned
    pub bytes_scanned: u64,

    /// Duration in milliseconds
    pub duration_ms: u64,

    /// PII findings (without actual values)
    pub findings: Vec<PiiFinding>,

    /// Errors encountered
    pub errors: Vec<ScanError>,
}

/// Scan status
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScanStatus {
    Completed,
    Partial,
    Failed,
}

/// A PII finding (does not contain actual PII value)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PiiFinding {
    /// Unique finding ID
    pub finding_id: String,

    /// PII type detected
    pub pii_type: String,

    /// File path where PII was found
    pub file_path: String,

    /// Line number (1-based) or page number for PDFs
    pub line_number: u32,

    /// Column/character offset (1-based)
    pub column: u32,

    /// Context snippet (redacted, shows pattern location)
    pub context: String,

    /// Confidence score (0.0 - 1.0)
    pub confidence: f32,

    /// Severity level
    pub severity: String,
}

/// Scan error
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanError {
    /// File path
    pub file_path: String,

    /// Error message
    pub error: String,

    /// Error code
    pub code: String,
}

/// Execute a PII scan on the provided request
///
/// This is the main entry point for scanning. The host agent should:
/// 1. Walk the filesystem according to include/exclude paths
/// 2. Read file contents for supported extensions
/// 3. Call this function with the collected files
///
/// # Arguments
/// * `config_json` - JSON-encoded PiiScanRequest
///
/// # Returns
/// JSON-encoded PiiScanResponse
pub fn scan(config_json: &str) -> String {
    // Parse the request
    let request: PiiScanRequest = match serde_json::from_str(config_json) {
        Ok(r) => r,
        Err(e) => {
            return serde_json::to_string(&PiiScanResponse {
                request_id: String::new(),
                profile_id: String::new(),
                status: ScanStatus::Failed,
                files_scanned: 0,
                files_skipped: 0,
                bytes_scanned: 0,
                duration_ms: 0,
                findings: vec![],
                errors: vec![ScanError {
                    file_path: String::new(),
                    error: format!("Failed to parse request: {}", e),
                    code: "PARSE_ERROR".to_string(),
                }],
            })
            .unwrap_or_else(|_| r#"{"status":"failed"}"#.to_string());
        }
    };

    // Create scanner
    let scanner = Scanner::new(&request.profile);

    // Scan all provided files
    let mut response = PiiScanResponse {
        request_id: request.request_id.clone(),
        profile_id: request.profile.profile_id.clone(),
        status: ScanStatus::Completed,
        files_scanned: 0,
        files_skipped: 0,
        bytes_scanned: 0,
        duration_ms: 0,
        findings: Vec::new(),
        errors: Vec::new(),
    };

    for file in &request.files {
        // Check if file should be excluded
        if scanner::should_exclude(&file.path, &request.profile.exclude_paths) {
            response.files_skipped += 1;
            continue;
        }

        // Check if extension is supported
        if !scanner::is_extension_supported(&file.path, &request.profile.file_extensions) {
            response.files_skipped += 1;
            continue;
        }

        // Scan the file content
        let findings = scanner.scan_text(&file.path, &file.content);
        response.findings.extend(findings);
        response.files_scanned += 1;
        response.bytes_scanned += file.content.len() as u64;
    }

    // Serialize response (F090: single response with all results)
    serde_json::to_string(&response)
        .unwrap_or_else(|_| r#"{"status":"failed"}"#.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scan_with_ssn() {
        let request = PiiScanRequest {
            request_id: "test-123".to_string(),
            profile: ScanProfile {
                profile_id: "profile-1".to_string(),
                name: "Test Profile".to_string(),
                pii_types: vec!["ssn".to_string()],
                file_extensions: vec![".txt".to_string()],
                include_paths: vec!["/home".to_string()],
                exclude_paths: vec![],
                max_file_size: 50 * 1024 * 1024,
                max_files: 100_000,
                max_depth: 20,
            },
            files: vec![FileToScan {
                path: "/home/user/test.txt".to_string(),
                content: "My SSN is 123-45-6789".to_string(),
            }],
        };

        let json = serde_json::to_string(&request).unwrap();
        let result_json = scan(&json);
        let response: PiiScanResponse = serde_json::from_str(&result_json).unwrap();

        assert_eq!(response.status, ScanStatus::Completed);
        assert_eq!(response.files_scanned, 1);
        assert_eq!(response.findings.len(), 1);
        assert_eq!(response.findings[0].pii_type, "ssn");
    }

    #[test]
    fn test_scan_with_exclusion() {
        let request = PiiScanRequest {
            request_id: "test-456".to_string(),
            profile: ScanProfile {
                profile_id: "profile-1".to_string(),
                name: "Test Profile".to_string(),
                pii_types: vec!["ssn".to_string()],
                file_extensions: vec![".txt".to_string()],
                include_paths: vec!["/home".to_string()],
                exclude_paths: vec!["**/node_modules/**".to_string()],
                max_file_size: 50 * 1024 * 1024,
                max_files: 100_000,
                max_depth: 20,
            },
            files: vec![FileToScan {
                path: "/home/project/node_modules/pkg/data.txt".to_string(),
                content: "SSN: 123-45-6789".to_string(),
            }],
        };

        let json = serde_json::to_string(&request).unwrap();
        let result_json = scan(&json);
        let response: PiiScanResponse = serde_json::from_str(&result_json).unwrap();

        assert_eq!(response.files_scanned, 0);
        assert_eq!(response.files_skipped, 1);
        assert_eq!(response.findings.len(), 0);
    }

    #[test]
    fn test_scan_status_serialization() {
        // Verify ScanStatus serializes correctly
        assert_eq!(serde_json::to_string(&ScanStatus::Completed).unwrap(), "\"completed\"");
        assert_eq!(serde_json::to_string(&ScanStatus::Partial).unwrap(), "\"partial\"");
        assert_eq!(serde_json::to_string(&ScanStatus::Failed).unwrap(), "\"failed\"");
    }
}

// Implement PartialEq for ScanStatus for tests
impl PartialEq for ScanStatus {
    fn eq(&self, other: &Self) -> bool {
        matches!(
            (self, other),
            (ScanStatus::Completed, ScanStatus::Completed) |
            (ScanStatus::Partial, ScanStatus::Partial) |
            (ScanStatus::Failed, ScanStatus::Failed)
        )
    }
}
