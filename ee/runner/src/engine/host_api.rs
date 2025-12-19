use super::component;
use super::loader::{HostExecutionContext, HostState};
use crate::models::{
    ExecuteRequest as ModelExecuteRequest, ExecuteResponse as ModelExecuteResponse, HttpPayload,
};
use crate::providers::{
    CAP_CONTEXT_READ, CAP_HTTP_FETCH, CAP_LOG_EMIT, CAP_SECRETS_GET, CAP_STORAGE_KV, CAP_UI_PROXY,
    CAP_USER_READ,
};
use anyhow::{anyhow, Context};
use base64::Engine as _;
use once_cell::sync::Lazy;
use reqwest::{Client, Method, StatusCode};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};
use tracing::{self};
use url::{form_urlencoded, Url};
use wasmtime::component::{Accessor, HasSelf, Linker};

use component::alga::extension::types;
use component::alga::extension::{
    context,
    http::{self, HttpError, HttpRequest, HttpResponse},
    logging,
    secrets::{self, SecretError},
    storage::{self, StorageEntry, StorageError},
    types::{
        ContextData, ExecuteRequest as WitExecuteRequest, ExecuteResponse as WitExecuteResponse,
        HttpHeader, UserData, UserError,
    },
    ui_proxy::{self, ProxyError},
    user,
};

#[derive(Clone)]
pub struct HostRuntimeConfig {
    pub egress_allowlist: Vec<String>,
    pub ui_proxy_base: Option<Url>,
    pub ui_proxy_auth: Option<String>,
    pub ui_proxy_timeout: Duration,
}

impl Default for HostRuntimeConfig {
    fn default() -> Self {
        Self {
            egress_allowlist: Vec::new(),
            ui_proxy_base: None,
            ui_proxy_auth: None,
            ui_proxy_timeout: Duration::from_millis(5_000),
        }
    }
}

impl HostRuntimeConfig {
    pub fn from_env() -> Self {
        let mut cfg = Self::default();
        cfg.egress_allowlist = std::env::var("EXT_EGRESS_ALLOWLIST")
            .ok()
            .map(|s| {
                s.split(',')
                    .map(|item| item.trim().to_ascii_lowercase())
                    .filter(|item| !item.is_empty())
                    .collect()
            })
            .unwrap_or_default();

        if let Ok(base) = std::env::var("UI_PROXY_BASE_URL") {
            match Url::parse(&base) {
                Ok(url) => cfg.ui_proxy_base = Some(url),
                Err(err) => {
                    tracing::warn!(base = %base, error = %err, "UI_PROXY_BASE_URL is invalid; UI proxy calls disabled");
                }
            }
        }

        if let Ok(auth) = std::env::var("UI_PROXY_AUTH_KEY") {
            if !auth.trim().is_empty() {
                cfg.ui_proxy_auth = Some(auth);
            }
        }

        if let Ok(raw_timeout) = std::env::var("UI_PROXY_TIMEOUT_MS") {
            match raw_timeout.parse::<u64>() {
                Ok(ms) if ms > 0 => {
                    cfg.ui_proxy_timeout = Duration::from_millis(ms);
                }
                Ok(_) => {
                    tracing::warn!(value = %raw_timeout, "UI_PROXY_TIMEOUT_MS must be > 0; falling back to default");
                }
                Err(err) => {
                    tracing::warn!(value = %raw_timeout, error = %err, "failed to parse UI_PROXY_TIMEOUT_MS; using default");
                }
            }
        }

        cfg
    }
}

static HTTP_CLIENT: Lazy<Client> = Lazy::new(|| {
    Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .expect("http client")
});

static STORAGE_BASE_URL: Lazy<Option<String>> =
    Lazy::new(|| std::env::var("STORAGE_API_BASE_URL").ok());
static RUNNER_STORAGE_API_TOKEN: Lazy<Option<String>> =
    Lazy::new(|| std::env::var("RUNNER_STORAGE_API_TOKEN").ok());

pub(crate) fn add_component_host(linker: &mut Linker<HostState>) -> anyhow::Result<()> {
    component::Runner::add_to_linker::<HostState, HasSelf<HostState>>(linker, |state| state)
        .map_err(|e| anyhow!(e))
}

