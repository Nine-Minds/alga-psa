import React, { useMemo, useState } from 'react';

import { IframeBridge, callHandlerJson } from '@alga-psa/extension-iframe-sdk';
import { Button, Card, Stack, Text } from '@alga-psa/ui-kit';

const bridge = new IframeBridge({ devAllowWildcard: true });
bridge.ready();

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runProxyCall(path: string) {
  return callHandlerJson(bridge, path);
}

export default function App() {
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>('Ready.');

  const output = useMemo(() => JSON.stringify(result, null, 2), [result]);

  const runAction = async (actionKey: string, path: string) => {
    setActiveAction(actionKey);
    try {
      const nextResult = await runProxyCall(path);
      setResult({ ok: true, path, result: nextResult });
    } catch (error) {
      setResult({ ok: false, path, error: formatError(error) });
    } finally {
      setActiveAction(null);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        padding: 24,
        background: 'linear-gradient(180deg, var(--alga-bg) 0%, var(--alga-primary-50) 100%)',
        color: 'var(--alga-fg)',
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <Stack gap={16}>
          <Stack gap={6}>
            <Text as="strong" size="lg" weight={700}>
              Client/Service Read Demo
            </Text>
            <Text as="p" tone="muted" style={{ margin: 0 }}>
              Uses host capabilities for tenant-scoped client and service reads without calling
              internal APIs from the handler.
            </Text>
          </Stack>

          <Card>
            <Stack direction="row" gap={10} style={{ flexWrap: 'wrap' }}>
              <Button
                variant="secondary"
                onClick={() => void runAction('clients', '/api/clients')}
                disabled={activeAction !== null}
              >
                {activeAction === 'clients' ? 'Loading...' : 'Load Clients'}
              </Button>
              <Button
                variant="outline"
                onClick={() => void runAction('services', '/api/services')}
                disabled={activeAction !== null}
              >
                {activeAction === 'services' ? 'Loading...' : 'Load Services'}
              </Button>
            </Stack>
          </Card>

          <div
            style={{
              display: 'grid',
              gap: 16,
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            }}
          >
            <Card>
              <Stack gap={10}>
                <Text as="strong" weight={600}>
                  What It Tests
                </Text>
                <Text as="p" tone="muted" size="sm" style={{ margin: 0 }}>
                  Separate UI actions for the two read capabilities exposed by this sample.
                </Text>
                <Stack gap={8}>
                  <Text size="sm">
                    <code>GET /api/clients</code>
                  </Text>
                  <Text size="sm">
                    <code>GET /api/services</code>
                  </Text>
                </Stack>
              </Stack>
            </Card>

            <Card>
              <Stack gap={10}>
                <Text as="strong" weight={600}>
                  Output
                </Text>
                <Text as="p" tone="muted" size="sm" style={{ margin: 0 }}>
                  Live handler response from the installed extension.
                </Text>
                <pre
                  style={{
                    margin: 0,
                    padding: '16px',
                    minHeight: 240,
                    overflow: 'auto',
                    borderRadius: 'var(--alga-radius)',
                    background: 'var(--alga-muted)',
                    color: 'var(--alga-fg)',
                    border: '1px solid var(--alga-border)',
                    fontSize: 12,
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {output}
                </pre>
              </Stack>
            </Card>
          </div>
        </Stack>
      </div>
    </div>
  );
}
