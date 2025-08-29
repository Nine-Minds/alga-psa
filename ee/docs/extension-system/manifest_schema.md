# Alga PSA Extension Manifest v2

Manifest v2 is the canonical specification for the Enterprise Extension System. It defines out-of-process execution, signed content-addressed bundles, explicit API endpoints, and iframe-only UI served by the Runner.

- API requests are routed through the host Gateway at `/api/ext/[extensionId]/[...path]` and proxied to the Runner `POST /v1/execute` (gateway scaffold: [ee/server/src/app/api/ext/[extensionId]/[...path]/route.ts](ee/server/src/app/api/ext/%5BextensionId%5D/%5B...path%5D/route.ts)).
- UI assets are served by the Runner at `${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]`. The host constructs the iframe src via [buildExtUiSrc()](ee/server/src/lib/extensions/ui/iframeBridge.ts:38) and initializes via [bootstrapIframe()](ee/server/src/lib/extensions/ui/iframeBridge.ts:45).
- Registry v2 provides version/manifest resolution and bundle metadata (see [ExtensionRegistryServiceV2](ee/server/src/lib/extensions/registry-v2.ts:48)).

Manifest v2 defines signed, content-addressed bundles executed out-of-process and rendered via iframe UI.

## Overview

- File name: `manifest.json` inside the bundle root
- Declares runtime, capabilities, API endpoints, and UI entry
- Used by Registry to validate, install, and route requests

## Type (abridged)

```ts
interface ManifestV2 {
  name: string;                 // reverse‑domain ID, e.g., "com.acme.reports"
  publisher: string;            // organization name
  version: string;              // semver
  runtime: 'wasm-js@1';         // initial supported runtime
  capabilities?: string[];      // e.g., ["http.fetch","storage.kv","secrets.get"]
  ui?: {                        // iframe UI (served by Runner)
    type: 'iframe';
    entry: string;              // e.g., "ui/index.html"
    hooks?: {                   // host integration points
      appMenu?: { label: string };
      [key: string]: unknown;   // future: tabs, placeholders
    };
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
  "ui": {
    "type": "iframe",
    "entry": "ui/index.html",
    "hooks": { "appMenu": { "label": "Agreements" } }
  },
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
- handler paths, entry, precompiled artifacts, and `ui.entry` must exist in the bundle
- `ui.hooks.appMenu.label` must be a non-empty string when present
- capabilities: must be recognized by the platform; least‑privilege encouraged
- assets: glob patterns limited to static files; no hidden files by default

## Signing & Provenance

- Bundles are content‑addressed using SHA256 and signed (e.g., `sha256:<hex>`).
- Registry records `content_hash`, `signature`, and publisher certificate/keys.
- Signature verification occurs on publish/install and on load.

See [Security & Signing](security_signing.md).

## Routing & Execution

- Gateway maps `/api/ext/[extensionId]/[...path]` to manifest endpoints based on the tenant’s installed version.
- Gateway normalizes the request and calls Runner `POST /v1/execute` with `{context, http, limits}`.
- Runner executes the handler under isolation and returns `{status, headers, body_b64}` to the Gateway.

See [API Routing Guide](api-routing-guide.md).

## UI Delivery

- UI is served by the Runner at `${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]` (immutable).
- The host constructs iframe URLs via [buildExtUiSrc()](ee/server/src/lib/extensions/ui/iframeBridge.ts:38) and performs secure bootstrap via [bootstrapIframe()](ee/server/src/lib/extensions/ui/iframeBridge.ts:45).
- No in‑process UI rendering and no dynamic import of tenant code in the host.