pub fn to_component_execute_request(
    req: &ModelExecuteRequest,
) -> anyhow::Result<WitExecuteRequest> {
    let context = &req.context;
    let http = &req.http;

    let headers = map_headers_to_vec(&http.headers);
    let body = decode_body_optional(http.body_b64.as_deref())?;
    let url = build_request_url(http);

    let http_request = HttpRequest {
        method: http.method.clone(),
        url,
        headers,
        body,
    };

    let context_data = ContextData {
        request_id: context.request_id.clone(),
        tenant_id: context.tenant_id.clone(),
        extension_id: context.extension_id.clone(),
        install_id: context.install_id.clone(),
        version_id: context.version_id.clone(),
    };

    Ok(WitExecuteRequest {
        context: context_data,
        http: http_request,
    })
}

pub fn to_model_execute_response(resp: WitExecuteResponse) -> ModelExecuteResponse {
    let mut headers_map = HashMap::new();
    for header in resp.headers {
        headers_map.insert(header.name, header.value);
    }
    let body_b64 = resp
        .body
        .map(|bytes| base64::engine::general_purpose::STANDARD.encode(bytes));

    ModelExecuteResponse {
        status: resp.status,
        headers: headers_map,
        body_b64,
        error: None,
    }
}

fn map_headers_to_vec(headers: &HashMap<String, String>) -> Vec<HttpHeader> {
    headers
        .iter()
        .map(|(name, value)| HttpHeader {
            name: name.clone(),
            value: value.clone(),
        })
        .collect()
}

fn decode_body_optional(body_b64: Option<&str>) -> anyhow::Result<Option<Vec<u8>>> {
    match body_b64 {
        Some(b64) => {
            if b64.is_empty() {
                Ok(Some(Vec::new()))
            } else {
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(b64.trim())
                    .map_err(|e| anyhow!("invalid body base64: {e}"))?;
                Ok(Some(bytes))
            }
        }
        None => Ok(None),
    }
}

fn build_request_url(http: &HttpPayload) -> String {
    let mut url = http.path.clone();
    if !http.query.is_empty() {
        let mut serializer = form_urlencoded::Serializer::new(String::new());
        for (key, value) in &http.query {
            serializer.append_pair(key, value);
        }
        let query = serializer.finish();
        if !query.is_empty() {
            if url.contains('?') {
                url.push('&');
            } else {
                url.push('?');
            }
            url.push_str(&query);
        }
    }
    url
}

fn has_capability(providers: &HashSet<String>, capability: &str) -> bool {
    providers.contains(&capability.to_ascii_lowercase())
}

fn is_host_allowed(allowlist: &[String], url: &Url) -> bool {
    if allowlist.is_empty() {
        return true;
    }
    let host = match url.host_str() {
        Some(h) => h.to_ascii_lowercase(),
        None => return false,
    };
    allowlist.iter().any(|allowed| {
        if host == *allowed {
            return true;
        }
        host.ends_with(&format!(".{}", allowed))
    })
}

fn clone_context_for_host(state: &HostState) -> HostExecutionContext {
    state.context.clone()
}

fn redact_identifier(value: &str) -> String {
    if value.is_empty() {
        return "<empty>".to_string();
    }
    if value.len() <= 4 {
        return "***".to_string();
    }
    let mut chars = value.chars();
    let prefix: String = chars.by_ref().take(2).collect();
    let suffix: String = value
        .chars()
        .rev()
        .take(2)
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    format!("{}…{}", prefix, suffix)
}

#[allow(clippy::too_many_arguments)]
fn make_storage_entry(
    namespace: String,
    key: String,
    value: Vec<u8>,
    revision: Option<u64>,
) -> StorageEntry {
    StorageEntry {
        namespace,
        key,
        value,
        revision,
    }
}

impl context::HostWithStore for HasSelf<HostState> {
    fn get_context<T>(
        accessor: &Accessor<T, Self>,
    ) -> impl std::future::Future<Output = ContextData> + Send {
        let (ctx, providers) = accessor.with(|mut access| {
            let state = access.get();
            (
                clone_context_for_host(state),
                state.context.providers.clone(),
            )
        });

        async move {
            if !has_capability(&providers, CAP_CONTEXT_READ) {
                tracing::error!(
                    tenant = ?ctx.tenant_id,
                    extension = ?ctx.extension_id,
                    request_id = ?ctx.request_id,
                    providers = ?providers,
                    "context capability missing; guest will panic"
                );
                panic!("capability_not_granted: {CAP_CONTEXT_READ}");
            }
            let data = ContextData {
                request_id: ctx.request_id,
                tenant_id: ctx.tenant_id.unwrap_or_default(),
                extension_id: ctx.extension_id.unwrap_or_default(),
                install_id: ctx.install_id,
                version_id: ctx.version_id,
            };
            tracing::debug!(
                tenant = ?data.tenant_id,
                extension = ?data.extension_id,
                request_id = ?data.request_id,
                "context capability granted; returning context"
            );
            data
        }
    }
}

