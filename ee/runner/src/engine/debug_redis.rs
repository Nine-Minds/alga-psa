use crate::engine::debug::ExtDebugEvent;
use once_cell::sync::OnceCell;
use redis::{aio::ConnectionManager, Client, ErrorKind, RedisError};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;

/// Configuration for the Redis publisher, stored separately so we can reconnect.
struct RedisConfig {
    url: String,
    stream_prefix: String,
    max_len: usize,
}

/// State of the Redis connection.
enum ConnectionState {
    Connected(ConnectionManager),
    Disconnected,
    Connecting,
}

struct RedisPublisher {
    config: RedisConfig,
    conn: RwLock<ConnectionState>,
    /// Consecutive failure count for backoff
    consecutive_failures: AtomicU64,
    /// Last reconnect attempt timestamp (unix millis)
    last_reconnect_attempt: AtomicU64,
}

impl RedisPublisher {
    async fn new(url: String, stream_prefix: String, max_len: usize) -> anyhow::Result<Self> {
        let client = Client::open(url.as_str())?;
        let conn = ConnectionManager::new(client).await?;
        Ok(Self {
            config: RedisConfig {
                url,
                stream_prefix,
                max_len,
            },
            conn: RwLock::new(ConnectionState::Connected(conn)),
            consecutive_failures: AtomicU64::new(0),
            last_reconnect_attempt: AtomicU64::new(0),
        })
    }

    fn stream_name(&self, event: &ExtDebugEvent) -> String {
        let mut parts = Vec::new();
        if let Some(tenant) = event.tenant_id.as_deref() {
            parts.push(tenant.to_ascii_lowercase());
        }
        if let Some(ext) = event.extension_id.as_deref() {
            parts.push(ext.to_ascii_lowercase());
        }
        if parts.is_empty() {
            parts.push("unknown".to_string());
        }
        format!("{}{}", self.config.stream_prefix, parts.join(":"))
    }

    /// Check if an error indicates a broken connection that requires reconnection.
    fn is_connection_error(err: &RedisError) -> bool {
        matches!(
            err.kind(),
            ErrorKind::IoError
                | ErrorKind::BusyLoadingError
                | ErrorKind::TryAgain
                | ErrorKind::MasterDown
        ) || err.to_string().to_lowercase().contains("broken pipe")
            || err.to_string().to_lowercase().contains("connection reset")
            || err.to_string().to_lowercase().contains("connection refused")
            || err.to_string().to_lowercase().contains("not connected")
    }

    /// Calculate backoff duration based on consecutive failures.
    fn backoff_duration(&self) -> Duration {
        let failures = self.consecutive_failures.load(Ordering::Relaxed);
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
        let secs = std::cmp::min(30, 1u64 << std::cmp::min(failures, 5));
        Duration::from_secs(secs)
    }

    /// Check if enough time has passed since last reconnect attempt.
    fn should_attempt_reconnect(&self) -> bool {
        let last_attempt = self.last_reconnect_attempt.load(Ordering::Relaxed);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let backoff = self.backoff_duration();
        now.saturating_sub(last_attempt) >= backoff.as_millis() as u64
    }

    /// Attempt to reconnect to Redis.
    async fn reconnect(&self) -> bool {
        // Update last attempt timestamp
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        self.last_reconnect_attempt.store(now, Ordering::Relaxed);

        // Mark as connecting
        {
            let mut state = self.conn.write().await;
            *state = ConnectionState::Connecting;
        }

        tracing::info!("attempting to reconnect to debug redis");

        match Client::open(self.config.url.as_str()) {
            Ok(client) => match ConnectionManager::new(client).await {
                Ok(conn) => {
                    let mut state = self.conn.write().await;
                    *state = ConnectionState::Connected(conn);
                    self.consecutive_failures.store(0, Ordering::Relaxed);
                    tracing::info!("successfully reconnected to debug redis");
                    true
                }
                Err(err) => {
                    let mut state = self.conn.write().await;
                    *state = ConnectionState::Disconnected;
                    self.consecutive_failures.fetch_add(1, Ordering::Relaxed);
                    tracing::warn!(error=%err, "failed to reconnect to debug redis");
                    false
                }
            },
            Err(err) => {
                let mut state = self.conn.write().await;
                *state = ConnectionState::Disconnected;
                self.consecutive_failures.fetch_add(1, Ordering::Relaxed);
                tracing::warn!(error=%err, "failed to create redis client for reconnection");
                false
            }
        }
    }

    /// Mark connection as disconnected and trigger reconnect if appropriate.
    async fn handle_connection_error(&self, err: &RedisError) {
        if Self::is_connection_error(err) {
            tracing::warn!(error=%err, "detected connection error, marking disconnected");
            {
                let mut state = self.conn.write().await;
                if matches!(*state, ConnectionState::Connected(_)) {
                    *state = ConnectionState::Disconnected;
                }
            }
            // Attempt immediate reconnect if backoff allows
            if self.should_attempt_reconnect() {
                self.reconnect().await;
            }
        }
    }

