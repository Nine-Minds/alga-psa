# Alga PSA Extension System (ext-v2)

This directory contains the v2 extension system. Legacy descriptor-era UI (tabs/pages/navigation rendered in host) and host-side renderers have been removed. Extension UI is served exclusively by the Runner in an iframe.

Key principles:
- No host-side extension UI rendering in Next.js. The previous ExtensionRenderer/slots are removed.
- The host embeds Runner-hosted UI via iframe and communicates via the iframe bridge utilities.
- All server calls from the host to an extension go through the Gateway at /api/ext/[extensionId]/[...], which forwards to Runner /v1/execute.

Directory structure (v2):
- /lib/extensions/
  - /bundles/manifest.ts — Manifest parsing; supports wildcard versions (e.g., `"1.2.*"` auto-increments on install).
  - /types.ts — Core extension system types used by registry/storage/validation.
  - /registry-v2.ts — v2 registry.
  - /lib/gateway-* — Gateway helpers to communicate with Runner.
  - /storage/* — Extension storage services.
  - /ui/
    - ExtensionProvider.tsx — Context provider if still used by host pages.
    - iframeBridge.ts — Bridge helpers for iframe postMessage lifecycle.
    - index.ts — Public exports for Provider + iframe bridge only.
  - /example-integration/ — Legacy descriptor examples removed; see note below.

What changed from legacy (descriptor-era) to v2:
- Removed host-side descriptors, TabExtensionSlot, NavigationSlot, Page components, and security/propWhitelist.
- Removed host dynamic imports of extension JS and any Next.js “ext-ui” routes.
- Host now embeds Runner UI directly:
  - Runner public UI URL: ${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]
  - Host-Runner API: /api/ext/[extensionId]/[...] (Gateway → Runner /v1/execute)

Embedding Runner iframe:
- Use iframe plus the iframeBridge helpers to bootstrap handshake and message passing.
- Load src from Runner, not from /api/extensions or any Next.js route.

Example pseudo-code:
- Build iframe src using a signed/public URL provided by the Gateway/Registry.
- Use iframeBridge to initialize communication and handle events.

Do not use:
- ui/DescriptorRenderer, ui/descriptors, ui/pages, ui/tabs, ui/navigation
- security/propWhitelist
- routing/ExtensionRouter
- actions/extension-actions (legacy loader paths)
- hooks/useExtensions
- /app/api/extensions/* or /api/extensions/*

Example integration directory:
- The previous descriptor-based examples are no longer valid for v2 and have been removed. If examples are needed, add a README explaining how to embed Runner iframe UI and invoke Gateway actions. No code wiring in host is required.

Pointers:
- UI: Runner-hosted UI via ${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]
- API: /api/ext/[extensionId]/[...] → Gateway → Runner /v1/execute

Notes:
- Keep the codebase v2-only. Avoid re-introducing any Next.js ext-ui routes or descriptor artifacts.
- If you find any lingering legacy references, remove them and replace with the iframe + Gateway approach.