impl secrets::HostWithStore for HasSelf<HostState> {
    fn get<T>(
        accessor: &Accessor<T, Self>,
        key: String,
    ) -> impl std::future::Future<Output = Result<String, SecretError>> + Send {
        let (providers, material, ctx) = accessor.with(|mut access| {
            let state = access.get();
            (
                state.context.providers.clone(),
                state.context.secrets.clone(),
                state.context.clone(),
            )
        });

        async move {
            if !has_capability(&providers, CAP_SECRETS_GET) {
                tracing::error!(
                    tenant = ?ctx.tenant_id,
                    extension = ?ctx.extension_id,
                    request_id = ?ctx.request_id,
                    "secrets capability denied - cap:secrets.get not granted"
                );
                return Err(SecretError::Denied);
            }
            let Some(secrets) = material else {
                return Err(SecretError::Missing);
            };
            let tenant = ctx.tenant_id.unwrap_or_default();
            let extension = ctx.extension_id.unwrap_or_default();
            let available_keys: Vec<String> = secrets.values.keys().cloned().collect();
            tracing::info!(
                tenant=%tenant,
                extension=%extension,
                key_redacted=%redact_identifier(&key),
                available_keys=?available_keys,
                "secrets capability get attempt"
            );
            match secrets.values.get(&key) {
                Some(value) => Ok(value.clone()),
                None => Err(SecretError::Missing),
            }
        }
    }

    fn list_keys<T>(
        accessor: &Accessor<T, Self>,
    ) -> impl std::future::Future<Output = Vec<String>> + Send {
        let (providers, material, ctx) = accessor.with(|mut access| {
            let state = access.get();
            (
                state.context.providers.clone(),
                state.context.secrets.clone(),
                state.context.clone(),
            )
        });

        async move {
            if !has_capability(&providers, CAP_SECRETS_GET) {
                return Vec::new();
            }
            let tenant = ctx.tenant_id.unwrap_or_default();
            let extension = ctx.extension_id.unwrap_or_default();
            let keys: Vec<String> = material
                .map(|s| s.values.keys().cloned().collect())
                .unwrap_or_default();
            tracing::info!(
                tenant=%tenant,
                extension=%extension,
                key_count=keys.len(),
                "secrets capability list_keys"
            );
            keys
        }
    }
}

impl http::HostWithStore for HasSelf<HostState> {
    fn fetch<T>(
        accessor: &Accessor<T, Self>,
        request: HttpRequest,
    ) -> impl std::future::Future<Output = Result<HttpResponse, HttpError>> + Send {
        let (providers, config, ctx) = accessor.with(|mut access| {
            let state = access.get();
            (
                state.context.providers.clone(),
                state.runtime.clone(),
                state.context.clone(),
            )
        });

        async move {
            if !has_capability(&providers, CAP_HTTP_FETCH) {
                tracing::error!(
                    tenant = ?ctx.tenant_id,
                    extension = ?ctx.extension_id,
                    request_id = ?ctx.request_id,
                    "http capability denied - cap:http.fetch not granted"
                );
                return Err(HttpError::NotAllowed);
            }

            let tenant = ctx.tenant_id.unwrap_or_default();
            let extension = ctx.extension_id.unwrap_or_default();
            let route = request.url.clone();
            let method = request.method.clone();

            let url = Url::parse(&route).map_err(|_| HttpError::InvalidUrl)?;
            if !is_host_allowed(&config.egress_allowlist, &url) {
                tracing::error!(
                    tenant=%tenant,
                    extension=%extension,
                    method=%method,
                    url=%route,
                    egress_allowlist=?config.egress_allowlist,
                    "http capability denied by allowlist"
                );
                return Err(HttpError::NotAllowed);
            }

            let method: Method = method.parse().map_err(|_| HttpError::InvalidUrl)?;
            let started = Instant::now();
            tracing::info!(
                tenant=%tenant,
                extension=%extension,
                method=%method,
                url=%route,
                "http capability fetch start"
            );

            let mut builder = HTTP_CLIENT.request(method, url);
            for header in request.headers {
                builder = builder.header(&header.name, &header.value);
            }
            if let Some(body) = request.body {
                builder = builder.body(body);
            }

            let response = builder.send().await.map_err(|err| {
                tracing::error!(error = %err, "http_fetch transport error");
                HttpError::Transport
            })?;

            let status = response.status().as_u16();
            let elapsed_ms = started.elapsed().as_millis();
            tracing::info!(
                tenant=%tenant,
                extension=%extension,
                status,
                elapsed_ms,
                url=%route,
                "http capability fetch completed"
            );
            let mut headers = Vec::new();
            for (name, value) in response.headers().iter() {
                headers.push(HttpHeader {
                    name: name.to_string(),
                    value: value.to_str().unwrap_or_default().to_string(),
                });
            }
            let body_bytes = response.bytes().await.map_err(|err| {
                tracing::error!(error = %err, "http_fetch body read failed");
                HttpError::Internal
            })?;

            Ok(HttpResponse {
                status,
                headers,
                body: Some(body_bytes.to_vec()),
            })
        }
    }
}

