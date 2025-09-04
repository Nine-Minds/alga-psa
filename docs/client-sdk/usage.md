# Usage

## Install (external project)

```bash
npm i @alga/extension-iframe-sdk
# optional if you have the UI kit
npm i @alga/ui-kit
```

## Child (iframe app)

```tsx
import React, { useEffect } from 'react';
import { useBridge, useTheme, useAuthToken, useResize } from '@alga/extension-iframe-sdk';

export default function App() {
  const bridge = useBridge();
  const theme = useTheme(bridge);
  const token = useAuthToken(bridge);
  const reportResize = useResize(bridge);

  useEffect(() => {
    reportResize(document.documentElement.scrollHeight);
  }, [theme, token, reportResize]);

  return <div>Hello from an Alga extension!</div>;
}
```

## Parent (host)

The host bootstraps the iframe and posts the `bootstrap` message. See `ee/server/src/lib/extensions/ui/iframeBridge.ts` for a reference implementation, including URL building via `buildExtUiSrc()` and origin validation.

Key points:
- Use `sandbox="allow-scripts"` on the iframe
- Enforce `targetOrigin` when posting messages
- Provide short-lived `session.token` and `theme_tokens` in the bootstrap payload

