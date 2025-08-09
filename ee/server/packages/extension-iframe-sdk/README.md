# @alga/extension-iframe-sdk

Lightweight bridge for extensions running in an iframe inside Alga. Provides auth, navigation, theme, and helper React hooks.

## Install

This package is internal to the monorepo and built via `npm run build` in the server workspace. Consumers import it by path alias or package name when bundled with the host.

## Usage (React)

```tsx
import React from 'react';
import { useBridge, useTheme, useAuthToken } from '@alga/extension-iframe-sdk';
import { Button, Card, Input } from '@alga/ui-kit';
import '@alga/ui-kit/theme.css';

export default function App() {
  const bridge = useBridge();
  const { setMode, getMode } = useTheme();
  const token = useAuthToken();

  return (
    <Card style={{ maxWidth: 480 }}>
      <h3>Welcome to my extension</h3>
      <p>Auth token (short): {token?.slice(0, 10)}…</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <Input placeholder="Type here" />
        <Button onClick={() => bridge.navigate.to('/some/route')}>Go</Button>
        <Button variant="secondary" onClick={() => setMode(getMode() === 'dark' ? 'light' : 'dark')}>
          Toggle theme
        </Button>
      </div>
    </Card>
  );
}
```

## APIs
- bridge: postMessage-based RPC with host
- auth: token retrieval and refresh events
- navigation: request host navigation
- theme: read current theme and subscribe to changes
- hooks: React hooks wrapping the above