impl logging::HostWithStore for HasSelf<HostState> {
    fn log_info<T>(
        accessor: &Accessor<T, Self>,
        message: String,
    ) -> impl std::future::Future<Output = ()> + Send {
        let (providers, ctx) = accessor.with(|mut access| {
            let state = access.get();
            (state.context.providers.clone(), state.context.clone())
        });
        async move {
            if has_capability(&providers, CAP_LOG_EMIT) {
                tracing::info!(
                    target: "ext",
                    tenant = ?ctx.tenant_id,
                    extension = ?ctx.extension_id,
                    request_id = ?ctx.request_id,
                    "{message}"
                );
                crate::engine::debug::emit_log(&ctx, tracing::Level::INFO, &message).await;
            }
        }
    }

    fn log_warn<T>(
        accessor: &Accessor<T, Self>,
        message: String,
    ) -> impl std::future::Future<Output = ()> + Send {
        let (providers, ctx) = accessor.with(|mut access| {
            let state = access.get();
            (state.context.providers.clone(), state.context.clone())
        });
        async move {
            if has_capability(&providers, CAP_LOG_EMIT) {
                tracing::warn!(
                    target: "ext",
                    tenant = ?ctx.tenant_id,
                    extension = ?ctx.extension_id,
                    request_id = ?ctx.request_id,
                    "{message}"
                );
                crate::engine::debug::emit_log(&ctx, tracing::Level::WARN, &message).await;
            }
        }
    }

    fn log_error<T>(
        accessor: &Accessor<T, Self>,
        message: String,
    ) -> impl std::future::Future<Output = ()> + Send {
        let (providers, ctx) = accessor.with(|mut access| {
            let state = access.get();
            (state.context.providers.clone(), state.context.clone())
        });
        async move {
            if has_capability(&providers, CAP_LOG_EMIT) {
                tracing::error!(
                    target: "ext",
                    tenant = ?ctx.tenant_id,
                    extension = ?ctx.extension_id,
                    request_id = ?ctx.request_id,
                    "{message}"
                );
                crate::engine::debug::emit_log(&ctx, tracing::Level::ERROR, &message).await;
            }
        }
    }
}

