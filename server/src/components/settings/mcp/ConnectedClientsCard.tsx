'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@alga-psa/ui/components/Card';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';

interface Connection {
  grantId: string;
  clientId: string;
  clientName: string | null;
  consentedAt: string;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Something went wrong (${res.status}).`);
  return body as T;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Lets a user see and disconnect the MCP clients they've authorized via the
 * interactive OAuth flow (Alga as MCP Authorization Server). Self-contained:
 * manages its own fetch/revoke so it can be dropped into the MCP settings page.
 */
export default function ConnectedClientsCard() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    api<{ data: Connection[] }>('/api/v1/mcp/connections')
      .then((r) => setConnections(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load connections.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const disconnect = useCallback(async () => {
    if (!removeTarget) return;
    setBusy(true);
    try {
      await api(`/api/v1/mcp/connections?grantId=${encodeURIComponent(removeTarget.grantId)}`, { method: 'DELETE' });
      setRemoveTarget(null);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to disconnect.');
    } finally {
      setBusy(false);
    }
  }, [removeTarget, reload]);

  return (
    <Card id="mcp-connected-clients-card">
      <CardHeader>
        <CardTitle>Connected MCP clients</CardTitle>
        <CardDescription>
          Apps you&apos;ve authorized to access AlgaPSA as you over MCP (e.g. Claude). Disconnect any you no
          longer use.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && <p className="mb-3 text-sm text-[rgb(var(--color-accent-600))]">{error}</p>}
        {loading ? (
          <p className="text-sm text-[rgb(var(--color-text-500))]">Loading…</p>
        ) : connections.length === 0 ? (
          <p className="text-sm text-[rgb(var(--color-text-500))]">No connected clients.</p>
        ) : (
          <ul className="divide-y divide-[rgb(var(--color-border-200))]">
            {connections.map((c) => (
              <li key={c.grantId} className="flex items-center justify-between py-2">
                <div>
                  <div className="text-sm font-medium">{c.clientName || hostOf(c.clientId)}</div>
                  <div className="text-xs text-[rgb(var(--color-text-500))]">
                    {hostOf(c.clientId)} · connected {new Date(c.consentedAt).toLocaleDateString()}
                  </div>
                </div>
                <Button
                  id={`mcp-disconnect-${c.grantId}`}
                  variant="outline"
                  size="sm"
                  onClick={() => setRemoveTarget(c)}
                >
                  Disconnect
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ConfirmationDialog
        id="mcp-disconnect-confirm"
        isOpen={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        onConfirm={disconnect}
        title="Disconnect client"
        message={`Disconnect "${removeTarget?.clientName || (removeTarget ? hostOf(removeTarget.clientId) : '')}"? It will lose access immediately and need to be re-authorized to reconnect.`}
        confirmLabel="Disconnect"
        cancelLabel="Cancel"
        isConfirming={busy}
      />
    </Card>
  );
}
