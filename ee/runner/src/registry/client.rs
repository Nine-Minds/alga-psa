use anyhow::Result;
use async_trait::async_trait;
use moka::future::Cache;
use std::time::Duration;
use tokio::time::timeout;
use url::Url;

/// Registry validation client trait. Validates a tenant/extension/content-hash mapping.
#[async_trait]
pub trait RegistryClient: Send + Sync {
    async fn validate_install(
        &self,
        tenant_id: &str,
        extension_id: &str,
        content_hash: &str,
    ) -> Result<bool>;
}

/// HTTP-backed client with a short TTL cache. When strict validation is disabled (EXT_STATIC_STRICT_VALIDATION != "true"),
/// this client will always return Ok(true).
pub struct HttpRegistryClient {
    strict: bool,
    base_url: Option<Url>,
    cache: Cache<String, bool>,
    http: reqwest::Client,
    api_key: Option<String>,
}

impl HttpRegistryClient {
    pub fn new(api_key: Option<String>) -> Result<Self> {
        let strict = std::env::var("EXT_STATIC_STRICT_VALIDATION")
            .map(|v| v.trim().eq_ignore_ascii_case("true"))
            .unwrap_or(true);

        let base_url = std::env::var("REGISTRY_BASE_URL")
            .ok()
            .and_then(|s| Url::parse(&s).ok());

        let cache = Cache::builder()
            .max_capacity(10_000)
            .time_to_live(Duration::from_secs(45))
            .build();

        let http = reqwest::Client::builder().build()?;

        // Optional API key auth for registry requests
        let api_key = api_key.or_else(|| {
            std::env::var("ALGA_AUTH_KEY").ok().and_then(|s| {
                let t = s.trim().to_string();
                if t.is_empty() {
                    None
                } else {
                    Some(t)
                }
            })
        });

        if let Some(ref k) = api_key {
            let prefix: String = k.chars().take(4).collect();
            tracing::info!(key_len = k.len(), key_prefix = %prefix, "ALGA_AUTH_KEY present for validation client");
        } else {
            tracing::warn!("ALGA_AUTH_KEY not set for validation client; strict validation calls may be unauthorized");
        }

        Ok(Self {
            strict,
            base_url,
            cache,
            http,
            api_key,
        })
    }

    fn cache_key(tenant_id: &str, extension_id: &str, content_hash: &str) -> String {
        format!("{}:{}:{}", tenant_id, extension_id, content_hash)
    }
}