impl storage::HostWithStore for HasSelf<HostState> {
        async move {
            if !has_capability(&providers, CAP_STORAGE_KV) {
                tracing::error!(
                    tenant = ?ctx.tenant_id,
                    extension = ?ctx.extension_id,
                    request_id = ?ctx.request_id,
                    "storage capability denied - cap:storage.kv not granted"
                );
                return Err(StorageError::Denied);
            }
            let install_id = install_id.ok_or_else(|| {
                tracing::error!(
                    tenant = ?ctx.tenant_id,
                    extension = ?ctx.extension_id,
                    request_id = ?ctx.request_id,
                    "storage capability denied - install_id missing"
                );
                StorageError::Denied
            })?;
            let tenant = ctx.tenant_id.unwrap_or_default();
            let extension = ctx.extension_id.unwrap_or_default();
            let namespace_log = namespace.clone();
            let key_log = key.clone();
            tracing::info!(
                tenant=%tenant,
                extension=%extension,
                namespace=%namespace_log,
                key_redacted=%redact_identifier(&key_log),
                "storage capability get start"
            );
            let mut payload = Map::new();
            payload.insert("namespace".into(), Value::String(namespace.clone()));
            payload.insert("key".into(), Value::String(key.clone()));

            let value = storage_request(&install_id, "get", payload).await?;
            parse_storage_entry(value, Some(namespace), Some(key))
        }
    }

    fn put<T>(
        accessor: &Accessor<T, Self>,
        entry: StorageEntry,
    ) -> impl std::future::Future<Output = Result<StorageEntry, StorageError>> + Send {
        let (providers, install_id, ctx) = accessor.with(|mut access| {
            let state = access.get();
            (
                state.context.providers.clone(),
                state.context.install_id.clone(),
                state.context.clone(),
            )
        });

        async move {
            if !has_capability(&providers, CAP_STORAGE_KV) {
                return Err(StorageError::Denied);
            }
            let install_id = install_id.ok_or(StorageError::Denied)?;
            let tenant = ctx.tenant_id.unwrap_or_default();
            let extension = ctx.extension_id.unwrap_or_default();
            let namespace_log = entry.namespace.clone();
            let key_log = entry.key.clone();
            tracing::info!(
                tenant=%tenant,
                extension=%extension,
                namespace=%namespace_log,
                key_redacted=%redact_identifier(&key_log),
                "storage capability put start"
            );

            let mut payload = Map::new();
            payload.insert("namespace".into(), Value::String(entry.namespace.clone()));
            payload.insert("key".into(), Value::String(entry.key.clone()));
            payload.insert(
                "value".into(),
                Value::String(
                    base64::engine::general_purpose::STANDARD.encode(entry.value.clone()),
                ),
            );
            let mut metadata = Map::new();
            metadata.insert("encoding".into(), Value::String("base64-bytes".to_string()));
            payload.insert("metadata".into(), Value::Object(metadata));
            if let Some(rev) = entry.revision {
                payload.insert("ifRevision".into(), Value::Number(rev.into()));
            }

            let response = storage_request(&install_id, "put", payload).await?;
            let revision = response.get("revision").and_then(|v| v.as_u64());
            Ok(make_storage_entry(
                entry.namespace,
                entry.key,
                entry.value,
                revision,
            ))
        }
    }

    fn delete<T>(
        accessor: &Accessor<T, Self>,
        namespace: String,
        key: String,
    ) -> impl std::future::Future<Output = Result<(), StorageError>> + Send {
        let (providers, install_id, ctx) = accessor.with(|mut access| {
            let state = access.get();
            (
                state.context.providers.clone(),
                state.context.install_id.clone(),
                state.context.clone(),
            )
        });

        async move {
            if !has_capability(&providers, CAP_STORAGE_KV) {
                return Err(StorageError::Denied);
            }
            let install_id = install_id.ok_or(StorageError::Denied)?;
            let tenant = ctx.tenant_id.unwrap_or_default();
            let extension = ctx.extension_id.unwrap_or_default();
            let namespace_log = namespace.clone();
            let key_log = key.clone();
            tracing::info!(
                tenant=%tenant,
                extension=%extension,
                namespace=%namespace_log,
                key_redacted=%redact_identifier(&key_log),
                "storage capability delete start"
            );
            let mut payload = Map::new();
            payload.insert("namespace".into(), Value::String(namespace));
            payload.insert("key".into(), Value::String(key));

            let response = storage_request(&install_id, "delete", payload).await?;
            match response.get("success").and_then(|v| v.as_bool()) {
                Some(true) | None => Ok(()),
                Some(false) => Err(StorageError::Conflict),
            }
        }
    }

    fn list_entries<T>(
        accessor: &Accessor<T, Self>,
        namespace: String,
        cursor: Option<String>,
    ) -> impl std::future::Future<Output = Result<Vec<StorageEntry>, StorageError>> + Send {
        let (providers, install_id, ctx) = accessor.with(|mut access| {
            let state = access.get();
            (
                state.context.providers.clone(),
                state.context.install_id.clone(),
                state.context.clone(),
            )
        });

        async move {
            if !has_capability(&providers, CAP_STORAGE_KV) {
                return Err(StorageError::Denied);
            }
            let install_id = install_id.ok_or(StorageError::Denied)?;
            let tenant = ctx.tenant_id.unwrap_or_default();
            let extension = ctx.extension_id.unwrap_or_default();
            let namespace_log = namespace.clone();
            let cursor_log = cursor.clone();
            tracing::info!(
                tenant=%tenant,
                extension=%extension,
                namespace=%namespace_log,
                cursor=?cursor_log,
                "storage capability list start"
            );
            let mut payload = Map::new();
            payload.insert("namespace".into(), Value::String(namespace.clone()));
            payload.insert("includeValues".into(), Value::Bool(true));
            payload.insert("includeMetadata".into(), Value::Bool(true));
            if let Some(c) = cursor {
                payload.insert("cursor".into(), Value::String(c));
            }

            let response = storage_request(&install_id, "list", payload).await?;
            let items = response
                .get("items")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();

            let mut entries = Vec::with_capacity(items.len());
            for item in items {
                let entry = parse_storage_entry(item, None, None)?;
                entries.push(entry);
            }

            if let Some(cursor) = response.get("nextCursor").and_then(|v| v.as_str()) {
                if !cursor.is_empty() {
                    tracing::debug!(
                        namespace,
                        next_cursor = cursor,
                        "storage list has more results, cursor ignored by host contract"
                    );
                }
            }

            Ok(entries)
        }
    }
}

