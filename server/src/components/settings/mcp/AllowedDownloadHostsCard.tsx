'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@alga-psa/ui/components/Card';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Switch } from '@alga-psa/ui/components/Switch';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ColumnDefinition } from '@alga-psa/types';
import {
  addDocumentFetchHost,
  disableBuiltinDocumentFetchHost,
  enableBuiltinDocumentFetchHost,
  listDocumentFetchHosts,
  removeDocumentFetchHost,
} from '@/lib/actions/documentFetchHostActions';
import type {
  BuiltinHostView,
  CustomHostView,
  FetchHostSettingsView,
} from '@/lib/api/services/documents/fetchHostSettings';

/**
 * Settings > MCP Server > "Allowed download hosts". Governs which hosts the server may
 * download from when a document is attached by URL, for every caller (MCP, API, REST).
 * Read-only unless the user holds document:manage_fetch_hosts.
 */
export default function AllowedDownloadHostsCard() {
  const { t } = useTranslation('msp/settings');
  const [settings, setSettings] = useState<FetchHostSettingsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [hostInput, setHostInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<CustomHostView | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listDocumentFetchHosts();
      if (res.success) {
        setSettings(res.settings);
        setError(null);
      } else {
        setError(res.error);
      }
    } catch {
      setError(t('mcpServer.downloadHosts.errors.load', { defaultValue: 'Failed to load allowed download hosts.' }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const canManage = settings?.canManage ?? false;

  const run = async (fn: () => Promise<{ success: boolean; error?: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (!res.success) setError(res.error ?? null);
      await reload();
    } catch {
      setError(t('mcpServer.downloadHosts.errors.save', { defaultValue: 'Could not save the change.' }));
    } finally {
      setBusy(false);
    }
  };

  const closeAdd = () => {
    setAddOpen(false);
    setHostInput('');
    setNoteInput('');
    setAddError(null);
  };

  const submitAdd = async () => {
    setBusy(true);
    setAddError(null);
    try {
      const res = await addDocumentFetchHost({ hostPattern: hostInput, note: noteInput.trim() || null });
      if (!res.success) {
        setAddError(res.error);
        return;
      }
      closeAdd();
      await reload();
    } catch {
      setAddError(t('mcpServer.downloadHosts.errors.save', { defaultValue: 'Could not save the change.' }));
    } finally {
      setBusy(false);
    }
  };

  const builtinColumns: ColumnDefinition<BuiltinHostView>[] = [
    {
      title: t('mcpServer.downloadHosts.table.host', { defaultValue: 'Host' }),
      dataIndex: 'pattern',
      render: (_v, r) => (
        <span className="flex items-center gap-2">
          <span className="font-mono text-xs">{r.pattern}</span>
          <Badge variant="default-muted">{t('mcpServer.downloadHosts.builtIn', { defaultValue: 'Built-in' })}</Badge>
        </span>
      ),
    },
    {
      title: t('mcpServer.downloadHosts.table.used', { defaultValue: 'Used for' }),
      dataIndex: 'label',
    },
    {
      title: t('mcpServer.downloadHosts.table.allowed', { defaultValue: 'Allowed' }),
      dataIndex: 'enabled',
      render: (_v, r) => (
        <Switch
          id={`download-host-builtin-${r.pattern}`}
          checked={r.enabled}
          disabled={!canManage || busy}
          onCheckedChange={(on) =>
            run(() => (on ? enableBuiltinDocumentFetchHost(r.pattern) : disableBuiltinDocumentFetchHost(r.pattern)))
          }
        />
      ),
    },
  ];

  const customColumns: ColumnDefinition<CustomHostView>[] = [
    {
      title: t('mcpServer.downloadHosts.table.host', { defaultValue: 'Host' }),
      dataIndex: 'hostPattern',
      render: (_v, r) => <span className="font-mono text-xs">{r.hostPattern}</span>,
    },
    {
      title: t('mcpServer.downloadHosts.table.note', { defaultValue: 'Note' }),
      dataIndex: 'note',
      render: (_v, r) => r.note ?? '',
    },
    {
      title: t('mcpServer.downloadHosts.table.addedBy', { defaultValue: 'Added by' }),
      dataIndex: 'addedBy',
      render: (_v, r) => r.addedBy ?? '',
    },
    {
      title: t('mcpServer.downloadHosts.table.addedOn', { defaultValue: 'Added on' }),
      dataIndex: 'addedAt',
      render: (_v, r) => new Date(r.addedAt).toLocaleDateString(),
    },
    ...(canManage
      ? [
          {
            title: '',
            dataIndex: 'entryId',
            render: (_v: unknown, r: CustomHostView) => (
              <Button
                id={`download-host-remove-${r.hostPattern}`}
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setRemoveTarget(r)}
              >
                {t('mcpServer.downloadHosts.remove', { defaultValue: 'Remove' })}
              </Button>
            ),
          } as ColumnDefinition<CustomHostView>,
        ]
      : []),
  ];

  return (
    <Card id="mcp-allowed-download-hosts">
      <CardHeader>
        <CardTitle>{t('mcpServer.downloadHosts.title', { defaultValue: 'Allowed download hosts' })}</CardTitle>
        <CardDescription>
          {t('mcpServer.downloadHosts.intro', {
            defaultValue:
              'When a document is attached by URL, AlgaPSA downloads it only from the hosts listed here. This applies to every caller that attaches documents, including AI agents, API clients and the REST API. Prefer bucket-specific hosts such as acme-uploads.s3.us-east-1.amazonaws.com over broad ones.',
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div id="download-hosts-error" className="rounded-md border border-[rgb(var(--badge-error-border))] bg-[rgb(var(--badge-error-bg))] px-3 py-2 text-sm text-[rgb(var(--badge-error-text))]">
            {error}
          </div>
        )}
        {!canManage && settings && (
          <p className="text-sm text-[rgb(var(--color-text-500))]">
            {t('mcpServer.downloadHosts.readOnly', {
              defaultValue: 'You can view this list. Changing it needs the "Manage download hosts" permission.',
            })}
          </p>
        )}
        {loading && !settings ? (
          <p className="text-sm text-[rgb(var(--color-text-500))]">{t('mcpServer.loading', { defaultValue: 'Loading…' })}</p>
        ) : (
          settings && (
            <>
              <DataTable id="download-hosts-builtin-table" data={settings.builtin} columns={builtinColumns} pagination={false} />
              {settings.custom.length > 0 ? (
                <DataTable id="download-hosts-custom-table" data={settings.custom} columns={customColumns} pagination={false} />
              ) : (
                <p className="text-sm text-[rgb(var(--color-text-500))]">
                  {t('mcpServer.downloadHosts.empty', { defaultValue: 'No custom hosts yet.' })}
                </p>
              )}
            </>
          )
        )}
        {canManage && (
          <Button id="download-hosts-add" variant="outline" onClick={() => setAddOpen(true)} disabled={busy}>
            {t('mcpServer.downloadHosts.add', { defaultValue: 'Add host' })}
          </Button>
        )}
      </CardContent>

      <Dialog
        id="download-hosts-add-dialog"
        isOpen={addOpen}
        onClose={closeAdd}
        title={t('mcpServer.downloadHosts.addTitle', { defaultValue: 'Add allowed download host' })}
      >
        <DialogContent>
          <div className="space-y-3">
            <div>
              <Label htmlFor="download-host-input">{t('mcpServer.downloadHosts.fields.host', { defaultValue: 'Host' })}</Label>
              <Input
                id="download-host-input"
                value={hostInput}
                onChange={(e) => setHostInput(e.target.value)}
                placeholder="acme-uploads.s3.us-east-1.amazonaws.com"
              />
              <p className="mt-1 text-xs text-[rgb(var(--color-text-500))]">
                {t('mcpServer.downloadHosts.fields.hostHelp', {
                  defaultValue: 'A hostname, or *.example.com to allow every subdomain.',
                })}
              </p>
            </div>
            <div>
              <Label htmlFor="download-host-note">{t('mcpServer.downloadHosts.fields.note', { defaultValue: 'Note (optional)' })}</Label>
              <Input id="download-host-note" value={noteInput} onChange={(e) => setNoteInput(e.target.value)} />
            </div>
            {addError && (
              <p id="download-host-add-error" className="text-sm text-[rgb(var(--badge-error-text))]">
                {addError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button id="download-host-add-cancel" variant="outline" onClick={closeAdd} disabled={busy}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button id="download-host-add-submit" onClick={submitAdd} disabled={busy || !hostInput.trim()}>
              {t('mcpServer.downloadHosts.add', { defaultValue: 'Add host' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        id="download-host-remove-dialog"
        isOpen={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        onConfirm={async () => {
          const target = removeTarget;
          setRemoveTarget(null);
          if (target) await run(() => removeDocumentFetchHost(target.entryId));
        }}
        title={t('mcpServer.downloadHosts.removeTitle', { defaultValue: 'Remove host?' })}
        message={t('mcpServer.downloadHosts.removeMessage', {
          defaultValue: 'Downloads from {{host}} will stop working until it is added again.',
          host: removeTarget?.hostPattern ?? '',
        })}
        confirmLabel={t('mcpServer.downloadHosts.remove', { defaultValue: 'Remove' })}
      />
    </Card>
  );
}
