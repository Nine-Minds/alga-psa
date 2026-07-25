'use client';

import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  runEntraPreflight,
  startEntraSync,
  unmapEntraTenant,
  type EntraConfirmedMapping,
  type EntraPreflightResponse,
} from '@alga-psa/integrations/actions';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { ContactPreflightReport } from './ContactPreflightReport';

interface EntraClientsTabProps {
  mappings: EntraConfirmedMapping[];
  loading: boolean;
  onChanged: () => void | Promise<void>;
}

type StateFilter = 'all' | 'never-synced' | 'failing' | 'healthy';

function clientLabel(mapping: EntraConfirmedMapping): string {
  return mapping.clientName || mapping.displayName || mapping.primaryDomain || mapping.entraTenantId;
}

function matchesFilter(mapping: EntraConfirmedMapping, filter: StateFilter): boolean {
  if (filter === 'never-synced') return !mapping.lastSyncedAt;
  if (filter === 'failing') return mapping.lastRunStatus === 'failed';
  if (filter === 'healthy') return mapping.lastRunStatus === 'completed';
  return true;
}

/**
 * Per-client operations at scale. The mapping table is a setup instrument —
 * one row per discovered tenant, built for deciding mappings. Once mappings are
 * decided, the daily question is "which client is unhealthy and what do I do
 * about it", which is what this answers: search, filter by state, and preview,
 * sync or unlink one client without touching the others.
 */
export function EntraClientsTab({
  mappings,
  loading,
  onChanged,
}: EntraClientsTabProps): React.JSX.Element {
  const { t } = useTranslation('msp/integrations');
  const [search, setSearch] = React.useState('');
  const [filter, setFilter] = React.useState<StateFilter>('all');
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [busyRow, setBusyRow] = React.useState<string | null>(null);
  const [previewByRow, setPreviewByRow] = React.useState<Record<string, EntraPreflightResponse>>({});
  const [unlinkTarget, setUnlinkTarget] = React.useState<EntraConfirmedMapping | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  const visible = mappings
    .filter((mapping) => matchesFilter(mapping, filter))
    .filter((mapping) => {
      const needle = search.trim().toLowerCase();
      if (!needle) return true;
      return [mapping.clientName, mapping.displayName, mapping.primaryDomain, mapping.entraTenantId]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });

  const handlePreview = React.useCallback(async (mapping: EntraConfirmedMapping) => {
    setBusyRow(mapping.managedTenantId);
    setError(null);
    setMessage(null);
    try {
      const result = await runEntraPreflight({ managedTenantId: mapping.managedTenantId });
      if ('error' in result) {
        setError(result.error || t('integrations.entra.pilot.errors.preflightFailed'));
        return;
      }
      if (result.data) {
        setPreviewByRow((current) => ({ ...current, [mapping.managedTenantId]: result.data! }));
        setExpanded(mapping.managedTenantId);
      }
    } finally {
      setBusyRow(null);
    }
  }, [t]);

  const handleSync = React.useCallback(async (mapping: EntraConfirmedMapping) => {
    setBusyRow(mapping.managedTenantId);
    setError(null);
    setMessage(null);
    try {
      const result = await startEntraSync({
        scope: 'single-client',
        clientId: mapping.clientId,
        managedTenantId: mapping.managedTenantId,
      });
      if ('error' in result) {
        setError(result.error || t('integrations.entra.pilot.errors.syncFailed'));
        return;
      }
      setMessage(t('integrations.entra.pilot.started', { client: clientLabel(mapping) }));
      await onChanged();
    } finally {
      setBusyRow(null);
    }
  }, [onChanged, t]);

  const handleUnlink = React.useCallback(async () => {
    if (!unlinkTarget) return;
    setBusyRow(unlinkTarget.managedTenantId);
    try {
      await unmapEntraTenant({ managedTenantId: unlinkTarget.managedTenantId });
      setUnlinkTarget(null);
      await onChanged();
    } finally {
      setBusyRow(null);
    }
  }, [onChanged, unlinkTarget]);

  if (loading) {
    return <div className="h-24 animate-pulse rounded-md bg-muted" id="entra-clients-loading" />;
  }

  return (
    <div className="space-y-3" id="entra-console-clients">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-64">
          <Input
            id="entra-clients-search"
            placeholder={t('integrations.entra.console.clients.searchPlaceholder')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {(['all', 'never-synced', 'failing', 'healthy'] as StateFilter[]).map((candidate) => (
            <Button
              key={candidate}
              id={`entra-clients-filter-${candidate}`}
              type="button"
              size="sm"
              variant={filter === candidate ? 'default' : 'ghost'}
              onClick={() => setFilter(candidate)}
            >
              {t(`integrations.entra.console.clients.filters.${candidate}`)}
            </Button>
          ))}
        </div>
      </div>

      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground" id="entra-clients-empty">
          {t('integrations.entra.console.clients.empty')}
        </p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-lg border border-border/70">
          {visible.map((mapping) => {
            const isExpanded = expanded === mapping.managedTenantId;
            const busy = busyRow === mapping.managedTenantId;

            return (
              <li
                key={mapping.managedTenantId}
                className="p-3"
                id={`entra-client-row-${mapping.managedTenantId}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{clientLabel(mapping)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {mapping.primaryDomain || mapping.entraTenantId}
                      {' · '}
                      {mapping.lastSyncedAt
                        ? t('integrations.entra.console.clients.lastSynced', {
                            time: new Date(mapping.lastSyncedAt).toLocaleString(),
                            status: mapping.lastRunStatus || '—',
                          })
                        : t('integrations.entra.console.clients.neverSynced')}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 flex-wrap gap-2">
                    <Button
                      id={`entra-client-preview-${mapping.managedTenantId}`}
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void handlePreview(mapping)}
                      disabled={busy}
                    >
                      {t('integrations.entra.pilot.actions.preview')}
                    </Button>
                    <Button
                      id={`entra-client-sync-${mapping.managedTenantId}`}
                      type="button"
                      size="sm"
                      onClick={() => void handleSync(mapping)}
                      disabled={busy}
                    >
                      {t('integrations.entra.console.clients.sync')}
                    </Button>
                    <Button
                      id={`entra-client-unlink-${mapping.managedTenantId}`}
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setUnlinkTarget(mapping)}
                      disabled={busy}
                    >
                      {t('integrations.entra.console.clients.unlink')}
                    </Button>
                  </div>
                </div>

                {isExpanded && previewByRow[mapping.managedTenantId] ? (
                  <div className="mt-3">
                    <ContactPreflightReport report={previewByRow[mapping.managedTenantId]} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmationDialog
        id="entra-client-unlink-dialog"
        isOpen={unlinkTarget !== null}
        onClose={() => setUnlinkTarget(null)}
        onConfirm={() => handleUnlink()}
        isConfirming={Boolean(unlinkTarget && busyRow === unlinkTarget.managedTenantId)}
        title={t('integrations.entra.settings.unmapConfirm.title')}
        message={t('integrations.entra.settings.unmapConfirm.body', {
          tenant: unlinkTarget ? clientLabel(unlinkTarget) : '',
        })}
        confirmLabel={t('integrations.entra.console.clients.unlink')}
        cancelLabel={t('integrations.entra.settings.actions.cancel')}
      />
    </div>
  );
}

export default EntraClientsTab;
