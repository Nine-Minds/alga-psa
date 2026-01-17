//! Extension capability definitions and security controls
//!
//! Features:
//! - F296: PII_SCANNER_CAPS allowed capabilities (fs.read, fs.walk, fs.metadata, context.read, log.emit)
//! - F297: Deny fs.write capability
//! - F298: Deny fs.delete capability
//! - F299: Deny http.fetch capability (no network exfiltration)
//! - F300: Deny process.exec capability
//! - F301: Memory limits (512 MB per instance)

use std::collections::HashSet;

/// Capability identifiers for extensions
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Capability {
    // File system capabilities
    FsRead,      // Read files
    FsWrite,     // Write files (DENIED for security)
    FsDelete,    // Delete files (DENIED for security)
    FsWalk,      // Walk directories
    FsMetadata,  // Get file metadata
    FsGlob,      // Glob pattern matching

    // Context capabilities
    ContextRead, // Read context (tenant_id, agent_id, etc.)

    // Logging capabilities
    LogEmit,     // Emit log messages

    // Network capabilities (DENIED for security)
    HttpFetch,   // Make HTTP requests (DENIED - prevents exfiltration)

    // Process capabilities (DENIED for security)
    ProcessExec, // Execute processes (DENIED - prevents RCE)
}

impl Capability {
    /// Get the string identifier for this capability
    pub fn as_str(&self) -> &'static str {
        match self {
            Capability::FsRead => "fs.read",
            Capability::FsWrite => "fs.write",
            Capability::FsDelete => "fs.delete",
            Capability::FsWalk => "fs.walk",
            Capability::FsMetadata => "fs.metadata",
            Capability::FsGlob => "fs.glob",
            Capability::ContextRead => "context.read",
            Capability::LogEmit => "log.emit",
            Capability::HttpFetch => "http.fetch",
            Capability::ProcessExec => "process.exec",
        }
    }
}

/// Capability set for an extension
#[derive(Debug, Clone)]
pub struct CapabilitySet {
    /// Allowed capabilities
    allowed: HashSet<Capability>,

    /// Explicitly denied capabilities
    denied: HashSet<Capability>,

    /// Memory limit in bytes (F301)
    memory_limit_bytes: u64,

    /// Execution timeout in milliseconds
    timeout_ms: u64,
}

impl CapabilitySet {
    /// Create a new empty capability set
    pub fn new() -> Self {
        Self {
            allowed: HashSet::new(),
            denied: HashSet::new(),
            memory_limit_bytes: 512 * 1024 * 1024, // 512 MB default
            timeout_ms: 5 * 60 * 1000,             // 5 minutes default
        }
    }

    /// Add an allowed capability
    pub fn allow(mut self, cap: Capability) -> Self {
        self.allowed.insert(cap);
        self.denied.remove(&cap);
        self
    }

    /// Explicitly deny a capability
    pub fn deny(mut self, cap: Capability) -> Self {
        self.denied.insert(cap);
        self.allowed.remove(&cap);
        self
    }

    /// Set memory limit (F301)
    pub fn with_memory_limit(mut self, bytes: u64) -> Self {
        self.memory_limit_bytes = bytes;
        self
    }

    /// Set execution timeout
    pub fn with_timeout(mut self, ms: u64) -> Self {
        self.timeout_ms = ms;
        self
    }

    /// Check if a capability is allowed
    pub fn is_allowed(&self, cap: Capability) -> bool {
        !self.denied.contains(&cap) && self.allowed.contains(&cap)
    }

    /// Check if a capability is denied
    pub fn is_denied(&self, cap: Capability) -> bool {
        self.denied.contains(&cap)
    }

    /// Get the memory limit
    pub fn memory_limit(&self) -> u64 {
        self.memory_limit_bytes
    }

    /// Get the timeout
    pub fn timeout_ms(&self) -> u64 {
        self.timeout_ms
    }

    /// Get all allowed capabilities
    pub fn allowed_capabilities(&self) -> impl Iterator<Item = &Capability> {
        self.allowed.iter()
    }
}

impl Default for CapabilitySet {
    fn default() -> Self {
        Self::new()
    }
}

