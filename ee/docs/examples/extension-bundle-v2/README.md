# Example Extension Bundle v2

This is a minimal, content-addressable bundle layout for the Wasmtime runner.

Structure:

```
.
├── manifest.json                 # Required: validated by v2 schema
├── SIGNATURE                     # Optional: detached signature of canonical bundle
├── dist/
│   ├── main.wasm                 # Required entry module (see manifest.entry)
│   └── handlers/
│       ├── http/
│       │   ├── list_agreements.wasm
│       │   └── sync.wasm
│       └── statement.wasm
├── artifacts/
│   └── cwasm/                    # Optional precompiled Wasmtime artifacts
│       ├── x86_64-linux-gnu/
│       │   └── main.cwasm
│       └── aarch64-linux-gnu/
│           └── main.cwasm
├── ui/
│   └── index.html                # Iframe app entry
└── sbom.spdx.json                # Optional SBOM
```

Notes:
- Handlers may include an export name suffix (e.g., `#handle`).
- The bundle is signed and content-addressed (e.g., stored under `sha256/<hash>` in object storage).
- UI is served via the API gateway from a pod-local cache, not from a CDN.

