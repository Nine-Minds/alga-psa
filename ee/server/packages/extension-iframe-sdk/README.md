# @alga/extension-iframe-sdk

Client SDK for building UI extensions delivered via iframes. Provides a stable, versioned postMessage bridge, theme token injection, short‑lived auth session handling, and ergonomic React hooks.

Protocol hardening in this release:
- Versioned message envelope with top-level fields: `alga: true`, `version: "1"`, `type`, optional `request_id`, and `payload`
- Origin validation on both sides; child ignores events from unexpected origins
- No usage of `targetOrigin="*"` except in explicit dev/test guard
- Sandbox guidance: default `sandbox="allow-scripts"`; do not include `allow-same-origin` by default

## Quick start

A complete Vite + React + TS example is provided under:
- [TypeScript.vite example app](ee/server/packages/extension-iframe-sdk/examples/vite-react/:1)

Build and preview (from the example directory):
- `pnpm dev` or `yarn dev`
- `pnpm build` or `yarn build` (outputs static `index.html + assets/*` suitable for caching under `ui/**/*`)

Embed the built app via iframe with a src of the form:
- Relative (Rust host path): `/ext-ui/{extensionId}/{content_hash}/index.html?path=/desired/route`
- Absolute (when `RUNNER_PUBLIC_BASE` is set and absolute): `${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/index.html?path=/desired/route`

Use the Node-side helper to construct the URL in the host:
- [TypeScript.buildExtUiSrc()](server/src/lib/extensions/assets/url.ts:1)

## Parent-side (host) bootstrap usage

Use the host bridge to enforce sandbox defaults, validate origins, inject theme tokens into the parent, and send the bootstrap envelope to the child iframe.

Example:

```ts
import { bootstrapIframe, buildExtUiSrc } from 'server-side-import'; // See note below

const iframe = document.querySelector('iframe#my-ext')!;
iframe.src = buildExtUiSrc(extensionId, contentHash, '/');

bootstrapIframe({
  iframe,
  extensionId,
  contentHash, // must match /^sha256:[0-9a-f]{64}$/i
  initialPath: '/',
  session: { token: shortLivedToken, expiresAt: '2025-01-01T00:00:00Z' },
  themeTokens: {
    '--alga-primary': '#2266ff',
    '--alga-bg': '#fff',
    '--alga-fg': '#111',
  },
  // If RUNNER_PUBLIC_BASE is absolute, provide the exact allowed origin for the iframe app:
  allowedOrigin: 'https://runner.example.com',
  requestId: 'req-123', // optional correlation ID
});
```

Notes:
- The host bridge is implemented at [TypeScript.bootstrapIframe()](ee/server/src/lib/extensions/ui/iframeBridge.ts:1).
- The URL builder is centralized at [TypeScript.buildExtUiSrc()](server/src/lib/extensions/assets/url.ts:1) delegating to a shared helper [TypeScript.url.shared.ts](server/src/lib/extensions/assets/url.shared.ts:1).

## Child-side (iframe app) usage with React hooks

```tsx
import React, { useEffect } from 'react';
import '@alga/ui-kit/tokens.css';
import { useBridge, useTheme, useAuthToken, useResize } from '@alga/extension-iframe-sdk';
import { Card, Text, Button } from '@alga/ui-kit';

export default function App() {
  const bridge = useBridge();              // sends a versioned "ready" handshake once mounted
  const tokens = useTheme(bridge);         // CSS variables map after bootstrap
  const token = useAuthToken(bridge);      // short-lived session token from bootstrap
  const reportResize = useResize(bridge);  // helper to post resize messages to parent

  useEffect(() => {
    // report initial height and whenever layout may change
    reportResize(document.documentElement.scrollHeight);
  }, [tokens, token, reportResize]);

  return (
    <Card>
      <Text as="strong" size="lg" weight={700}>My Extension</Text>
      <Text>Auth token short: {token ? `${token.slice(0, 6)}…` : 'no token yet'}</Text>
      <Button onClick={() => reportResize(document.documentElement.scrollHeight)}>Report Height</Button>
    </Card>
  );
}
```

## Protocol details

All messages use the envelope:
```jsonc
{
  "alga": true,
  "version": "1",
  "type": "string",
  "request_id": "optional",
  "payload": { /* type-specific */ }
}
```

Types:
- Parent → Child: `bootstrap`
  - `payload.session` contains `{ token, expires_at }`
  - `payload.theme_tokens` contains CSS variables like `--alga-primary`
  - `payload.navigation.path` contains the desired client route
- Child → Parent: `ready`, `resize`, `navigate`

Origin checks:
- Child only accepts messages from `window.location.origin` by default, or an explicit `expectedParentOrigin`
- Parent enforces `targetOrigin` when posting, derived from iframe src or `allowedOrigin` (never `"*"` unless dev/test guarded)

## Security

CSP for parent pages embedding iframes (example):
```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data:;
  connect-src 'self' https://api.example.com;
  frame-src https://runner.example.com;
```

Sandbox attribute:
- Use `sandbox="allow-scripts"` by default
- Do not include `allow-same-origin` unless strictly necessary for APIs that require it, and only after security review with additional CSP hardening
- Parent enforces `targetOrigin` for `postMessage`; child enforces expected parent origin

## Reference

- Host bootstrap: [TypeScript.bootstrapIframe()](ee/server/src/lib/extensions/ui/iframeBridge.ts:1)
- URL builder: [TypeScript.buildExtUiSrc()](server/src/lib/extensions/assets/url.ts:1)
- Example app: [TypeScript.Vite React example](ee/server/packages/extension-iframe-sdk/examples/vite-react/:1)
- Hooks: [TypeScript.useBridge()](ee/server/packages/extension-iframe-sdk/src/hooks.ts:1), [TypeScript.useTheme()](ee/server/packages/extension-iframe-sdk/src/hooks.ts:1), [TypeScript.useAuthToken()](ee/server/packages/extension-iframe-sdk/src/hooks.ts:1), [TypeScript.useResize()](ee/server/packages/extension-iframe-sdk/src/hooks.ts:1)
- Types/envelope: [TypeScript.types.ts](ee/server/packages/extension-iframe-sdk/src/types.ts:1)
