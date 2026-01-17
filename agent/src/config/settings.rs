//! Agent settings and configuration

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::platform::cache::get_config_dir;

/// Agent settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    /// Server URL for API calls
    pub server_url: String,

    /// Tenant ID
    pub tenant_id: String,

    /// API key for authentication
    #[serde(skip_serializing)]
    pub api_key: Option<String>,

    /// Polling interval in seconds
    #[serde(default = "default_poll_interval")]
    pub poll_interval_seconds: u64,

    /// Enable debug logging
    #[serde(default)]
    pub debug: bool,
}

fn default_poll_interval() -> u64 {
    60 // 1 minute default
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            server_url: "https://app.algapsa.com".to_string(),
            tenant_id: String::new(),
            api_key: None,
            poll_interval_seconds: default_poll_interval(),
            debug: false,
        }
    }
}

impl Settings {
    /// Load settings from the config directory
    pub async fn load() -> Result<Self> {
        let config_path = get_config_dir().join("settings.toml");

        if !config_path.exists() {
            tracing::warn!(
                path = %config_path.display(),
                "Settings file not found, using defaults"
            );
            return Ok(Self::default());
        }

        let content = tokio::fs::read_to_string(&config_path)
            .await
            .context("Failed to read settings file")?;

        let settings: Settings = toml::from_str(&content)
            .context("Failed to parse settings file")?;

        Ok(settings)
    }

    /// Save settings to the config directory
    pub async fn save(&self) -> Result<()> {
        let config_dir = get_config_dir();
        let config_path = config_dir.join("settings.toml");

        // Ensure directory exists
        tokio::fs::create_dir_all(&config_dir)
            .await
            .context("Failed to create config directory")?;

        let content = toml::to_string_pretty(self)
            .context("Failed to serialize settings")?;

        tokio::fs::write(&config_path, content)
            .await
            .context("Failed to write settings file")?;

        Ok(())
    }

    /// Load API key from environment or keychain
    pub fn load_api_key(&mut self) -> Result<()> {
        // First try environment variable
        if let Ok(key) = std::env::var("ALGA_API_KEY") {
            self.api_key = Some(key);
            return Ok(());
        }

        // TODO: Try system keychain (platform-specific)

        Ok(())
    }
}

/// Server-provided configuration for the agent (F295)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    /// Extension manifests to install
    pub extensions: Vec<ExtensionConfig>,

    /// Configuration refresh interval
    pub refresh_interval_seconds: u64,

    /// Server time for clock sync
    pub server_time_ms: u64,
}

/// Configuration for an extension
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtensionConfig {
    /// Extension ID
    pub extension_id: String,

    /// Version ID
    pub version_id: String,

    /// Download URL
    pub download_url: String,

    /// Content hash for verification
    pub content_hash: String,

    /// File size
    pub size_bytes: u64,

    /// Enabled status
    pub enabled: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_settings_default() {
        let settings = Settings::default();
        assert_eq!(settings.poll_interval_seconds, 60);
        assert!(!settings.debug);
    }

    #[test]
    fn test_settings_serialization() {
        let settings = Settings {
            server_url: "https://example.com".to_string(),
            tenant_id: "tenant-123".to_string(),
            api_key: Some("secret".to_string()),
            poll_interval_seconds: 30,
            debug: true,
        };

        let toml_str = toml::to_string(&settings).unwrap();
        assert!(toml_str.contains("https://example.com"));
        assert!(toml_str.contains("tenant-123"));
        // API key should not be serialized
        assert!(!toml_str.contains("secret"));
    }
}