impl ui_proxy::HostWithStore for HasSelf<HostState> {
    fn call_route<T>(
        accessor: &Accessor<T, Self>,
        route: String,
        payload: Option<Vec<u8>>,
    ) -> impl std::future::Future<Output = Result<Vec<u8>, ProxyError>> + Send {
        let (providers, ctx, runtime) = accessor.with(|mut access| {
            let state = access.get();
            (
                state.context.providers.clone(),
                state.context.clone(),
                state.runtime.clone(),
            )
        });
        async move {
            if !has_capability(&providers, CAP_UI_PROXY) {
                tracing::error!(
                    tenant = ?ctx.tenant_id,
                    extension = ?ctx.extension_id,
                    request_id = ?ctx.request_id,
                    "ui_proxy capability denied - cap:ui.proxy not granted"
                );
                return Err(ProxyError::Denied);
            }
            let Some(base_url) = runtime.ui_proxy_base.clone() else {
                tracing::warn!(
                    tenant=?ctx.tenant_id,
                    extension=?ctx.extension_id,
                    "ui_proxy capability invoked but UI_PROXY_BASE_URL is not configured"
                );
                return Err(ProxyError::RouteNotFound);
            };

            let tenant = ctx.tenant_id.clone().ok_or_else(|| {
                tracing::error!("ui_proxy call missing tenant id in host context");
                ProxyError::Internal
            })?;

            let extension = ctx.extension_id.clone().ok_or_else(|| {
                tracing::error!("ui_proxy call missing extension id in host context");
                ProxyError::Internal
            })?;

            let request_id = ctx
                .request_id
                .clone()
                .unwrap_or_else(|| "ui-proxy-call".to_string());

            let trimmed_route = route.trim();
            if trimmed_route.is_empty() {
                tracing::warn!(
                    tenant=%tenant,
                    extension=%extension,
                    "ui_proxy route was empty"
                );
                return Err(ProxyError::BadRequest);
            }

            let (path_part, query_part) = match trimmed_route.split_once('?') {
                Some((path, query)) => (path, Some(query)),
                None => (trimmed_route, None),
            };

            let mut url = base_url.clone();
            {
                let mut segments = url.path_segments_mut().map_err(|_| ProxyError::Internal)?;
                segments.pop_if_empty();
                segments.push(&extension);
                for segment in path_part.trim_start_matches('/').split('/') {
                    if segment.is_empty() {
                        continue;
                    }
                    if matches!(segment, "." | "..") {
                        tracing::warn!(
                            tenant=%tenant,
                            extension=%extension,
                            segment=%segment,
                            "ui_proxy route contains invalid segment"
                        );
                        return Err(ProxyError::BadRequest);
                    }
                    segments.push(segment);
                }
            }
            if let Some(query) = query_part {
                if query.is_empty() {
                    url.set_query(None);
                } else {
                    url.set_query(Some(query));
                }
            } else {
                url.set_query(None);
            }

            let client: &Client = &HTTP_CLIENT;
            let mut request = client.post(url.clone()).timeout(runtime.ui_proxy_timeout);
            request = request
                .header("x-request-id", &request_id)
                .header("x-alga-tenant", &tenant)
                .header("x-alga-extension", &extension);
            if let Some(install) = ctx.install_id.clone() {
                request = request.header("x-ext-install-id", install);
            }
            if let Some(version) = ctx.version_id.clone() {
                request = request.header("x-ext-version-id", version);
            }
            if let Some(auth) = runtime.ui_proxy_auth.clone() {
                request = request.header("x-runner-auth", auth);
            }

            let has_body = payload.is_some();
            if let Some(body) = payload {
                request = request
                    .header("content-type", "application/json")
                    .body(body);
            } else {
                request = request.header("content-type", "application/json");
            }

            let started = Instant::now();
            tracing::info!(
                tenant=%tenant,
                extension=%extension,
                route=%path_part,
                url=%url,
                has_body,
                "ui proxy dispatch start"
            );

            let response = match request.send().await {
                Ok(resp) => resp,
                Err(err) => {
                    tracing::error!(
                        tenant=%tenant,
                        extension=%extension,
                        route=%path_part,
                        error=%err,
                        "ui proxy request failed during transport"
                    );
                    return Err(ProxyError::Internal);
                }
            };

            let status = response.status();
            let duration_ms = started.elapsed().as_millis();

            if !status.is_success() {
                tracing::warn!(
                    tenant=%tenant,
                    extension=%extension,
                    route=%path_part,
                    status=status.as_u16(),
                    duration_ms,
                    "ui proxy backend returned non-success status"
                );
                return Err(map_proxy_status(status));
            }

            let bytes = response.bytes().await.map_err(|err| {
                tracing::error!(
                    tenant=%tenant,
                    extension=%extension,
                    route=%path_part,
                    error=%err,
                    "failed to read ui proxy response body"
                );
                ProxyError::Internal
            })?;

            tracing::info!(
                tenant=%tenant,
                extension=%extension,
                route=%path_part,
                duration_ms,
                response_bytes = bytes.len(),
                "ui proxy dispatch completed"
            );

            Ok(bytes.to_vec())
        }
    }
}

