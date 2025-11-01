use super::component;
use super::loader::{HostExecutionContext, HostState};
use crate::models::{
    ExecuteRequest as ModelExecuteRequest, ExecuteResponse as ModelExecuteResponse, HttpPayload,
};
use crate::providers::{
    CAP_CONTEXT_READ, CAP_HTTP_FETCH, CAP_LOG_EMIT, CAP_SECRETS_GET, CAP_STORAGE_KV, CAP_UI_PROXY,
};
use anyhow::{anyhow, Context};
use base64::Engine as _;
use once_cell::sync::Lazy;
use reqwest::{Client, Method, StatusCode};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use std::time::Duration;
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
        HttpHeader,
    },
    ui_proxy::{self, ProxyError},
};

#[derive(Clone, Default)]
pub struct HostRuntimeConfig {
    pub egress_allowlist: Vec<String>,
}

impl HostRuntimeConfig {
    pub fn from_env() -> Self {
        let allowlist = std::env::var("EXT_EGRESS_ALLOWLIST")
            .ok()
            .map(|s| {
                s.split(',')
                    .map(|item| item.trim().to_ascii_lowercase())
                    .filter(|item| !item.is_empty())
                    .collect()
            })
            .unwrap_or_default();
        Self {
            egress_allowlist: allowlist,
        }
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
                panic!("capability_not_granted: {CAP_CONTEXT_READ}");
            }
            ContextData {
                request_id: ctx.request_id,
                tenant_id: ctx.tenant_id.unwrap_or_default(),
                extension_id: ctx.extension_id.unwrap_or_default(),
                install_id: ctx.install_id,
                version_id: ctx.version_id,
            }
        }
    }
}

impl secrets::HostWithStore for HasSelf<HostState> {
    fn get<T>(
        accessor: &Accessor<T, Self>,
        key: String,
    ) -> impl std::future::Future<Output = Result<String, SecretError>> + Send {
        let (providers, material) = accessor.with(|mut access| {
            let state = access.get();
            (
                state.context.providers.clone(),
                state.context.secrets.clone(),
            )
        });

        async move {
            if !has_capability(&providers, CAP_SECRETS_GET) {
                return Err(SecretError::Denied);
            }
            let Some(secrets) = material else {
                return Err(SecretError::Missing);
            };
            match secrets.values.get(&key) {
                Some(value) => Ok(value.clone()),
                None => Err(SecretError::Missing),
            }
        }
    }

    fn list_keys<T>(
        accessor: &Accessor<T, Self>,
    ) -> impl std::future::Future<Output = Vec<String>> + Send {
        let (providers, material) = accessor.with(|mut access| {
            let state = access.get();
            (
                state.context.providers.clone(),
                state.context.secrets.clone(),
            )
        });

        async move {
            if !has_capability(&providers, CAP_SECRETS_GET) {
                return Vec::new();
            }
            material
                .map(|s| s.values.keys().cloned().collect())
                .unwrap_or_default()
        }
    }
}

impl http::HostWithStore for HasSelf<HostState> {
    fn fetch<T>(
        accessor: &Accessor<T, Self>,
        request: HttpRequest,
    ) -> impl std::future::Future<Output = Result<HttpResponse, HttpError>> + Send {
        let (providers, config) = accessor.with(|mut access| {
            let state = access.get();
            (state.context.providers.clone(), state.runtime.clone())
        });

        async move {
            if !has_capability(&providers, CAP_HTTP_FETCH) {
                return Err(HttpError::NotAllowed);
            }

            let url = Url::parse(&request.url).map_err(|_| HttpError::InvalidUrl)?;
            if !is_host_allowed(&config.egress_allowlist, &url) {
                return Err(HttpError::NotAllowed);
            }

            let method: Method = request.method.parse().map_err(|_| HttpError::InvalidUrl)?;
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
        let providers = accessor.with(|mut access| access.get().context.providers.clone());
        async move {
            if has_capability(&providers, CAP_LOG_EMIT) {
                tracing::info!(target: "ext", "{message}");
            }
        }
    }

    fn log_warn<T>(
        accessor: &Accessor<T, Self>,
        message: String,
    ) -> impl std::future::Future<Output = ()> + Send {
        let providers = accessor.with(|mut access| access.get().context.providers.clone());
        async move {
            if has_capability(&providers, CAP_LOG_EMIT) {
                tracing::warn!(target: "ext", "{message}");
            }
        }
    }

    fn log_error<T>(
        accessor: &Accessor<T, Self>,
        message: String,
    ) -> impl std::future::Future<Output = ()> + Send {
        let providers = accessor.with(|mut access| access.get().context.providers.clone());
        async move {
            if has_capability(&providers, CAP_LOG_EMIT) {
                tracing::error!(target: "ext", "{message}");
            }
        }
    }
}

impl storage::HostWithStore for HasSelf<HostState> {
    fn get<T>(
        accessor: &Accessor<T, Self>,
        namespace: String,
        key: String,
    ) -> impl std::future::Future<Output = Result<StorageEntry, StorageError>> + Send {
        let (providers, install_id) = accessor.with(|mut access| {
            let state = access.get();
            (
                state.context.providers.clone(),
                state.context.install_id.clone(),
            )
        });

        async move {
            if !has_capability(&providers, CAP_STORAGE_KV) {
                return Err(StorageError::Denied);
            }
            let install_id = install_id.ok_or(StorageError::Denied)?;
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
        let (providers, install_id) = accessor.with(|mut access| {
            let state = access.get();
            (
                state.context.providers.clone(),
                state.context.install_id.clone(),
            )
        });

        async move {
            if !has_capability(&providers, CAP_STORAGE_KV) {
                return Err(StorageError::Denied);
            }
            let install_id = install_id.ok_or(StorageError::Denied)?;

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
        let (providers, install_id) = accessor.with(|mut access| {
            let state = access.get();
            (
                state.context.providers.clone(),
                state.context.install_id.clone(),
            )
        });

        async move {
            if !has_capability(&providers, CAP_STORAGE_KV) {
                return Err(StorageError::Denied);
            }
            let install_id = install_id.ok_or(StorageError::Denied)?;
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
        let (providers, install_id) = accessor.with(|mut access| {
            let state = access.get();
            (
                state.context.providers.clone(),
                state.context.install_id.clone(),
            )
        });

        async move {
            if !has_capability(&providers, CAP_STORAGE_KV) {
                return Err(StorageError::Denied);
            }
            let install_id = install_id.ok_or(StorageError::Denied)?;
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
        _route: String,
        _payload: Option<Vec<u8>>,
    ) -> impl std::future::Future<Output = Result<Vec<u8>, ProxyError>> + Send {
        let providers = accessor.with(|mut access| access.get().context.providers.clone());
        async move {
            if !has_capability(&providers, CAP_UI_PROXY) {
                return Err(ProxyError::Denied);
            }
            Err(ProxyError::RouteNotFound)
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

impl types::Host for HostState {}
impl context::Host for HostState {}
impl secrets::Host for HostState {}
impl http::Host for HostState {}
impl storage::Host for HostState {}
impl logging::Host for HostState {}
impl ui_proxy::Host for HostState {}
