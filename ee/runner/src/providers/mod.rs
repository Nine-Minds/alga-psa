use once_cell::sync::Lazy;
use std::collections::HashSet;

pub const CAP_CONTEXT_READ: &str = "cap:context.read";
pub const CAP_SECRETS_GET: &str = "cap:secrets.get";
pub const CAP_HTTP_FETCH: &str = "cap:http.fetch";
pub const CAP_STORAGE_KV: &str = "cap:storage.kv";
pub const CAP_LOG_EMIT: &str = "cap:log.emit";
pub const CAP_UI_PROXY: &str = "cap:ui.proxy";
pub const CAP_USER_READ: &str = "cap:user.read";
pub const CAP_SCHEDULER_MANAGE: &str = "cap:scheduler.manage";

static KNOWN_CAPABILITIES: Lazy<HashSet<&'static str>> = Lazy::new(|| {
    HashSet::from([
        CAP_CONTEXT_READ,
        CAP_SECRETS_GET,
        CAP_HTTP_FETCH,
        CAP_STORAGE_KV,
        CAP_LOG_EMIT,
        CAP_UI_PROXY,
        CAP_USER_READ,
        CAP_SCHEDULER_MANAGE,
    ])
});

/// Normalize a capability identifier (trim + lowercase).
pub fn normalize(capability: &str) -> String {
    capability.trim().to_ascii_lowercase()
}

pub fn is_known(capability: &str) -> bool {
    KNOWN_CAPABILITIES.contains(capability)
}

pub fn validate<'a, I>(capabilities: I) -> Result<(), Vec<String>>
where
    I: IntoIterator<Item = &'a String>,
{
    let mut unknown = Vec::new();
    for cap in capabilities {
        if !is_known(cap) {
            unknown.push(cap.clone());
        }
    }
    if unknown.is_empty() {
        Ok(())
    } else {
        Err(unknown)
    }
}

pub fn default_capabilities() -> HashSet<&'static str> {
    HashSet::from([CAP_CONTEXT_READ, CAP_LOG_EMIT, CAP_USER_READ])
}