    async fn publish(&self, event: &ExtDebugEvent) -> redis::RedisResult<()> {
        // Check if we need to reconnect first
        {
            let state = self.conn.read().await;
            if matches!(*state, ConnectionState::Disconnected) {
                drop(state); // Release read lock before attempting reconnect
                if self.should_attempt_reconnect() {
                    self.reconnect().await;
                } else {
                    return Err(RedisError::from((
                        ErrorKind::IoError,
                        "not connected to redis, waiting for backoff",
                    )));
                }
            }
        }

        let stream = self.stream_name(event);

        // Build and execute command
        let result = {
            let state = self.conn.read().await;
            match &*state {
                ConnectionState::Connected(conn) => {
                    let mut conn = conn.clone();
                    drop(state); // Release lock before async operation

                    let mut cmd = redis::cmd("XADD");
                    cmd.arg(&stream)
                        .arg("MAXLEN")
                        .arg("~")
                        .arg(self.config.max_len)
                        .arg("*")
                        .arg("ts")
                        .arg(&event.ts)
                        .arg("level")
                        .arg(&event.level)
                        .arg("stream")
                        .arg(&event.stream);
                    if let Some(tenant) = &event.tenant_id {
                        cmd.arg("tenant").arg(tenant);
                    }
                    if let Some(ext) = &event.extension_id {
                        cmd.arg("extension").arg(ext);
                    }
                    if let Some(install) = &event.install_id {
                        cmd.arg("install").arg(install);
                    }
                    if let Some(request) = &event.request_id {
                        cmd.arg("request").arg(request);
                    }
                    if let Some(version) = &event.version_id {
                        cmd.arg("version").arg(version);
                    }
                    if let Some(hash) = &event.content_hash {
                        cmd.arg("content_hash").arg(hash);
                    }
                    cmd.arg("message").arg(&event.message);
                    cmd.arg("truncated")
                        .arg(if event.truncated { "1" } else { "0" });

                    cmd.query_async(&mut conn).await
                }
                _ => Err(RedisError::from((
                    ErrorKind::IoError,
                    "not connected to redis",
                ))),
            }
        };

        // Handle errors and trigger reconnection if needed
        if let Err(ref err) = result {
            self.handle_connection_error(err).await;
        } else {
            // Reset failure count on success
            self.consecutive_failures.store(0, Ordering::Relaxed);
        }

        result
    }
}

static PUBLISHER: OnceCell<Option<Arc<RedisPublisher>>> = OnceCell::new();

/// Build a Redis connection URL, injecting the password if provided separately.
fn build_redis_url(base_url: &str, password: Option<&str>) -> String {
    let password = match password {
        Some(p) if !p.is_empty() => p,
        _ => return base_url.to_string(),
    };

    // Parse the URL and inject password: redis://host:port -> redis://:password@host:port
    if let Some(rest) = base_url.strip_prefix("redis://") {
        // Check if URL already has credentials (contains @ before first /)
        let host_part = rest.split('/').next().unwrap_or(rest);
        if host_part.contains('@') {
            // Already has credentials, don't override
            return base_url.to_string();
        }
        // URL-encode the password to handle special characters
        let encoded_password = urlencoding::encode(password);
        format!("redis://:{}@{}", encoded_password, rest)
    } else if let Some(rest) = base_url.strip_prefix("rediss://") {
        let host_part = rest.split('/').next().unwrap_or(rest);
        if host_part.contains('@') {
            return base_url.to_string();
        }
        let encoded_password = urlencoding::encode(password);
        format!("rediss://:{}@{}", encoded_password, rest)
    } else {
        // Unknown scheme, return as-is
        base_url.to_string()
    }
}

pub async fn init_from_env() {
    let base_url = match std::env::var("RUNNER_DEBUG_REDIS_URL") {
        Ok(v) if !v.is_empty() => v,
        _ => {
            let _ = PUBLISHER.set(None);
            return;
        }
    };

    let password = std::env::var("RUNNER_DEBUG_REDIS_PASSWORD").ok();
    let url = build_redis_url(&base_url, password.as_deref());

    let stream_prefix = std::env::var("RUNNER_DEBUG_REDIS_STREAM_PREFIX")
        .unwrap_or_else(|_| "ext-debug:".to_string());
    let max_len = std::env::var("RUNNER_DEBUG_REDIS_MAXLEN")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(2000);

    match RedisPublisher::new(url, stream_prefix.clone(), max_len).await {
        Ok(publisher) => {
            let arc = Arc::new(publisher);
            tracing::info!(stream_prefix = %stream_prefix, "debug redis publisher enabled");
            let _ = PUBLISHER.set(Some(arc));
        }
        Err(err) => {
            tracing::error!(error=%err, "failed to initialize debug redis publisher");
            let _ = PUBLISHER.set(None);
        }
    }
}

pub async fn publish(event: &ExtDebugEvent) {
    if let Some(Some(publisher)) = PUBLISHER.get() {
        if let Err(err) = publisher.publish(event).await {
            tracing::warn!(error=%err, "failed to publish debug event to redis");
        }
    }
}
