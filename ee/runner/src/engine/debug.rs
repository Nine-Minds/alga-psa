use crate::engine::debug_redis;
use crate::engine::loader::HostExecutionContext;
use serde::Serialize;
use std::time::SystemTime;
use tracing::Level;

#[derive(Clone, Debug, Serialize)]
pub struct ExtDebugEvent {
    pub ts: String,
    pub level: String,
    pub stream: String,
    pub tenant_id: Option<String>,
    pub extension_id: Option<String>,
    pub install_id: Option<String>,
    pub request_id: Option<String>,
    pub version_id: Option<String>,
    pub content_hash: Option<String>,
    pub message: String,
    pub truncated: bool,
}

impl ExtDebugEvent {
    pub fn from_message(
        stream: &str,
        level: Level,
        ctx: &HostExecutionContext,
        raw_message: &str,
    ) -> Self {
        let mut message = raw_message.to_string();
        let mut truncated = false;
        let max = max_event_bytes();
        if message.len() > max {
            message.truncate(max);
            truncated = true;
        }
        let ts = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_millis().to_string())
            .unwrap_or_else(|_| "0".to_string());

        ExtDebugEvent {
            ts,
            level: level_to_str(level).to_string(),
            stream: stream.to_string(),
            tenant_id: ctx.tenant_id.clone(),
            extension_id: ctx.extension_id.clone(),
            install_id: ctx.install_id.clone(),
            request_id: ctx.request_id.clone(),
            version_id: ctx.version_id.clone(),
            content_hash: None,
            message,
            truncated,
        }
    }
}

fn level_to_str(level: Level) -> &'static str {
    match level {
        Level::TRACE => "trace",
        Level::DEBUG => "debug",
        Level::INFO => "info",
        Level::WARN => "warn",
        Level::ERROR => "error",
    }
}

fn max_event_bytes() -> usize {
    std::env::var("RUNNER_DEBUG_MAX_EVENT_BYTES")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(8 * 1024)
}

pub async fn emit_stdout_line(ctx: &HostExecutionContext, line: &str) {
    let event = ExtDebugEvent::from_message("stdout", Level::INFO, ctx, line);
    debug_redis::publish(&event).await;
}

pub async fn emit_stderr_line(ctx: &HostExecutionContext, line: &str) {
    let event = ExtDebugEvent::from_message("stderr", Level::ERROR, ctx, line);
    debug_redis::publish(&event).await;
}

pub async fn emit_log(ctx: &HostExecutionContext, level: Level, message: &str) {
    let event = ExtDebugEvent::from_message("log", level, ctx, message);
    debug_redis::publish(&event).await;
}
