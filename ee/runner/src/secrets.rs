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

    let path = std::env::var("ALGA_AUTH_KEY_FILE").unwrap_or_else(|_| "/vault/secrets/alga_auth_key".to_string());
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
