use crate::engine::debug::ExtDebugEvent;
use once_cell::sync::OnceCell;
use redis::{aio::ConnectionManager, Client};
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Clone)]
struct RedisPublisher {
    conn: Arc<Mutex<ConnectionManager>>,
    stream_prefix: String,
    max_len: usize,
}

impl RedisPublisher {
    async fn new(url: &str, stream_prefix: String, max_len: usize) -> anyhow::Result<Self> {
        let client = Client::open(url)?;
        let conn = ConnectionManager::new(client).await?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            stream_prefix,
            max_len,
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
        format!("{}{}", self.stream_prefix, parts.join(":"))
    }

    async fn publish(&self, event: &ExtDebugEvent) -> redis::RedisResult<()> {
        let stream = self.stream_name(event);
        let mut conn = self.conn.lock().await;
        let mut cmd = redis::cmd("XADD");
        cmd.arg(&stream)
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
        cmd.arg("MAXLEN").arg("~").arg(self.max_len);
        cmd.query_async(&mut *conn).await
    }
}

static PUBLISHER: OnceCell<Option<Arc<RedisPublisher>>> = OnceCell::new();

pub async fn init_from_env() {
    let url = match std::env::var("RUNNER_DEBUG_REDIS_URL") {
        Ok(v) if !v.is_empty() => v,
        _ => {
            let _ = PUBLISHER.set(None);
            return;
        }
    };

    let stream_prefix = std::env::var("RUNNER_DEBUG_REDIS_STREAM_PREFIX")
        .unwrap_or_else(|_| "ext-debug:".to_string());
    let max_len = std::env::var("RUNNER_DEBUG_REDIS_MAXLEN")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(2000);

    match RedisPublisher::new(&url, stream_prefix.clone(), max_len).await {
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