fn parse_storage_entry(
    value: Value,
    default_namespace: Option<String>,
    default_key: Option<String>,
) -> std::result::Result<StorageEntry, StorageError> {
    let obj = value.as_object().cloned().ok_or(StorageError::Internal)?;

    let namespace = obj
        .get("namespace")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or(default_namespace)
        .ok_or(StorageError::Internal)?;

    let key = obj
        .get("key")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or(default_key)
        .ok_or(StorageError::Internal)?;

    let revision = obj.get("revision").and_then(|v| v.as_u64());

    let metadata = obj.get("metadata").and_then(|v| v.as_object()).cloned();

    let value_field = obj.get("value").cloned().unwrap_or(Value::Null);
    let bytes = decode_storage_value(&value_field, metadata.as_ref())
        .map_err(|_| StorageError::Internal)?;

    Ok(make_storage_entry(namespace, key, bytes, revision))
}

fn decode_storage_value(
    value: &Value,
    metadata: Option<&Map<String, Value>>,
) -> anyhow::Result<Vec<u8>> {
    let encoding = metadata
        .and_then(|m| m.get("encoding"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if encoding == "base64-bytes" {
        let s = value
            .as_str()
            .context("expected base64 string in storage value")?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(s)
            .context("invalid base64 storage value")?;
        return Ok(bytes);
    }

    if let Some(obj) = value.as_object() {
        if let Some(s) = obj.get("_bytes_b64").and_then(|v| v.as_str()) {
            return Ok(base64::engine::general_purpose::STANDARD
                .decode(s)
                .context("invalid base64 storage value")?);
        }
    }

    if let Some(s) = value.as_str() {
        if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(s) {
            return Ok(bytes);
        }
        return Ok(s.as_bytes().to_vec());
    }

    serde_json::to_vec(value).context("serialize storage value to bytes")
}

async fn storage_request(
    install_id: &str,
    operation: &str,
    mut payload: Map<String, Value>,
) -> std::result::Result<Value, StorageError> {
    let base = STORAGE_BASE_URL.as_ref().ok_or(StorageError::Internal)?;
    let token = RUNNER_STORAGE_API_TOKEN
        .as_ref()
        .ok_or(StorageError::Internal)?;

    payload.insert("operation".into(), Value::String(operation.to_string()));

    let url = format!(
        "{}/api/internal/ext-storage/install/{}",
        base.trim_end_matches('/'),
        install_id
    );
    let namespace_log = payload
        .get("namespace")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let key_log = payload
        .get("key")
        .and_then(|v| v.as_str())
        .map(|v| redact_identifier(v))
        .unwrap_or_else(|| "<none>".to_string());
    tracing::debug!(
        install_id=%install_id,
        operation=%operation,
        namespace=%namespace_log,
        key_redacted=%key_log,
        "storage request dispatch"
    );

    let response = HTTP_CLIENT
        .post(url)
        .header("content-type", "application/json")
        .header("x-runner-auth", token)
        .json(&payload)
        .send()
        .await
        .map_err(|err| {
            tracing::error!(error = %err, "storage_request transport failure");
            StorageError::Internal
        })?;

    let status = response.status();
    let text = response.text().await.unwrap_or_default();

    if !status.is_success() {
        tracing::warn!(status = status.as_u16(), body = %text, operation, "storage_request error");
        return Err(map_storage_status(status));
    }

    if text.trim().is_empty() {
        Ok(Value::Null)
    } else {
        serde_json::from_str(&text).map_err(|err| {
            tracing::error!(error = %err, "storage_request invalid JSON response");
            StorageError::Internal
        })
    }
}

fn map_storage_status(status: StatusCode) -> StorageError {
    match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => StorageError::Denied,
        StatusCode::NOT_FOUND => StorageError::Missing,
        StatusCode::CONFLICT => StorageError::Conflict,
        StatusCode::TOO_MANY_REQUESTS => StorageError::Denied,
        _ => StorageError::Internal,
    }
}

fn map_proxy_status(status: StatusCode) -> ProxyError {
    match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => ProxyError::Denied,
        StatusCode::NOT_FOUND => ProxyError::RouteNotFound,
        StatusCode::BAD_REQUEST => ProxyError::BadRequest,
        StatusCode::TOO_MANY_REQUESTS => ProxyError::Denied,
        code if code.is_client_error() => ProxyError::BadRequest,
        _ => ProxyError::Internal,
    }
}

