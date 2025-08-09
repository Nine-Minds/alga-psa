# Runner Guest ABI (EE)

This document specifies the ABI between the Runner (host) and Extension bundles (guest WebAssembly module).

Scope
- Execution: how the host calls your handler and how you return a response
- Memory/alloc conventions
- Host imports provided (logging, HTTP egress)
- Data formats and constraints

Overview
- The guest exports a linear memory and functions: alloc, handler, and optionally dealloc
- The host writes a normalized request JSON into guest memory and calls handler
- The guest writes a response JSON into guest memory and indicates its location via an out-pointer tuple

Guest exports
- memory: (export "memory") (required)
  - A standard linear memory the host can read/write
- alloc: (export "alloc") (required)
  - Signature: alloc(size: i32) -> i32
  - Returns a pointer to a region of guest memory at least size bytes
- dealloc: (export "dealloc") (optional)
  - Signature: dealloc(ptr: i32, size: i32) -> void
  - If exported, the host may call dealloc for input, output, and tuple buffers after use
- handler: (export "handler") (required)
  - Signature: handler(req_ptr: i32, req_len: i32, out_ptr: i32) -> i32
  - Arguments:
    - req_ptr/req_len: point to a UTF-8 JSON request payload provided by host (see Request JSON)
    - out_ptr: points to an 8-byte area in guest memory where the guest must write back a pair of little-endian i32 values: (resp_ptr, resp_len)
      - resp_ptr: pointer to the start of the response JSON bytes in guest memory
      - resp_len: length in bytes of the response JSON
  - Return value: 0 for success; non-zero indicates application-level error. Traps terminate execution.

Request JSON (host -> guest)
- Bytes at (req_ptr, req_len) are UTF-8 JSON with the shape:
{
  "context": {
    "request_id": string | null,
    "tenant_id": string,
    "extension_id": string,
    "version_id": string | null
  },
  "http": {
    "method": string,            // "GET", "POST", ...
    "path": string,              // "/route"
    "query": { [k: string]: string },
    "headers": { [k: string]: string },
    "body_b64": string | null    // base64-encoded body (if any)
  }
}

Response JSON (guest -> host)
- Guest allocates a buffer via alloc(len), writes UTF-8 JSON, then writes the tuple (resp_ptr, resp_len) at out_ptr
- JSON shape expected by host:
{
  "status": number,                      // e.g., 200
  "headers": { [k: string]: string },    // optional
  "body_b64": string | null              // base64-encoded body (optional)
}
- If the guest returns non-JSON bytes, the host will treat them as an opaque payload and base64-encode them with status 200 and no headers

Host imports (module "alga")
- alga.log_info(ptr: i32, len: i32) -> void
  - Reads UTF-8 string from guest memory and logs at info level
- alga.log_error(ptr: i32, len: i32) -> void
  - Reads UTF-8 string from guest memory and logs at error level
- alga.http.fetch(req_ptr: i32, req_len: i32, out_ptr: i32) -> i32
  - Asynchronous host function exposed synchronously in the ABI; returns 0 on success, non-zero on error (trap on severe errors)
  - Request JSON (at req_ptr/req_len):
    {
      "url": string,                      // required
      "method": string,                   // optional, default "GET"
      "headers": { [k: string]: string }, // optional
      "body_b64": string | null           // optional
    }
  - Allowlist enforcement: the host validates URL host against EXT_EGRESS_ALLOWLIST (comma-separated hostnames). Exact or subdomain match required. If denied, returns error.
  - On success, host writes response JSON to guest memory (alloc used) and stores (resp_ptr, resp_len) at out_ptr with shape:
    {
      "status": number,
      "headers": { [k: string]: string },
      "body_b64": string
    }
  - Notes: Size/time limits may be enforced by the host; avoid large payloads

Limits & timeouts
- Per-invocation limits may be applied by the host:
  - Timeout: context.limits.timeout_ms (default configured by host); exceeding deadline interrupts execution
  - Memory: context.limits.memory_mb (default configured by host); allocations beyond limit will fail
- Egress allowlist: EXT_EGRESS_ALLOWLIST environment variable on the Runner controls which hosts alga.http.fetch can access
- Request/response sizes: the host may enforce maximum sizes for inbound/outbound bodies; exceeding limits will error

Guest design guidance
- Keep handler stateless and idempotent where practical; rely on host-brokered I/O only
- Always check for missing/optional fields in request JSON
- Return normalized response JSON whenever possible (status, headers, body_b64)
- Use alga.http.fetch for outbound HTTP only to allowed domains
- Free memory when exporting dealloc; host will attempt to call it if present

Minimal pseudo-code
- Pseudocode guest outline:
export function alloc(sz: i32): i32 { /* ... */ }
export function dealloc(ptr: i32, sz: i32): void { /* ... */ }
export function handler(req_ptr: i32, req_len: i32, out_ptr: i32): i32 {
  const req = JSON.parse(loadString(req_ptr, req_len));
  const res = { status: 200, headers: { "content-type": "application/json" }, body_b64: b64encode(utf8("{\"ok\":true}")) };
  const buf = utf8(JSON.stringify(res));
  const resp_ptr = alloc(buf.length);
  storeBytes(resp_ptr, buf);
  storeI32(out_ptr + 0, resp_ptr);
  storeI32(out_ptr + 4, buf.length);
  return 0;
}

Error handling
- handler returns non-zero to signal application errors; the host maps this to a 500 execute_failed with the code
- Traps (e.g., out-of-bounds, allowlist denial, host errors) abort execution; the host returns 500 with an error message

Versioning
- This is the initial MVP ABI for the Runner (EE). Future revisions may add:
  - Structured error mapping
  - Built-in size/time limit introspection
  - Additional host imports (KV/doc storage, secrets)

