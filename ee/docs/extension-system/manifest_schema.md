# Alga PSA Extension Manifest v2

Manifest v2 is the canonical specification for the Enterprise Extension System. It defines out-of-process execution, signed content-addressed bundles, component-model runtime metadata, and iframe-only UI served by the Runner.

- See “Correctness Rules” in the README for canonical routing and UI serving behavior (Gateway route, Runner static UI, iframe bootstrap). Gateway scaffold: [server/src/app/api/ext/[extensionId]/[[...path]]/route.ts](../../../server/src/app/api/ext/%5BextensionId%5D/%5B%5B...path%5D%5D/route.ts)

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
  runtime: 'wasm-js@1';         // componentize-js output (see @alga-psa/extension-runtime)
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
- runtime: currently `wasm-js@1` (componentized handlers)
- api.endpoints: optional; when present use unique method+path pairs; paths must start with `/`; currently advisory (not enforced by gateway)
- `ui.entry` must exist in the bundle; manifest-level `entry` field is not used by the current runtime
- `ui.hooks.appMenu.label` must be a non-empty string when present
- capabilities: optional array (defaults to empty); must be recognized by the platform; least‑privilege encouraged
- assets: glob patterns limited to static files; no hidden files by default

## Signing & Provenance

- Bundles are content‑addressed using SHA256 and signed (e.g., `sha256:<hex>`).
- Registry records `content_hash`, `signature`, and publisher certificate/keys.
- Signature verification occurs on publish/install and on load.

See [Security & Signing](security_signing.md).

## Routing & Execution

- Gateway maps `/api/ext/[extensionId]/[[...path]]` requests to tenant installs. Endpoint metadata from the manifest is surfaced to operators today; strict enforcement is **not enabled** (see [2025-11-12 plan](../plans/2025-11-12-extension-system-alignment-plan.md#workstream-a-%E2%80%94-gateway--registry)).
- Gateway normalizes the request and calls Runner `POST /v1/execute` with `{context, http, limits, config, providers, secret_envelope}`.
- Runner executes the handler under isolation and returns `{status, headers, body_b64}` to the Gateway.

See [API Routing Guide](api-routing-guide.md).

## Install Metadata (Config, Providers, Secrets)

Manifest v2 describes the bundle. Tenant-specific configuration is stored separately:

- [`tenant_extension_install_config`](../../server/src/lib/extensions/installConfig.ts) persists per-tenant config maps and provider grants (capability enablement).
- [`tenant_extension_install_secrets`](../../server/src/lib/extensions/installConfig.ts) stores sealed envelopes (Vault transit or inline) that the Runner decrypts on demand.
- The gateway attaches `config`, `providers`, and `secret_envelope` to each Runner call so host capabilities (storage/http/secrets/ui_proxy) can enforce policy.

Plan dependencies and outstanding gaps are documented in [2025-11-12-extension-system-alignment-plan](../plans/2025-11-12-extension-system-alignment-plan.md).

## UI Delivery

- UI is served by the Runner at `${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]` (immutable). The Next.js `ext-ui` route is a gate/redirect when rust-host mode is enabled.
- The host constructs iframe URLs via [buildExtUiSrc()](../../../server/src/lib/extensions/ui/iframeBridge.ts:38) and performs secure bootstrap via [bootstrapIframe()](../../../server/src/lib/extensions/ui/iframeBridge.ts:45).
- No in-process UI rendering and no dynamic import of tenant code in the host.
