use anyhow::Result;
use async_trait::async_trait;
use moka::future::Cache;
use serde::Deserialize;
use std::{sync::Arc, time::Duration};
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
        // Short-circuit if strict validation disabled.
        if !self.strict {
            return Ok(true);
        }

        // Missing base URL in strict mode - treat as not validated.
        let Some(base) = &self.base_url else {
            return Ok(false);
        };

        let key = Self::cache_key(tenant_id, extension_id, content_hash);
        if let Some(v) = self.cache.get(&key).await {
            return Ok(v);
        }

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
        let mut rb = self.http.get(url);

        if let Some(key) = &self.api_key {
            rb = rb.header("x-api-key", key);
        }
        let req = rb.build()?;
        let fut = self.http.execute(req);

        // 750ms budget to avoid head-of-line blocking on hot path
        let resp = match timeout(Duration::from_millis(750), fut).await {
            Ok(Ok(r)) => r,
            _ => {
                // On timeout/error in strict mode, be conservative and deny
                self.cache.insert(key, false).await;
                return Ok(false);
            }
        };

        // Interpret JSON { valid: bool } or truthy status 200
        let valid = if resp.status().is_success() {
            match resp.text().await {
                Ok(txt) => {
                    tracing::info!(tenant=%tenant_id, extension=%extension_id, hash=%content_hash, status=200u16, body_len=%txt.len(), body_sample=%txt.chars().take(200).collect::<String>(), "validate response body");
                    serde_json::from_str::<serde_json::Value>(&txt)
                        .ok()
                        .and_then(|v| v.get("valid").and_then(|b| b.as_bool()))
                        .unwrap_or(false)
                }
                Err(_) => false,
            }
        } else {
            false
        };

        self.cache.insert(key, valid).await;
        Ok(valid)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
