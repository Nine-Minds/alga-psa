//! Configuration management for the Remote Desktop Agent

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// Main configuration structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub agent: AgentConfig,
    pub server: ServerConfig,
    pub capture: CaptureConfig,
    pub network: NetworkConfig,
    pub logging: LoggingConfig,
}

/// Agent identification and authentication
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub agent_id: String,
    pub agent_name: String,
    pub connection_token: String,
}

/// Server connection settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub signaling_url: String,
    pub api_url: String,
}

/// Screen capture settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureConfig {
    pub fps: u32,
    pub quality: u8,
    pub max_width: u32,
    pub max_height: u32,
}

/// Network and WebRTC settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkConfig {
    pub stun_servers: Vec<String>,
    pub reconnect_interval_ms: u64,
    pub max_reconnect_attempts: u32,
}

/// Logging settings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoggingConfig {
    pub level: String,
    pub file: String,
}

impl Config {
    /// Load configuration from a TOML file
    pub fn load<P: AsRef<Path>>(path: P) -> Result<Self> {
        let config_str = fs::read_to_string(path.as_ref())
            .with_context(|| format!("Failed to read config file: {:?}", path.as_ref()))?;

        let config: Config = toml::from_str(&config_str)
            .context("Failed to parse config file")?;

        config.validate()?;

        Ok(config)
    }

    /// Load configuration from the default path (config.toml in current directory)
    pub fn load_default() -> Result<Self> {
        Self::load("config.toml")
    }

    /// Validate the configuration
    fn validate(&self) -> Result<()> {
        if self.agent.agent_id.is_empty() {
            anyhow::bail!("Agent ID is not configured. Please register the agent first.");
        }

        if self.agent.connection_token.is_empty() {
            anyhow::bail!("Connection token is not configured. Please register the agent first.");
        }

        if self.server.signaling_url.is_empty() {
            anyhow::bail!("Signaling URL is not configured.");
        }

        if self.capture.fps == 0 || self.capture.fps > 60 {
            anyhow::bail!("FPS must be between 1 and 60");
        }

        if self.capture.quality > 100 {
            anyhow::bail!("Quality must be between 0 and 100");
        }

        Ok(())
    }

    /// Save configuration to a TOML file
    pub fn save<P: AsRef<Path>>(&self, path: P) -> Result<()> {
        let config_str = toml::to_string_pretty(self)
            .context("Failed to serialize config")?;

        fs::write(path.as_ref(), config_str)
            .with_context(|| format!("Failed to write config file: {:?}", path.as_ref()))?;

        Ok(())
    }
}

impl Default for Config {
    fn default() -> Self {
        Config {
            agent: AgentConfig {
                agent_id: String::new(),
                agent_name: String::new(),
                connection_token: String::new(),
            },
            server: ServerConfig {
                signaling_url: "ws://localhost:3000/ws/rd-signal".to_string(),
                api_url: "http://localhost:3000/api/v1/remote-desktop".to_string(),
            },
            capture: CaptureConfig {
                fps: 15,
                quality: 75,
                max_width: 1920,
                max_height: 1080,
            },
            network: NetworkConfig {
                stun_servers: vec![
                    "stun:stun.l.google.com:19302".to_string(),
                    "stun:stun1.l.google.com:19302".to_string(),
                ],
                reconnect_interval_ms: 5000,
                max_reconnect_attempts: 10,
            },
            logging: LoggingConfig {
                level: "info".to_string(),
                file: String::new(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = Config::default();
        assert_eq!(config.capture.fps, 15);
        assert_eq!(config.capture.quality, 75);
    }

    #[test]
    fn test_validation_fails_without_agent_id() {
        let mut config = Config::default();
        config.agent.connection_token = "test".to_string();

        let result = config.validate();
        assert!(result.is_err());
    }
}