/// PII Scanner extension capabilities (F296-F300)
///
/// The PII Scanner has read-only file system access and cannot:
/// - Write to the filesystem (F297)
/// - Delete files (F298)
/// - Make network requests (F299)
/// - Execute processes (F300)
pub fn pii_scanner_capabilities() -> CapabilitySet {
    CapabilitySet::new()
        // F296: Allowed capabilities
        .allow(Capability::FsRead)      // Read file contents
        .allow(Capability::FsWalk)      // Walk directories
        .allow(Capability::FsMetadata)  // Get file info
        .allow(Capability::FsGlob)      // Pattern matching
        .allow(Capability::ContextRead) // Read context
        .allow(Capability::LogEmit)     // Emit logs

        // Security denials (F297-F300)
        .deny(Capability::FsWrite)      // F297: No writing
        .deny(Capability::FsDelete)     // F298: No deleting
        .deny(Capability::HttpFetch)    // F299: No network (prevents PII exfiltration)
        .deny(Capability::ProcessExec)  // F300: No process execution

        // F301: Memory limit
        .with_memory_limit(512 * 1024 * 1024) // 512 MB

        // Timeout
        .with_timeout(5 * 60 * 1000) // 5 minutes
}

/// Constant definition for PII Scanner capabilities (for TypeScript interop)
pub const PII_SCANNER_CAPS: &[&str] = &[
    "fs.read",
    "fs.walk",
    "fs.metadata",
    "fs.glob",
    "context.read",
    "log.emit",
];

/// Capabilities that are always denied for security
pub const ALWAYS_DENIED_CAPS: &[&str] = &[
    "fs.write",
    "fs.delete",
    "http.fetch",
    "process.exec",
];

/// Verify that a capability check matches expected behavior
pub fn verify_capability(caps: &CapabilitySet, cap: Capability, expect_allowed: bool) -> bool {
    caps.is_allowed(cap) == expect_allowed
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pii_scanner_allowed_capabilities() {
        let caps = pii_scanner_capabilities();

        // T389: PII Scanner has only allowed capabilities
        assert!(caps.is_allowed(Capability::FsRead));
        assert!(caps.is_allowed(Capability::FsWalk));
        assert!(caps.is_allowed(Capability::FsMetadata));
        assert!(caps.is_allowed(Capability::ContextRead));
        assert!(caps.is_allowed(Capability::LogEmit));
    }

    #[test]
    fn test_pii_scanner_denied_fs_write() {
        // T390: Extension cannot call fs.write
        let caps = pii_scanner_capabilities();
        assert!(caps.is_denied(Capability::FsWrite));
        assert!(!caps.is_allowed(Capability::FsWrite));
    }

    #[test]
    fn test_pii_scanner_denied_fs_delete() {
        // T391: Extension cannot call fs.delete
        let caps = pii_scanner_capabilities();
        assert!(caps.is_denied(Capability::FsDelete));
        assert!(!caps.is_allowed(Capability::FsDelete));
    }

    #[test]
    fn test_pii_scanner_denied_http_fetch() {
        // T392: Extension cannot call http.fetch
        let caps = pii_scanner_capabilities();
        assert!(caps.is_denied(Capability::HttpFetch));
        assert!(!caps.is_allowed(Capability::HttpFetch));
    }

    #[test]
    fn test_pii_scanner_denied_process_exec() {
        // T393: Extension cannot call process.exec
        let caps = pii_scanner_capabilities();
        assert!(caps.is_denied(Capability::ProcessExec));
        assert!(!caps.is_allowed(Capability::ProcessExec));
    }

    #[test]
    fn test_pii_scanner_memory_limit() {
        // T337, T394: Memory limit is 512 MB
        let caps = pii_scanner_capabilities();
        assert_eq!(caps.memory_limit(), 512 * 1024 * 1024);
    }

    #[test]
    fn test_capability_set_builder() {
        let caps = CapabilitySet::new()
            .allow(Capability::FsRead)
            .deny(Capability::FsWrite)
            .with_memory_limit(100 * 1024 * 1024);

        assert!(caps.is_allowed(Capability::FsRead));
        assert!(caps.is_denied(Capability::FsWrite));
        assert_eq!(caps.memory_limit(), 100 * 1024 * 1024);
    }

    #[test]
    fn test_capability_as_str() {
        assert_eq!(Capability::FsRead.as_str(), "fs.read");
        assert_eq!(Capability::FsWrite.as_str(), "fs.write");
        assert_eq!(Capability::HttpFetch.as_str(), "http.fetch");
        assert_eq!(Capability::ProcessExec.as_str(), "process.exec");
    }
}