#[async_trait]
impl RegistryClient for HttpRegistryClient {
    async fn validate_install(
        &self,
        tenant_id: &str,
        extension_id: &str,
        content_hash: &str,
    ) -> Result<bool> {
        tracing::info!(tenant=%tenant_id, extension=%extension_id, content_hash=%content_hash, "Registry validation request started");

        // Short-circuit if strict validation disabled.
        if !self.strict {
            tracing::info!(tenant=%tenant_id, extension=%extension_id, content_hash=%content_hash, "Strict validation disabled - allowing request");
            return Ok(true);
        }

        tracing::info!(tenant=%tenant_id, extension=%extension_id, content_hash=%content_hash, "Strict validation enabled - checking registry");

        // Missing base URL in strict mode - treat as not validated.
        let Some(base) = &self.base_url else {
            tracing::warn!(tenant=%tenant_id, extension=%extension_id, content_hash=%content_hash, "Registry base URL not configured in strict mode - denying validation");
            return Ok(false);
        };

        let key = Self::cache_key(tenant_id, extension_id, content_hash);
        if let Some(v) = self.cache.get(&key).await {
            tracing::info!(tenant=%tenant_id, extension=%extension_id, content_hash=%content_hash, cached=%v, "Registry validation served from cache");
            return Ok(v);
        }

        tracing::info!(tenant=%tenant_id, extension=%extension_id, content_hash=%content_hash, "Registry validation not in cache - querying registry");

        // Compose a GET to something like: {base}/api/installs/validate?tenant=...&extension=...&hash=...
        let mut url = base.clone();
        // Minimal stub endpoint path - subject to change when real registry is wired
        let path = "api/installs/validate";
        url.set_path(path);
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        url.query_pairs_mut()
            .append_pair("tenant", tenant_id)
            .append_pair("extension", extension_id)
            .append_pair("hash", content_hash)
            .append_pair("ts", &now_ms.to_string());

        // Keep fast timeout
        let mut rb = self.http.get(url.clone());

        if let Some(key) = &self.api_key {
            let key_prefix: String = key.chars().take(4).collect();
            tracing::info!(tenant=%tenant_id, extension=%extension_id, content_hash=%content_hash, key_len=%key.len(), key_prefix=%key_prefix, "Attaching API key to registry request");
            rb = rb.header("x-api-key", key);
        } else {
            tracing::warn!(tenant=%tenant_id, extension=%extension_id, content_hash=%content_hash, "No API key configured - registry request may be unauthorized");
        }

        let req = rb.build()?;
        let fut = self.http.execute(req);

        tracing::info!(tenant=%tenant_id, extension=%extension_id, content_hash=%content_hash, registry_url=%url.to_string(), "Sending validation request to registry (750ms timeout)");

        // 750ms budget to avoid head-of-line blocking on hot path
        let resp = match timeout(Duration::from_millis(750), fut).await {
            Ok(Ok(r)) => {
                tracing::info!(tenant=%tenant_id, extension=%extension_id, content_hash=%content_hash, status=%r.status().as_u16(), "Registry validation response received");
                r
            }
            Ok(Err(e)) => {
                tracing::error!(tenant=%tenant_id, extension=%extension_id, content_hash=%content_hash, err=%e.to_string(), "Registry validation request failed");
                tracing::warn!(tenant=%tenant_id, extension=%extension_id, content_hash=%content_hash, "On request failure in strict mode - denying validation");
                self.cache.insert(key, false).await;
                return Ok(false);
            }
            Err(_e) => {
                tracing::error!(tenant=%tenant_id, extension=%extension_id, content_hash=%content_hash, timeout_ms=750u64, "Registry validation request timed out");
                tracing::warn!(tenant=%tenant_id, extension=%extension_id, content_hash=%content_hash, "On timeout in strict mode - denying validation");
                self.cache.insert(key, false).await;
                return Ok(false);
            }
        };

        // Interpret JSON { valid: bool } or truthy status 200
        let status = resp.status();
        let valid = if status.is_success() {
            match resp.text().await {
                Ok(txt) => {
                    let valid_val = serde_json::from_str::<serde_json::Value>(&txt)
                        .ok()
                        .and_then(|v| v.get("valid").and_then(|b| b.as_bool()))
                        .unwrap_or(false);

                    tracing::info!(tenant=%tenant_id, extension=%extension_id, content_hash=%content_hash, status=%status.as_u16(), body_len=%txt.len(), valid=%valid_val, "Registry validation response parsed");
                    if txt.len() > 0 {
                        tracing::debug!(tenant=%tenant_id, extension=%extension_id, content_hash=%content_hash, body_sample=%txt.chars().take(200).collect::<String>(), "Registry response body");
                    }

                    valid_val
                }
                Err(_e) => {
                    tracing::error!(tenant=%tenant_id, extension=%extension_id, content_hash=%content_hash, "Failed to parse registry validation response body");
                    false
                }
            }
        } else {
            tracing::warn!(tenant=%tenant_id, extension=%extension_id, content_hash=%content_hash, status=%status.as_u16(), "Registry returned non-success status");
            false
        };

        self.cache.insert(key, valid).await;
        if valid {
            tracing::info!(tenant=%tenant_id, extension=%extension_id, content_hash=%content_hash, "Registry validation APPROVED - extension allowed");
        } else {
            tracing::warn!(tenant=%tenant_id, extension=%extension_id, content_hash=%content_hash, "Registry validation DENIED - extension not allowed");
        }

        Ok(valid)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    struct AllowAll;
    #[async_trait]
    impl RegistryClient for AllowAll {
        async fn validate_install(
            &self,
            _tenant_id: &str,
            _extension_id: &str,
            _content_hash: &str,
        ) -> Result<bool> {
            Ok(true)
        }
    }

    #[tokio::test]
    async fn cache_key_format() {
        let k = HttpRegistryClient::cache_key("t", "e", "h");
        assert_eq!(k, "t:e:h");
    }

    #[tokio::test]
    async fn trait_object_smoke() {
        let c: Arc<dyn RegistryClient + Send + Sync> = Arc::new(AllowAll);
        assert!(c.validate_install("t", "e", "sha256:abc").await.unwrap());
    }
}
