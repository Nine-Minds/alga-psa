# Client UI SDK Guide (Iframe)

This guide explains how iframe apps interact with the host via the Extension Iframe SDK and how to build consistent UIs with the UI kit.

## Packages
- `@alga/extension-iframe-sdk` — handshake, auth, navigation, theme, telemetry
- `@alga/ui-kit` — accessible components, design tokens, hooks

## Getting Started

```tsx
import { BridgeProvider, useExtension } from '@alga/extension-iframe-sdk';
import { Button, DataTable } from '@alga/ui-kit';

function App() {
  const { context } = useExtension(); // { extensionId, authHeaders, gatewayBase, theme }

  async function sync() {
    await fetch(`${context.gatewayBase}/api/ext/${context.extensionId}/agreements/sync`, {
      method: 'POST',
      headers: { ...context.authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ force: true })
    });
  }

  return <Button onClick={sync}>Sync</Button>;
}

export default function Root() {
  return (
    <BridgeProvider>
      <App />
    </BridgeProvider>
  );
}
```

## Auth & Requests

- Use `context.authHeaders` for gateway calls; do not forward end‑user tokens
- Always call `/api/ext/${extensionId}/...` paths (the Gateway proxies to Runner `POST /v1/execute`)
- Gateway reference: [server/src/app/api/ext/[extensionId]/[[...path]]/route.ts](../../../server/src/app/api/ext/%5BextensionId%5D/%5B%5B...path%5D%5D/route.ts)

## Navigation

- Prefer host‑managed navigation events when integrated in larger flows
- SDK exposes helpers to request navigation changes from the host (implementation detail subject to SDK version)

## Theme

- UI kit consumes CSS variables provided by the host
- The bridge emits theme updates; subscribe if your app needs to react dynamically

## Telemetry & Logging

- Use SDK/Host APIs to emit telemetry and structured logs rather than `console.*` for operational visibility

## Security Notes

- Do not evaluate code at runtime (no template engines)
- Avoid cross‑origin requests; route everything via the gateway
- UI assets are served by the Runner at `${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/[...]`; the Next.js ext-ui route gates/redirects when rust-host mode is enabled.
- Iframe src is constructed by [buildExtUiSrc()](../../../server/src/lib/extensions/ui/iframeBridge.ts:38) and bootstrapped via [bootstrapIframe()](../../../server/src/lib/extensions/ui/iframeBridge.ts:45)

See also: [DataTable Integration Guide](datatable-integration-guide.md), [Manifest v2](manifest_schema.md), and [API Routing Guide](api-routing-guide.md).
