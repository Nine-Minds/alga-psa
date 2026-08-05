'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@alga-psa/ui/components/Card';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { EditionGateError, getEditionGateResponse, isEditionGateError } from '@/lib/editionGating/client';
import type { EditionGateResponseBody } from '@/lib/editionGating/types';

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
  if (!res.ok) {
    const editionGate = getEditionGateResponse(res.status, body);
    if (editionGate) throw new EditionGateError(editionGate);
    throw new Error(body?.error || `Something went wrong (${res.status}).`);
  }
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
export default function ConnectedClientsCard({
  onEditionGate,
}: {
  onEditionGate?: (response: EditionGateResponseBody) => void;
}) {
  const { t } = useTranslation('msp/settings');
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    api<{ data: Connection[] }>('/api/v1/mcp/connections')
      .then((r) => setConnections(r.data))
      .catch((e) => {
        console.error('Failed to load MCP connections:', e);
        if (isEditionGateError(e)) {
          onEditionGate?.(e.response);
          return;
        }
        setError(t('mcpServer.connectedClients.errors.load', { defaultValue: 'Failed to load connections.' }));
      })
      .finally(() => setLoading(false));
  }, [onEditionGate, t]);

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
      console.error('Failed to disconnect MCP client:', e);
      if (isEditionGateError(e)) {
        onEditionGate?.(e.response);
        return;
      }
      setError(t('mcpServer.connectedClients.errors.disconnect', { defaultValue: 'Failed to disconnect.' }));
    } finally {
      setBusy(false);
    }
  }, [onEditionGate, removeTarget, reload, t]);

  return (
    <Card id="mcp-connected-clients-card">
      <CardHeader>
        <CardTitle>{t('mcpServer.connectedClients.title', { defaultValue: 'Connected MCP clients' })}</CardTitle>
        <CardDescription>
          {t('mcpServer.connectedClients.description', {
            defaultValue:
              'Apps you\'ve authorized to access AlgaPSA as you over MCP (e.g. Claude). Disconnect any you no longer use.',
          })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && <p className="mb-3 text-sm text-[rgb(var(--color-accent-600))]">{error}</p>}
        {loading ? (
          <p className="text-sm text-[rgb(var(--color-text-500))]">
            {t('mcpServer.connectedClients.loading', { defaultValue: 'Loading…' })}
          </p>
        ) : connections.length === 0 ? (
          <p className="text-sm text-[rgb(var(--color-text-500))]">
            {t('mcpServer.connectedClients.empty', { defaultValue: 'No connected clients.' })}
          </p>
        ) : (
          <ul className="divide-y divide-[rgb(var(--color-border-200))]">
            {connections.map((c) => (
              <li key={c.grantId} className="flex items-center justify-between py-2">
                <div>
                  <div className="text-sm font-medium">{c.clientName || hostOf(c.clientId)}</div>
                  <div className="text-xs text-[rgb(var(--color-text-500))]">
                    {t('mcpServer.connectedClients.meta', {
                      defaultValue: '{{host}} · connected {{date}}',
                      host: hostOf(c.clientId),
                      date: new Date(c.consentedAt).toLocaleDateString(),
                    })}
                  </div>
                </div>
                <Button
                  id={`mcp-disconnect-${c.grantId}`}
                  variant="outline"
                  size="sm"
                  onClick={() => setRemoveTarget(c)}
                >
                  {t('mcpServer.connectedClients.disconnect', { defaultValue: 'Disconnect' })}
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
        title={t('mcpServer.connectedClients.dialog.title', { defaultValue: 'Disconnect client' })}
        message={t('mcpServer.connectedClients.dialog.message', {
          defaultValue:
            'Disconnect "{{name}}"? It will lose access immediately and need to be re-authorized to reconnect.',
          name: removeTarget?.clientName || (removeTarget ? hostOf(removeTarget.clientId) : ''),
        })}
        confirmLabel={t('mcpServer.connectedClients.dialog.confirm', { defaultValue: 'Disconnect' })}
        cancelLabel={t('mcpServer.connectedClients.dialog.cancel', { defaultValue: 'Cancel' })}
        isConfirming={busy}
      />
    </Card>
  );
}
