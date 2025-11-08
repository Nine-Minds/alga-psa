use crate::engine::loader::HostExecutionContext;
use once_cell::sync::OnceCell;
use serde::Serialize;
use std::collections::HashSet;
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use tokio::sync::{broadcast, RwLock};
use tracing::Level;

const DEFAULT_MAX_SUBSCRIBERS: usize = 64;
const DEFAULT_MAX_EVENT_BYTES: usize = 8 * 1024;
const DEFAULT_MAX_BUFFERED_EVENTS: usize = 1024;
const DEFAULT_SESSION_TTL_SECS: u64 = 900;

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
            .map(|d| {
                let millis = d.as_millis();
                format!("{millis}")
            })
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

#[derive(Clone)]
pub struct DebugFilter {
    pub extension_ids: HashSet<String>,
    pub tenant_ids: HashSet<String>,
    pub install_ids: HashSet<String>,
    pub request_ids: HashSet<String>,
}

impl DebugFilter {
    pub fn matches(&self, event: &ExtDebugEvent) -> bool {
        if !self.extension_ids.is_empty() {
            match &event.extension_id {
                Some(ext) if self.extension_ids.contains(&ext.to_ascii_lowercase()) => {}
                _ => return false,
            }
        }

        if !self.tenant_ids.is_empty() {
            match &event.tenant_id {
                Some(t) if self.tenant_ids.contains(&t.to_ascii_lowercase()) => {}
                _ => return false,
            }
        }

        if !self.install_ids.is_empty() {
            match &event.install_id {
                Some(id) if self.install_ids.contains(&id.to_ascii_lowercase()) => {}
                _ => return false,
            }
        }

        if !self.request_ids.is_empty() {
            match &event.request_id {
                Some(id) if self.request_ids.contains(&id.to_ascii_lowercase()) => {}
                _ => return false,
            }
        }

        true
    }
}

#[derive(Clone)]
pub struct DebugHub {
    enabled: bool,
    tx: broadcast::Sender<ExtDebugEvent>,
    max_subscribers: usize,
    max_buffered_events: usize,
    _session_ttl: Duration,
}

static mut HUB_INSTANCE: Option<Arc<DebugHub>> = None;

impl DebugHub {
    pub fn global() -> Option<Arc<DebugHub>> {
        unsafe { HUB_INSTANCE.clone() }
    }

    pub fn init_global() {
        let enabled = std::env::var("RUNNER_DEBUG_STREAM_ENABLED")
            .ok()
            .map(|v| v.eq_ignore_ascii_case("true") || v == "1")
            .unwrap_or(false);

        if !enabled {
            unsafe {
                HUB_INSTANCE = None;
            }
            return;
        }

        let max_subscribers = std::env::var("RUNNER_DEBUG_MAX_SUBSCRIBERS")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .filter(|v| *v > 0)
            .unwrap_or(DEFAULT_MAX_SUBSCRIBERS);

        let max_buffered_events = std::env::var("RUNNER_DEBUG_MAX_BUFFERED_EVENTS")
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .filter(|v| *v > 0)
            .unwrap_or(DEFAULT_MAX_BUFFERED_EVENTS);

        let ttl_secs = std::env::var("RUNNER_DEBUG_EVENT_TTL_SECS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .filter(|v| *v > 0)
            .unwrap_or(DEFAULT_SESSION_TTL_SECS);

        let (tx, _rx) = broadcast::channel(max_buffered_events);

        let hub = DebugHub {
            enabled,
            tx,
            max_subscribers,
            max_buffered_events,
            _session_ttl: Duration::from_secs(ttl_secs),
        };

        unsafe {
            HUB_INSTANCE = Some(Arc::new(hub));
        }

        tracing::info!(
            max_subscribers,
            max_buffered_events,
            ttl_secs,
            "ext debug hub enabled"
        );
    }

    pub fn broadcast_event(&self, event: ExtDebugEvent) {
        if !self.enabled {
            return;
        }
        let _ = self.tx.send(event);
    }

    pub fn subscribe(&self, filter: DebugFilter) -> Option<broadcast::Receiver<ExtDebugEvent>> {
        if !self.enabled {
            return None;
        }
        if self.tx.receiver_count() >= self.max_subscribers {
            tracing::warn!(
                current = self.tx.receiver_count(),
                max = self.max_subscribers,
                "ext debug hub subscriber limit reached"
            );
            return None;
        }
        let rx = self.tx.subscribe();
        let filtered_rx = Self::wrap_filtered(rx, filter);
        Some(filtered_rx)
    }

    fn wrap_filtered(
        mut rx: broadcast::Receiver<ExtDebugEvent>,
        filter: DebugFilter,
    ) -> broadcast::Receiver<ExtDebugEvent> {
        let (tx_out, rx_out) = broadcast::channel::<ExtDebugEvent>(rx.capacity());
        tokio::spawn(async move {
            while let Ok(event) = rx.recv().await {
                if filter.matches(&event) {
                    let _ = tx_out.send(event);
                }
            }
        });
        rx_out
    }
}

fn max_event_bytes() -> usize {
    std::env::var("RUNNER_DEBUG_MAX_EVENT_BYTES")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(DEFAULT_MAX_EVENT_BYTES)
}

pub async fn emit_stdout_line(ctx: &HostExecutionContext, line: &str) {
    if let Some(hub) = DebugHub::global() {
        let event = ExtDebugEvent::from_message("stdout", Level::INFO, ctx, line);
        hub.broadcast_event(event);
    }
}

pub async fn emit_stderr_line(ctx: &HostExecutionContext, line: &str) {
    if let Some(hub) = DebugHub::global() {
        let event = ExtDebugEvent::from_message("stderr", Level::ERROR, ctx, line);
        hub.broadcast_event(event);
    }
}

pub async fn emit_log(ctx: &HostExecutionContext, level: Level, message: &str) {
    if let Some(hub) = DebugHub::global() {
        let event = ExtDebugEvent::from_message("log", level, ctx, message);
        hub.broadcast_event(event);
    }
}

pub async fn ensure_initialized() {
    static ONCE: once_cell::sync::OnceCell<()> = once_cell::sync::OnceCell::new();
    ONCE.get_or_init(|| {
        DebugHub::init_global();
    });
}
