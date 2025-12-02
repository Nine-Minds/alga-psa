# Enterprise Extension System v2 — Final Outcomes and References

This document presents the v2-only extension model and points to the canonical specifications and guides. It supersedes any prior plans or notes that explored descriptor-based or in‑process rendering models.

## v2 Architecture Outcomes

- Out-of-process execution in a dedicated Runner (Rust + Wasmtime), with strict isolation, quotas, and capability-scoped Host APIs.
- Signed, content-addressed bundles (sha256:...) verified on publish/install and on load, with provenance tracked in the Registry.
- API Gateway route `/api/ext/[extensionId]/[[...path]]` that resolves manifest endpoints (advisory) and proxies to Runner `POST /v1/execute` with strict header/size/time policies.
- UI delivered exclusively via sandboxed iframes; static assets are served by the Runner at `${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]`.
- No dynamic import of tenant code in the host; no in‑process execution of tenant UI.

## Authoring Model

- Manifest v2 is authoritative:
  - runtime, capabilities, api.endpoints, ui.iframe entry, precompiled artifacts, assets.
- Server handlers target the Runner; UI apps run in iframes and use the extension SDK and UI kit.
- Bundles are immutable and content-addressed; signatures are validated against a trust bundle.

## Integration Points (clickable references)

- Gateway route scaffold: [server/src/app/api/ext/[extensionId]/[[...path]]/route.ts](../../../server/src/app/api/ext/%5BextensionId%5D/%5B%5B...path%5D%5D/route.ts)
- Iframe URL builder and bootstrap: [buildExtUiSrc()](../../../server/src/lib/extensions/ui/iframeBridge.ts:38), [bootstrapIframe()](../../../server/src/lib/extensions/ui/iframeBridge.ts:45)
- Registry v2 service scaffold: [ExtensionRegistryServiceV2](ee/server/src/lib/extensions/registry-v2.ts:48)

## Canonical Docs

- Architecture overview and goals: [overview.md](overview.md)
- API routing specifics: [api-routing-guide.md](api-routing-guide.md)
- Manifest v2 schema: [manifest_schema.md](manifest_schema.md)
- Security and signing model: [security_signing.md](security_signing.md)
- Runner responsibilities and configuration: [runner.md](runner.md)
- Development workflow and examples: [development_guide.md](development_guide.md), [sample_template.md](sample_template.md)

## Operational Rules

- All extension HTTP calls traverse `/api/ext/[extensionId]/[...]` and are proxied to the Runner `POST /v1/execute`.
- UI assets are served by the Runner at `${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]` (no Next.js route for ext-ui).
- The host constructs iframe src via [buildExtUiSrc()](../../../server/src/lib/extensions/ui/iframeBridge.ts:38) and initializes via [bootstrapIframe()](../../../server/src/lib/extensions/ui/iframeBridge.ts:45).