impl user::HostWithStore for HasSelf<HostState> {
    fn get_user<T>(
        accessor: &Accessor<T, Self>,
    ) -> impl std::future::Future<Output = Result<UserData, UserError>> + Send {
        let (providers, ctx) = accessor.with(|mut access| {
            let state = access.get();
            (state.context.providers.clone(), state.context.clone())
        });

        async move {
            if !has_capability(&providers, CAP_USER_READ) {
                tracing::error!(
                    tenant = ?ctx.tenant_id,
                    extension = ?ctx.extension_id,
                    request_id = ?ctx.request_id,
                    "user capability denied - cap:user.read not granted"
                );
                return Err(UserError::NotAllowed);
            }

            let tenant = ctx.tenant_id.clone().unwrap_or_default();
            let extension = ctx.extension_id.clone().unwrap_or_default();

            match &ctx.user {
                Some(user_info) => {
                    tracing::info!(
                        tenant=%tenant,
                        extension=%extension,
                        user_id=%user_info.user_id,
                        "user capability granted - returning user data"
                    );
                    Ok(UserData {
                        tenant_id: tenant,
                        company_name: user_info.company_name.clone(),
                        user_id: user_info.user_id.clone(),
                        user_email: user_info.user_email.clone(),
                        user_name: user_info.user_name.clone(),
                    })
                }
                None => {
                    tracing::info!(
                        tenant=%tenant,
                        extension=%extension,
                        "user capability granted but no user context available"
                    );
                    Err(UserError::NotAvailable)
                }
            }
        }
    }
}

impl types::Host for HostState {}
impl context::Host for HostState {}
impl secrets::Host for HostState {}
impl http::Host for HostState {}
impl storage::Host for HostState {}
impl logging::Host for HostState {}
impl ui_proxy::Host for HostState {}
impl user::Host for HostState {}

#[cfg(test)]
mod tests {
    use super::*;
    use url::Url;

    #[test]
    fn allowlist_checks_exact_and_subdomain() {
        let allow = vec!["example.com".to_string()];
        let exact = Url::parse("https://example.com/path").unwrap();
        let sub = Url::parse("https://api.example.com/path").unwrap();
        let other = Url::parse("https://example.org/path").unwrap();

        assert!(is_host_allowed(&allow, &exact));
        assert!(is_host_allowed(&allow, &sub));
        assert!(!is_host_allowed(&allow, &other));
    }

    #[test]
    fn redact_identifier_masks_sensitive_values() {
        assert_eq!(redact_identifier(""), "<empty>");
        assert_eq!(redact_identifier("id"), "***");
        assert_eq!(redact_identifier("secret"), "se…et");
    }
}
