use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use base64::Engine;
use once_cell::sync::Lazy;
use reqwest::Client;
use serde_json::{json, Value};

use crate::engine::loader::SecretMaterial;
use crate::models::SecretEnvelope;

static SECRET_CACHE: Lazy<tokio::sync::RwLock<HashMap<String, Arc<CachedSecret>>>> =
    Lazy::new(|| tokio::sync::RwLock::new(HashMap::new()));

static VAULT_CLIENT: Lazy<Client> = Lazy::new(|| Client::builder().build().expect("vault client"));

/// Load ALGA_AUTH_KEY from env or file. If `ALGA_AUTH_KEY` is unset, reads
/// from `ALGA_AUTH_KEY_FILE` (default: /vault/secrets/alga_auth_key).
pub async fn load_alga_auth_key() -> Option<String> {
    if let Ok(k) = std::env::var("ALGA_AUTH_KEY") {
        let key = k.trim().to_string();
        if !key.is_empty() {
            let prefix: String = key.chars().take(4).collect();
            tracing::info!(key_len = key.len(), key_prefix = %prefix, source = "env", "ALGA_AUTH_KEY loaded");
            return Some(key);
        }
    }

    let path = std::env::var("ALGA_AUTH_KEY_FILE")
        .unwrap_or_else(|_| "/vault/secrets/alga_auth_key".to_string());
    match tokio::fs::read_to_string(&path).await {
        Ok(contents) => {
            let key = contents.trim().to_string();
            if key.is_empty() {
                tracing::warn!(path=%path, "ALGA_AUTH_KEY_FILE present but empty");
                None
            } else {
                let prefix: String = key.chars().take(4).collect();
                tracing::info!(key_len = key.len(), key_prefix = %prefix, source = "file", path=%path, "ALGA_AUTH_KEY loaded");
                Some(key)
            }
        }
        Err(_) => None,
    }
}

/// Decrypt a secret envelope into key/value pairs.
pub async fn decrypt_envelope(
    envelope: &SecretEnvelope,
) -> anyhow::Result<HashMap<String, String>> {
    if envelope.ciphertext_b64.trim().is_empty() {
        return Ok(HashMap::new());
    }

    match envelope
        .algorithm
        .as_ref()
        .map(|alg| alg.trim().to_ascii_lowercase())
    {
        Some(alg) if alg.starts_with("vault-transit") => decrypt_vault_envelope(envelope).await,
        _ => decrypt_inline_envelope(envelope),
    }
}

struct CachedSecret {
    material: SecretMaterial,
    expires_at: Instant,
    version: Option<String>,
    ciphertext_digest: String,
}

/// Resolve and cache decrypted secret material for the given install context.
/// Caches entries for a short TTL (30s) or up to the envelope's `expires_at`, whichever is sooner.
pub async fn resolve_secret_material(
    tenant_id: &str,
    extension_id: &str,
    install_id: Option<&str>,
    envelope: &SecretEnvelope,
) -> anyhow::Result<SecretMaterial> {
    let now = Instant::now();
    let digest = ciphertext_digest(envelope);
    let cache_key = cache_key(
        tenant_id,
        extension_id,
        install_id,
        &digest,
        envelope.version.as_deref(),
    );

    if let Some(entry) = SECRET_CACHE.read().await.get(&cache_key).cloned() {
        if now < entry.expires_at && entry.ciphertext_digest == digest {
            return Ok(entry.material.clone());
        }
    }

    let values = decrypt_envelope(envelope).await?;
    let material = SecretMaterial {
        values,
        version: envelope.version.clone(),
    };

    let ttl = compute_ttl(envelope, now);
    let cached = Arc::new(CachedSecret {
        material: material.clone(),
        expires_at: now + ttl,
        version: envelope.version.clone(),
        ciphertext_digest: digest,
    });
    SECRET_CACHE.write().await.insert(cache_key, cached);
    Ok(material)
}

fn cache_key(
    tenant_id: &str,
    extension_id: &str,
    install_id: Option<&str>,
    digest: &str,
    version: Option<&str>,
) -> String {
    let install = install_id.unwrap_or("");
    let version = version.unwrap_or("none");
    format!(
        "{}:{}:{}:{}:{}",
        tenant_id, extension_id, install, version, digest
    )
}

