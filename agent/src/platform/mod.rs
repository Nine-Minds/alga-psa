//! Platform-specific implementations for Alga Endpoint Agent
//!
//! This module provides cross-platform abstractions for:
//! - Path normalization (F269-F270)
//! - Home directory expansion (F271)
//! - Default scan paths (F272-F274)
//! - Skip file detection (F275-F276)
//! - Cache directories (F277-F279)

pub mod paths;
pub mod skip;
pub mod cache;

pub use paths::*;
pub use skip::*;
pub use cache::*;

use std::path::{Path, PathBuf};

/// Platform detection enum
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Windows,
    MacOS,
    Linux,
}

impl Platform {
    /// Detect the current platform
    pub fn current() -> Self {
        #[cfg(target_os = "windows")]
        return Platform::Windows;

        #[cfg(target_os = "macos")]
        return Platform::MacOS;

        #[cfg(target_os = "linux")]
        return Platform::Linux;

        #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
        compile_error!("Unsupported platform");
    }

    /// Get the platform-specific path separator
    pub fn path_separator(&self) -> char {
        match self {
            Platform::Windows => '\\',
            Platform::MacOS | Platform::Linux => '/',
        }
    }
}
