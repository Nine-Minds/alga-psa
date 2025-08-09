// Host API imports exposed to WASM (alga.*)
use wasmtime::{Linker, Caller};
use super::loader::Limits;
use once_cell::sync::Lazy;
use reqwest::Client;
use url::Url;
use base64::Engine;

static HTTP_CLIENT: Lazy<Client> = Lazy::new(|| Client::builder().build().expect("client"));

#[derive(Clone, Default)]
pub struct HostApiConfig {
    pub egress_allowlist: Vec<String>,
}

pub fn add_host_imports(linker: &mut Linker<Limits>, cfg: &HostApiConfig) -> anyhow::Result<()> {
    // alga.log.info(ptr, len) -> void (reads guest memory and logs)
    linker.func_wrap("alga", "log_info", |mut caller: Caller<'_, Limits>, ptr: i32, len: i32| {
        if let Some(mem) = caller.get_export("memory").and_then(|e| e.into_memory()) {
            let data = mem.data(&caller);
            let start = ptr as usize;
            let end = start.saturating_add(len as usize);
            if end <= data.len() {
                if let Ok(msg) = std::str::from_utf8(&data[start..end]) {
                    tracing::info!(target: "ext", "guest: {}", msg);
                }
            }
        }
    })?;

    // alga.log.error(ptr, len)
    linker.func_wrap("alga", "log_error", |mut caller: Caller<'_, Limits>, ptr: i32, len: i32| {
        if let Some(mem) = caller.get_export("memory").and_then(|e| e.into_memory()) {
            let data = mem.data(&caller);
            let start = ptr as usize;
            let end = start.saturating_add(len as usize);
            if end <= data.len() {
                if let Ok(msg) = std::str::from_utf8(&data[start..end]) {
                    tracing::error!(target: "ext", "guest: {}", msg);
                }
            }
        }
    })?;

    // alga.http.fetch(req_ptr, req_len, out_ptr) -> i32 (0 ok, <0 error)
    // Request/Response are JSON. out_ptr points to 8-byte area where host writes (resp_ptr:i32, resp_len:i32)
    let allowlist = cfg.egress_allowlist.clone();
    linker.func_wrap3_async("alga", "http_fetch", move |mut caller: Caller<'_, Limits>, req_ptr: i32, req_len: i32, out_ptr: i32| {
        let allowlist = allowlist.clone();
        Box::new(async move {
            // Read request JSON from guest memory
            let mem = caller
                .get_export("memory")
                .and_then(|e| e.into_memory())
                .ok_or_else(|| anyhow::anyhow!("no memory export"))?;
            let data = mem.data(&caller);
            let start = req_ptr as usize;
            let end = start.saturating_add(req_len as usize);
            if end > data.len() { anyhow::bail!("req oob"); }
            let req_bytes = &data[start..end];
            let req_json: serde_json::Value = serde_json::from_slice(req_bytes).unwrap_or(serde_json::json!({}));
            let url_s = req_json.get("url").and_then(|v| v.as_str()).unwrap_or("");
            let method = req_json.get("method").and_then(|v| v.as_str()).unwrap_or("GET");
            let headers = req_json.get("headers").and_then(|v| v.as_object()).cloned().unwrap_or_default();
            let body_b64 = req_json.get("body_b64").and_then(|v| v.as_str());

            // Allowlist enforcement
            let url = Url::parse(url_s).map_err(|e| anyhow::anyhow!("bad url: {}", e))?;
            let host = url.host_str().unwrap_or("").to_ascii_lowercase();
            let allowed = allowlist.iter().any(|entry| {
                let e = entry.trim().to_ascii_lowercase();
                host == e || host.ends_with(&format!(".{e}"))
            });
            if allowlist.is_empty() || !allowed {
                anyhow::bail!("egress not allowed");
            }

            // Build request
            let mut rb = HTTP_CLIENT.request(method.parse().unwrap_or(reqwest::Method::GET), url);
            for (k, v) in headers.iter() {
                if let Some(vs) = v.as_str() {
                    rb = rb.header(k, vs);
                }
            }
            if let Some(b64) = body_b64 {
                if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(b64) {
                    rb = rb.body(bytes);
                }
            }

            let resp = rb.send().await.map_err(|e| anyhow::anyhow!("fetch failed: {}", e))?;
            let status = resp.status().as_u16();
            let mut resp_headers: serde_json::Map<String, serde_json::Value> = serde_json::Map::new();
            for (k, v) in resp.headers().iter() {
                resp_headers.insert(k.to_string(), serde_json::Value::String(v.to_str().unwrap_or("").to_string()));
            }
            let resp_bytes = resp.bytes().await.unwrap_or_default();
            let resp_body_b64 = base64::engine::general_purpose::STANDARD.encode(&resp_bytes);
            let out_json = serde_json::json!({
                "status": status,
                "headers": resp_headers,
                "body_b64": resp_body_b64,
            });
            let out_bytes = serde_json::to_vec(&out_json)?;

            // Call guest alloc to allocate response buffer and write it, then write result tuple at out_ptr
            let alloc = caller
                .get_export("alloc")
                .and_then(|e| e.into_func())
                .ok_or_else(|| anyhow::anyhow!("no alloc export"))?;
            let alloc = alloc.typed::<i32, i32>(&caller)?;
            let resp_ptr = alloc.call(&mut caller, out_bytes.len() as i32)?;
            let mem = caller
                .get_export("memory")
                .and_then(|e| e.into_memory())
                .ok_or_else(|| anyhow::anyhow!("no memory export"))?;
            let data_mut = mem.data_mut(&mut caller);
            let rstart = resp_ptr as usize;
            let rend = rstart.saturating_add(out_bytes.len());
            if rend > data_mut.len() { anyhow::bail!("resp oob"); }
            data_mut[rstart..rend].copy_from_slice(&out_bytes);
            // write [ptr, len] little-endian at out_ptr
            let ostart = out_ptr as usize;
            if ostart + 8 > data_mut.len() { anyhow::bail!("out oob"); }
            data_mut[ostart..ostart+4].copy_from_slice(&(resp_ptr as u32).to_le_bytes());
            data_mut[ostart+4..ostart+8].copy_from_slice(&((out_bytes.len() as u32)).to_le_bytes());
            Ok(0)
        })
    })?;

    Ok(())
}
