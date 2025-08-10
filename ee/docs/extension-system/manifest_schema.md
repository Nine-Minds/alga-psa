# Alga PSA Extension Manifest v2
> Status
>
> Manifest v2 in this document is the target specification. The server currently validates a legacy, descriptor-based manifest (tabs/navigation/dashboard/custom-page) and does not yet enforce Manifest v2. See legacy schema in [ee/server/src/lib/extensions/schemas/manifest.schema.ts](ee/server/src/lib/extensions/schemas/manifest.schema.ts).

## Migration mapping (legacy → v2)

- Legacy (current validation)
  - Discriminated union of component types with props:
    - Tab extensions, navigation items, dashboard widgets, custom pages
    - See component schema union (see [ee/server/src/lib/extensions/schemas/manifest.schema.ts](ee/server/src/lib/extensions/schemas/manifest.schema.ts)).
  - Components reference in-process UI renderers (now deprecated).

- Target (v2)
  - Runtime-first with out-of-process execution and iframe-only UI:
    - api.endpoints: explicit HTTP surface
    - ui.type: "iframe" with an entry point
    - capabilities: least-privilege host APIs
  - No dynamic importing of tenant code into the host.
  - Route via `/api/ext/[extensionId]/[...]` (implementation spec; pending server route).
  - UI served via `/ext-ui/{extensionId}/{content_hash}/[...]` (pending server route).

Notes:
- While authoring for v2, keep the examples below as canonical. For production deployments today, ensure legacy manifests pass the legacy schema validator (see [ee/server/src/lib/extensions/schemas/manifest.schema.ts](ee/server/src/lib/extensions/schemas/manifest.schema.ts)).
- Registry v2 types exist but are scaffolds and not DB-wired yet (see [ee/server/src/lib/extensions/registry-v2.ts](ee/server/src/lib/extensions/registry-v2.ts)).


Manifest v2 defines signed, content‑addressed bundles executed out‑of‑process and rendered via iframe UI.

## Overview

- File name: `manifest.json` inside the bundle root
- Declares runtime, capabilities, endpoints, and UI entry
- Used by Registry to validate, install, and route requests

## Type (abridged)

```ts
interface ManifestV2 {
  name: string;                 // reverse‑domain ID, e.g., "com.acme.reports"
  publisher: string;            // organization name
  version: string;              // semver
  runtime: 'wasm-js@1';         // initial supported runtime
  capabilities?: string[];      // e.g., ["http.fetch","storage.kv","secrets.get"]
  ui?: {                        // iframe UI
    type: 'iframe';
    entry: string;              // e.g., "ui/index.html"
  };
  api?: {
    endpoints: Array<{
      method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      path: string;             // e.g., "/agreements" or "/agreements/:id"
      handler: string;          // e.g., "dist/handlers/http/list_agreements"
    }>;
  };
  events?: Array<{             // optional event subscriptions
    topic: string;
    handler: string;
  }>;
  entry?: string;              // main wasm entry, e.g., "dist/main.wasm"
  precompiled?: Record<string, string>; // target triple → cwasm path
  assets?: string[];           // glob patterns, e.g., ["ui/**/*"]
  sbom?: string;               // optional SBOM reference
}
```

## Example

```json
{
  "name": "com.alga.softwareone",
  "publisher": "SoftwareOne",
  "version": "1.2.3",
  "runtime": "wasm-js@1",
  "capabilities": ["http.fetch", "storage.kv", "secrets.get"],
  "ui": { "type": "iframe", "entry": "ui/index.html" },
  "api": {
    "endpoints": [
      { "method": "GET", "path": "/agreements", "handler": "dist/handlers/http/list_agreements" },
      { "method": "POST", "path": "/agreements/sync", "handler": "dist/handlers/http/sync" }
    ]
  },
  "entry": "dist/main.wasm",
  "precompiled": {
    "x86_64-linux-gnu": "artifacts/cwasm/x86_64-linux-gnu/main.cwasm",
    "aarch64-linux-gnu": "artifacts/cwasm/aarch64-linux-gnu/main.cwasm"
  },
  "assets": ["ui/**/*"],
  "sbom": "sbom.spdx.json"
}
```

## Validation Rules

- name: reverse‑domain, lowercase alphanumeric, dots, hyphens; unique per registry
- version: semver
- runtime: currently `wasm-js@1`
- api.endpoints: unique method+path pairs; paths must start with `/`
- handler paths, entry, precompiled, ui.entry must exist in the bundle
- capabilities: must be recognized by the platform; least‑privilege encouraged
- assets: glob patterns limited to static files; no hidden files by default

## Signing & Provenance

- Bundles are content‑addressed (SHA256) and signed
- Registry records `content_hash`, `signature`, and publisher certificate
- Signature verification occurs on install and on load

See [Security & Signing](security_signing.md).

## Routing & Execution

- Gateway maps `/api/ext/[extensionId]/[...]` to manifest endpoints based on the tenant’s installed version
- Runner receives normalized requests and enforces limits; responses must specify `status`, headers, and `body` (base64‑encoded over the wire)

See [API Routing Guide](api-routing-guide.md).

## UI Delivery

- UI is served via `/ext-ui/{extensionId}/{content_hash}/[...]`
- Files are cached per content hash under the pod‑local cache

## Migration Notes

- Prior descriptor‑based and in‑process UI models are deprecated
- Manifests should not reference host components or server filesystem paths
