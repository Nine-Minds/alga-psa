// Host API imports exposed to WASM (alga.*)
use wasmtime::{Linker, Caller, Func, Store};
use super::loader::Limits;

#[derive(Clone, Default)]
pub struct HostApiConfig {
    pub egress_allowlist: Vec<String>,
}

pub fn add_host_imports(linker: &mut Linker<Limits>, _cfg: &HostApiConfig) -> anyhow::Result<()> {
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

    // Stubbed: alga.http.fetch(...) -> returns 0 for now
    linker.func_wrap("alga", "http_fetch", |_caller: Caller<'_, Limits>, _req_ptr: i32, _req_len: i32, _out_ptr: i32| -> i32 {
        // TODO: implement via gateway/broker with allowlist and size caps
        0
    })?;

    Ok(())
}
