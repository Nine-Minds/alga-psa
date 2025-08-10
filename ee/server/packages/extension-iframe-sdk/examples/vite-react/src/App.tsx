import React, { useEffect, useLayoutEffect, useRef } from 'react';
import '@alga/ui-kit/tokens.css';
import { useBridge, useTheme, useAuthToken, useResize } from '@alga/extension-iframe-sdk';
import { Button, Card, Stack, Text } from '@alga/ui-kit';

function SizeReporter() {
  const bridge = useBridge();
  const reportResize = useResize(bridge);
  const ref = useRef<HTMLDivElement | null>(null);

  // Simple resize reporting using ResizeObserver if available; fallback to on mount.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const send = () => reportResize(el.getBoundingClientRect().height);
    send();
    if ('ResizeObserver' in window) {
      const ro = new ResizeObserver(() => send());
      ro.observe(el);
      return () => ro.disconnect();
    }
  }, [reportResize]);

  return (
    <div ref={ref}>
      <Text>Dieser container reports its height to the parent for iframe autosizing.</Text>
    </div>
  );
}

export default function App() {
  const bridge = useBridge();
  const theme = useTheme(bridge);
  const token = useAuthToken(bridge);
  const reportResize = useResize(bridge);

  useEffect(() => {
    // Re-emit current height after theme or token changes (layout may shift)
    reportResize(document.documentElement.scrollHeight);
  }, [theme, token, reportResize]);

  return (
    <Stack gap={12}>
      <Text as="strong" size="lg" weight={700}>Alga Example Extension (Vite + React + TS)</Text>

      <Card>
        <Text as="strong" size="md" weight={600}>Bridge State</Text>
        <Stack>
          <Text><strong>Auth token</strong>: {token ? `${token.substring(0, 6)}…` : 'none yet'}</Text>
          <Text><strong>Theme tokens</strong>: {theme ? Object.keys(theme).length : 0} variables</Text>
        </Stack>
      </Card>

      <Card>
        <Text as="strong" size="md" weight={600}>Theme Preview</Text>
        <Stack>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ width: 20, height: 20, background: 'var(--alga-primary)' }} />
            <Text>Primary: var(--alga-primary)</Text>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ width: 20, height: 20, background: 'var(--alga-bg)' }} />
            <Text>Background: var(--alga-bg)</Text>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ width: 20, height: 20, background: 'var(--alga-fg)' }} />
            <Text>Foreground: var(--alga-fg)</Text>
          </div>
        </Stack>
      </Card>

      <Card>
        <Text as="strong" size="md" weight={600}>Resize Demo</Text>
        <Stack>
          <SizeReporter />
          <Button onClick={() => reportResize(document.documentElement.scrollHeight)}>
            Report Height
          </Button>
        </Stack>
      </Card>

      <Card>
        <Text as="strong" size="md" weight={600}>Navigation</Text>
        <Text>Parent may update iframe src ?path= to navigate. This app does not manipulate its own route.</Text>
      </Card>
    </Stack>
  );
}