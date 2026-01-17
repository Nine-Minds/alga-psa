//! Agent ID persistence
//!
//! Features:
//! - F293: Create new ID on first run, return existing ID on subsequent runs

use anyhow::{Context, Result};
use std::path::Path;
use tokio::fs;
use uuid::Uuid;

use crate::platform::cache::get_agent_id_path;

/// Agent identifier
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AgentId {
    /// Unique agent identifier (UUID v4)
    pub id: Uuid,

    /// Human-readable hostname
    pub hostname: String,

    /// Timestamp when ID was created
    pub created_at: u64,
}

impl AgentId {
    /// Create a new agent ID
    pub fn new() -> Self {
        Self {
            id: Uuid::new_v4(),
            hostname: gethostname::gethostname()
                .into_string()
                .unwrap_or_else(|_| "unknown".to_string()),
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        }
    }

    /// Get the agent ID as a string
    pub fn as_str(&self) -> String {
        self.id.to_string()
    }
}

impl Default for AgentId {
    fn default() -> Self {
        Self::new()
    }
}

/// Get or create the agent ID (F293)
///
/// - T384: Creates new ID on first run
/// - T385: Returns existing ID on subsequent runs
///
/// The ID is persisted to the config directory and reused across restarts.
pub async fn get_or_create_agent_id() -> Result<AgentId> {
    let id_path = get_agent_id_path();

    // Try to read existing ID (T385)
    if id_path.exists() {
        match load_agent_id(&id_path).await {
            Ok(id) => {
                tracing::debug!(agent_id = %id.id, "Loaded existing agent ID");
                return Ok(id);
            }
            Err(e) => {
                tracing::warn!("Failed to load agent ID, creating new one: {}", e);
            }
        }
    }

    // Create new ID (T384)
    let id = AgentId::new();
    save_agent_id(&id_path, &id).await?;

    tracing::info!(agent_id = %id.id, "Created new agent ID");
    Ok(id)
}

/// Load agent ID from file
async fn load_agent_id(path: &Path) -> Result<AgentId> {
    let bytes = fs::read(path)
        .await
        .context("Failed to read agent ID file")?;

    let id: AgentId = serde_json::from_slice(&bytes)
        .context("Failed to parse agent ID")?;

    Ok(id)
}

/// Save agent ID to file
async fn save_agent_id(path: &Path, id: &AgentId) -> Result<()> {
    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .await
            .context("Failed to create config directory")?;
    }

    let json = serde_json::to_string_pretty(id)
        .context("Failed to serialize agent ID")?;

    fs::write(path, json)
        .await
        .context("Failed to write agent ID file")?;

    Ok(())
}

/// Agent registration data sent to the server (F292, T383)
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AgentRegistration {
    /// Agent ID
    pub agent_id: String,

    /// Hostname
    pub hostname: String,

    /// Operating system
    pub os: String,

    /// OS version
    pub os_version: String,

    /// CPU architecture
    pub arch: String,

    /// Agent version
    pub agent_version: String,

    /// Timestamp
    pub registered_at: u64,
}

impl AgentRegistration {
    /// Create a registration from an agent ID
    pub fn from_agent_id(id: &AgentId, agent_version: &str) -> Self {
        Self {
            agent_id: id.id.to_string(),
            hostname: id.hostname.clone(),
            os: std::env::consts::OS.to_string(),
            os_version: get_os_version(),
            arch: std::env::consts::ARCH.to_string(),
            agent_version: agent_version.to_string(),
            registered_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        }
    }
}

/// Get the OS version string
fn get_os_version() -> String {
    #[cfg(target_os = "windows")]
    {
        // On Windows, try to get version from registry
        "Windows".to_string()
    }

    #[cfg(target_os = "macos")]
    {
        // On macOS, try sw_vers
        std::process::Command::new("sw_vers")
            .arg("-productVersion")
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| "macOS".to_string())
    }

    #[cfg(target_os = "linux")]
    {
        // On Linux, try /etc/os-release
        std::fs::read_to_string("/etc/os-release")
            .ok()
            .and_then(|s| {
                s.lines()
                    .find(|l| l.starts_with("PRETTY_NAME="))
                    .map(|l| l.trim_start_matches("PRETTY_NAME=").trim_matches('"').to_string())
            })
            .unwrap_or_else(|| "Linux".to_string())
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        "Unknown".to_string()
    }
}

// Add gethostname crate functionality
mod gethostname {
    use std::ffi::OsString;

    pub fn gethostname() -> OsString {
        #[cfg(unix)]
        {
            use std::os::unix::ffi::OsStringExt;
            let mut buf = vec![0u8; 256];
            unsafe {
                if libc::gethostname(buf.as_mut_ptr() as *mut libc::c_char, buf.len()) == 0 {
                    let len = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
                    buf.truncate(len);
                    return OsString::from_vec(buf);
                }
            }
            OsString::from("unknown")
        }

        #[cfg(windows)]
        {
            std::env::var("COMPUTERNAME")
                .map(OsString::from)
                .unwrap_or_else(|_| OsString::from("unknown"))
        }

        #[cfg(not(any(unix, windows)))]
        {
            OsString::from("unknown")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_agent_id_creation() {
        // T384: Creates new ID on first run
        let id = AgentId::new();
        assert!(!id.id.is_nil());
        assert!(!id.hostname.is_empty());
        assert!(id.created_at > 0);
    }

    #[test]
    fn test_agent_registration_serialization() {
        // T383: AgentRegistration struct serializes correctly
        let id = AgentId::new();
        let reg = AgentRegistration::from_agent_id(&id, "0.1.0");

        let json = serde_json::to_string(&reg).unwrap();
        assert!(json.contains(&id.id.to_string()));
        assert!(json.contains("0.1.0"));

        let parsed: AgentRegistration = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.agent_id, id.id.to_string());
    }

    #[tokio::test]
    async fn test_agent_id_persistence() {
        let dir = tempdir().unwrap();
        let id_path = dir.path().join("agent-id");

        // Create and save an ID
        let original_id = AgentId::new();
        save_agent_id(&id_path, &original_id).await.unwrap();

        // T385: Returns existing ID on subsequent runs
        let loaded_id = load_agent_id(&id_path).await.unwrap();
        assert_eq!(original_id.id, loaded_id.id);
    }
}
