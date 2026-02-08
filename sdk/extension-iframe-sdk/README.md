# @alga/extension-iframe-sdk

Client SDK for building UI extensions delivered via iframes. Provides a stable, versioned postMessage bridge, theme token injection, short‑lived auth session handling, and ergonomic React hooks.

Protocol hardening:
- Versioned message envelope with top-level fields: `alga: true`, `version: "1"`, `type`, optional `request_id`, and `payload`
- Origin validation on both sides; child ignores events from unexpected origins
- No usage of `targetOrigin="*"` except in explicit dev/test guard
- Sandbox guidance: default `sandbox="allow-scripts"`; do not include `allow-same-origin` by default

## Quick start

A complete Vite + React + TS example is provided under:
- `packages/extension-iframe-sdk/examples/vite-react`

Build and preview (from the example directory):
- `pnpm dev` or `yarn dev`
- `pnpm build` or `yarn build` (outputs static `index.html + assets/*`)

Embed the built app via iframe with a src of the form:
- Relative (Rust host path): `/ext-ui/{extensionId}/{content_hash}/index.html?path=/desired/route`
- Absolute (when `RUNNER_PUBLIC_BASE` is absolute): `${RUNNER_PUBLIC_BASE}/ext-ui/{extensionId}/{content_hash}/index.html?path=/desired/route`

Use the host helper to construct the URL in the host:
- `buildExtUiSrc()` (see host implementation in `ee/server/src/lib/extensions/ui/iframeBridge.ts`)

## Parent-side (host) bootstrap usage

```ts
// Host-side (not part of this package): see ee/server/src/lib/extensions/ui/iframeBridge.ts
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
  allowedOrigin: 'https://runner.example.com',
  requestId: 'req-123',
});
```

## Child-side (iframe app) usage with React hooks

```tsx
import React, { useEffect } from 'react';
// If you have @alga/ui-kit available locally, include tokens
// import '@alga/ui-kit/tokens.css';
import { useBridge, useTheme, useAuthToken, useResize } from '@alga/extension-iframe-sdk';

export default function App() {
  const bridge = useBridge();
  const tokens = useTheme(bridge);
  const token = useAuthToken(bridge);
  const reportResize = useResize(bridge);

  useEffect(() => {
    reportResize(document.documentElement.scrollHeight);
  }, [tokens, token, reportResize]);

  return <div>My Extension UI</div>;
}
```

## Canonical Handler Calls (UI -> own handler)

Use `callHandlerJson` for extension UI calls instead of direct `fetch()` or manual postMessage wiring:

```ts
import { IframeBridge, callHandlerJson } from '@alga-psa/extension-iframe-sdk';

const bridge = new IframeBridge({ devAllowWildcard: true });
bridge.ready();

const status = await callHandlerJson(bridge, '/api/status');

const created = await callHandlerJson(bridge, '/api/items', {
  method: 'POST',
  body: { name: 'Sample' },
});

await callHandlerJson(bridge, '/api/items/123', { method: 'DELETE' });
```

For non-`POST` methods (`GET`, `PUT`, `PATCH`, `DELETE`), the helper applies method override transport (`__method`) so calls work consistently over the proxy channel.

## Protocol
- Parent → Child: `bootstrap` with `{ session, theme_tokens, navigation }`
- Child → Parent: `ready`, `resize`, `navigate`
- Envelope: `{ alga: true, version: "1", type, request_id?, payload }`

## Security notes
- Iframes should use `sandbox="allow-scripts"` by default
- Avoid `allow-same-origin` unless strictly necessary with additional CSP
- Parent uses strict `targetOrigin`; child validates expected parent origin

## License
BSD-3-Clause — see `LICENSE`.
