import React, { useEffect, useLayoutEffect, useRef } from 'react';
// Optional if UI Kit is available in your workspace:
// import '@alga/ui-kit/tokens.css';
import { useBridge, useTheme, useAuthToken, useResize } from '@alga/extension-iframe-sdk';
// import { Button, Card, Stack, Text } from '@alga/ui-kit';

function SizeReporter() {
  const bridge = useBridge();
  const reportResize = useResize(bridge);
  const ref = useRef<HTMLDivElement | null>(null);

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
      <p>This container reports its height to the parent for iframe autosizing.</p>
    </div>
  );
}

export default function App() {
  const bridge = useBridge();
  const theme = useTheme(bridge);
  const token = useAuthToken(bridge);
  const reportResize = useResize(bridge);

  useEffect(() => {
    reportResize(document.documentElement.scrollHeight);
  }, [theme, token, reportResize]);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <h1>Alga Example Extension (Vite + React + TS)</h1>

      <section>
        <h2>Bridge State</h2>
        <div>
          <div><strong>Auth token</strong>: {token ? `${token.substring(0, 6)}…` : 'none yet'}</div>
          <div><strong>Theme tokens</strong>: {theme ? Object.keys(theme).length : 0} variables</div>
        </div>
      </section>

      <section>
        <h2>Resize Demo</h2>
        <SizeReporter />
        <button onClick={() => reportResize(document.documentElement.scrollHeight)}>Report Height</button>
      </section>
    </div>
  );
}