fn ciphertext_digest(envelope: &SecretEnvelope) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(envelope.ciphertext_b64.as_bytes());
    hex::encode(hasher.finalize())
}

fn compute_ttl(envelope: &SecretEnvelope, now: Instant) -> Duration {
    const DEFAULT_TTL: Duration = Duration::from_secs(30);
    if let Some(expires_at) = envelope.expires_at.as_deref() {
        if let Ok(expiration_time) = humantime::parse_rfc3339(expires_at) {
            if let Ok(duration_until_expiry) = expiration_time.duration_since(SystemTime::now()) {
                if !duration_until_expiry.is_zero() {
                    return duration_until_expiry.min(DEFAULT_TTL);
                }
            }
        }
    }
    DEFAULT_TTL
}

fn decrypt_inline_envelope(envelope: &SecretEnvelope) -> anyhow::Result<HashMap<String, String>> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&envelope.ciphertext_b64)
        .map_err(|e| anyhow::anyhow!("secret_envelope.base64_decode_failed: {}", e))?;
    let map: HashMap<String, String> = serde_json::from_slice(&bytes)
        .map_err(|e| anyhow::anyhow!("secret_envelope.json_parse_failed: {}", e))?;
    Ok(map)
}

async fn decrypt_vault_envelope(
    envelope: &SecretEnvelope,
) -> anyhow::Result<HashMap<String, String>> {
    let config = VaultTransitConfig::from_env(envelope.mount.as_deref())?;
    let key_path = envelope
        .key_path
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("secret_envelope.key_path missing for vault transit"))?;
    let plaintext = config.decrypt(key_path, &envelope.ciphertext_b64).await?;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(plaintext.trim())
        .map_err(|e| anyhow::anyhow!("vault_transit.plaintext_decode_failed: {}", e))?;
    let map: HashMap<String, String> = serde_json::from_slice(&decoded)
        .map_err(|e| anyhow::anyhow!("vault_transit.json_parse_failed: {}", e))?;
    Ok(map)
}

struct VaultTransitConfig {
    addr: String,
    token: String,
    namespace: Option<String>,
    mount: String,
}

impl VaultTransitConfig {
    fn from_env(override_mount: Option<&str>) -> anyhow::Result<Self> {
        let addr = std::env::var("VAULT_ADDR")
            .or_else(|_| std::env::var("ALGA_VAULT_ADDR"))
            .map_err(|_| anyhow::anyhow!("VAULT_ADDR not configured"))?;

        let token_path = std::env::var("ALGA_VAULT_TOKEN_FILE")
            .unwrap_or_else(|_| "/run/secrets/alga_vault_token".to_string());
        let token = fs::read_to_string(&token_path)
            .map_err(|e| anyhow::anyhow!("failed to read vault token {}: {}", token_path, e))?
            .trim()
            .to_string();
        if token.is_empty() {
            anyhow::bail!("vault token at {} is empty", token_path);
        }

        let namespace = std::env::var("VAULT_NAMESPACE").ok();
        let mount = override_mount
            .map(|m| m.to_string())
            .or_else(|| std::env::var("ALGA_VAULT_TRANSIT_MOUNT").ok())
            .unwrap_or_else(|| "transit".to_string());

        Ok(Self {
            addr,
            token,
            namespace,
            mount,
        })
    }

    async fn decrypt(&self, key_path: &str, ciphertext: &str) -> anyhow::Result<String> {
        let url = format!(
            "{}/v1/{}/decrypt/{}",
            self.addr.trim_end_matches('/'),
            self.mount.trim_matches('/'),
            key_path.trim_matches('/')
        );
        let mut req = VAULT_CLIENT.post(url).header("X-Vault-Token", &self.token);
        if let Some(ns) = &self.namespace {
            req = req.header("X-Vault-Namespace", ns);
        }
        let body = json!({ "ciphertext": ciphertext });
        let resp = req.json(&body).send().await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            anyhow::bail!("vault transit decrypt failed (status {}): {}", status, text);
        }
        let value: Value = resp.json().await?;
        let plaintext = value
            .get("data")
            .and_then(|d| d.get("plaintext"))
            .and_then(|p| p.as_str())
            .ok_or_else(|| anyhow::anyhow!("vault transit response missing data.plaintext"))?;
        Ok(plaintext.to_string())
    }
}
