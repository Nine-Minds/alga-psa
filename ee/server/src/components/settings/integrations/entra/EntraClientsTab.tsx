'use client';

import React from 'react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { SearchInput } from '@alga-psa/ui/components/SearchInput';
import { EmptyState } from '@alga-psa/ui/components/EmptyState';
import { Loader2 } from 'lucide-react';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import type { ColumnDefinition } from '@alga-psa/types';
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

/** Two hundred mapped clients is a real number; ten rows a page is the app default. */
const CLIENTS_PAGE_SIZE = 10;
import { wasEntraSyncAccepted } from './syncStart';
import {
  ENTRA_CLIENT_FILTERS,
  ENTRA_CLIENT_HEALTH_BADGE_VARIANTS,
  ENTRA_CLIENT_HEALTH_LABEL_KEYS,
  countEntraClientsByFilter,
  entraClientHealth,
  matchesEntraClientFilter,
  sortEntraClientsWorstFirst,
  type EntraClientFilter,
} from './entraClientHealth';
import { RelativeTime } from './RelativeTime';

interface EntraClientsTabProps {
  mappings: EntraConfirmedMapping[];
  loading: boolean;
  onChanged: () => void | Promise<void>;
  /** Where a tenant with nothing mapped has to go next. */
  onOpenConnection?: () => void;
}

function clientLabel(mapping: EntraConfirmedMapping): string {
  return mapping.clientName || mapping.displayName || mapping.primaryDomain || mapping.entraTenantId;
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
  onOpenConnection,
}: EntraClientsTabProps): React.JSX.Element {
  const { t } = useTranslation('msp/integrations');
  const [search, setSearch] = React.useState('');
  const [filter, setFilter] = React.useState<EntraClientFilter>('all');
  const [expanded, setExpanded] = React.useState<string | null>(null);
  /**
   * Which row is working, and at what. Tracking only the row made every button
   * in it show its own busy label, so a preview — which now takes visibly long
   * — put "Starting…" on the Sync button and told the operator a sync had
   * begun when none had.
   */
  const [busyRow, setBusyRow] = React.useState<{ id: string; action: 'preview' | 'sync' } | null>(
    null
  );
  const [previewByRow, setPreviewByRow] = React.useState<Record<string, EntraPreflightResponse>>({});
  const [unlinkTarget, setUnlinkTarget] = React.useState<EntraConfirmedMapping | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  const filterCounts = countEntraClientsByFilter(mappings);
  const visible = sortEntraClientsWorstFirst(
    mappings
      .filter((mapping) => matchesEntraClientFilter(mapping, filter))
      .filter((mapping) => {
        const needle = search.trim().toLowerCase();
        if (!needle) return true;
        return [mapping.clientName, mapping.displayName, mapping.primaryDomain, mapping.entraTenantId]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));
      })
  );

  /**
   * Read the directory and classify it. This is a live call to Microsoft — the
   * same read a real sync makes, minus the writes — so it costs whatever the
   * client's user count costs, and the row says so while it runs.
   */
  const runPreview = React.useCallback(async (mapping: EntraConfirmedMapping) => {
    setBusyRow({ id: mapping.managedTenantId, action: 'preview' });
    // Expand first, so the spinner appears where the report will.
    setExpanded(mapping.managedTenantId);
    setError(null);
    setMessage(null);
    try {
      const result = await runEntraPreflight({ managedTenantId: mapping.managedTenantId });
      if ('error' in result) {
        setError(result.error || t('integrations.entra.pilot.errors.preflightFailed'));
        // Nothing to show, so do not leave an empty panel hanging open.
        setExpanded((current) =>
          current === mapping.managedTenantId && !previewByRow[mapping.managedTenantId]
            ? null
            : current
        );
        return;
      }
      if (result.data) {
        setPreviewByRow((current) => ({ ...current, [mapping.managedTenantId]: result.data! }));
      }
    } finally {
      setBusyRow(null);
    }
  }, [previewByRow, t]);

  const handlePreview = React.useCallback(async (mapping: EntraConfirmedMapping) => {
    // Preview was write-only: the cache it filled was never read, so a second
    // click re-ran a Graph round trip and inserted another preflight row into
    // run history, and the expanded panel had no way to close. It toggles now,
    // and the panel carries "Check again" for a deliberate re-run.
    if (expanded === mapping.managedTenantId) {
      setExpanded(null);
      return;
    }
    if (previewByRow[mapping.managedTenantId]) {
      setExpanded(mapping.managedTenantId);
      return;
    }
    await runPreview(mapping);
  }, [expanded, previewByRow, runPreview]);

  const handleSync = React.useCallback(async (mapping: EntraConfirmedMapping) => {
    setBusyRow({ id: mapping.managedTenantId, action: 'sync' });
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
      if (!wasEntraSyncAccepted(result)) {
        setError(t('integrations.entra.console.errors.syncNotStarted'));
        return;
      }
      setMessage(t('integrations.entra.pilot.started', { client: clientLabel(mapping) }));
      // The preview described a sync that has now happened; keeping it on
      // screen would describe contacts that already exist.
      setPreviewByRow((current) => {
        const { [mapping.managedTenantId]: _done, ...rest } = current;
        return rest;
      });
      setExpanded((current) => (current === mapping.managedTenantId ? null : current));
      await onChanged();
    } finally {
      setBusyRow(null);
    }
  }, [onChanged, t]);

  const handleUnlink = React.useCallback(async () => {
    if (!unlinkTarget) return;
    // Unlink runs from the dialog, which has its own confirming state; the row
    // only needs to stop accepting clicks.
    setBusyRow({ id: unlinkTarget.managedTenantId, action: 'sync' });
    setError(null);
    setMessage(null);
    try {
      // The only irreversible action on this screen was the one action that
      // never checked its result: unmapEntraTenant returns a Forbidden envelope
      // rather than throwing, so a read-only admin watched the dialog close,
      // the table refresh, and the row come back — and was told nothing.
      const result = await unmapEntraTenant({ managedTenantId: unlinkTarget.managedTenantId });
      if ('error' in result) {
        setError(result.error || t('integrations.entra.console.clients.unlinkFailed'));
        return;
      }
      setMessage(
        t('integrations.entra.console.clients.unlinked', { client: clientLabel(unlinkTarget) })
      );
      setUnlinkTarget(null);
      await onChanged();
    } finally {
      setBusyRow(null);
    }
  }, [onChanged, t, unlinkTarget]);

  if (loading) {
    return <div className="h-24 animate-pulse rounded-md bg-muted" id="entra-clients-loading" />;
  }

  const columns: ColumnDefinition<EntraConfirmedMapping>[] = [
    {
      title: t('integrations.entra.console.lastRun.columns.client'),
      dataIndex: 'clientName',
      render: (_value, mapping) => (
        <div className="min-w-0">
          {/* The client is what the operator scans for, so it is the only
              semibold in the row; the domain is the disambiguator, not a
              column of its own. */}
          <span className="font-semibold">{clientLabel(mapping)}</span>
          <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
            {mapping.primaryDomain || mapping.entraTenantId}
          </span>
        </div>
      ),
    },
    {
      title: t('integrations.entra.console.clients.columns.users'),
      dataIndex: 'sourceUserCount',
      width: '96px',
      headerClassName: 'text-right',
      cellClassName: 'text-right tabular-nums',
    },
    {
      title: t('integrations.entra.console.clients.columns.lastSync'),
      dataIndex: 'lastSyncedAt',
      width: '140px',
      render: (_value, mapping) =>
        // The badge beside this already says "Never synced"; repeating it here
        // spends a column on a fact the next column carries.
        mapping.lastSyncedAt ? (
          <RelativeTime value={mapping.lastSyncedAt} fallback={null} className="text-muted-foreground" />
        ) : (
          <span className="text-muted-foreground" aria-hidden="true">—</span>
        ),
    },
    {
      title: t('integrations.entra.console.lastRun.columns.result'),
      dataIndex: 'lastRunStatus',
      width: '130px',
      render: (_value, mapping) => {
        const health = entraClientHealth(mapping);
        return (
          <Badge size="sm" variant={ENTRA_CLIENT_HEALTH_BADGE_VARIANTS[health]}>
            {t(ENTRA_CLIENT_HEALTH_LABEL_KEYS[health])}
          </Badge>
        );
      },
    },
    {
      title: t('integrations.entra.tenantMapping.columns.actions'),
      dataIndex: 'managedTenantId',
      width: '250px',
      sortable: false,
      headerClassName: 'sr-only',
      render: (_value, mapping) => {
        const isExpanded = expanded === mapping.managedTenantId;
        // Every control in a working row is disabled — you cannot sync a client
        // mid-preview — but only the one actually running says so.
        const busy = busyRow?.id === mapping.managedTenantId;
        const previewing = busy && busyRow?.action === 'preview';
        const syncing = busy && busyRow?.action === 'sync';
        return (
          <div className="flex flex-nowrap justify-end gap-1 whitespace-nowrap">
            {/* Preview is the encouraged move — it writes nothing — so it
                leads. Sync writes to contacts and is not the loudest thing on
                a 200-row table. */}
            <Button
              id={`entra-client-preview-${mapping.managedTenantId}`}
              type="button"
              size="xs"
              variant="soft"
              onClick={() => void handlePreview(mapping)}
              disabled={busy}
            >
              {previewing
                ? t('integrations.entra.pilot.actions.previewing')
                : isExpanded
                  ? t('integrations.entra.console.clients.hidePreview')
                  : t('integrations.entra.pilot.actions.preview')}
            </Button>
            <Button
              id={`entra-client-sync-${mapping.managedTenantId}`}
              type="button"
              size="xs"
              variant="outline"
              onClick={() => void handleSync(mapping)}
              disabled={busy}
            >
              {syncing
                ? t('integrations.entra.pilot.actions.syncingOne')
                : t('integrations.entra.console.clients.sync')}
            </Button>
            <Button
              id={`entra-client-unlink-${mapping.managedTenantId}`}
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => setUnlinkTarget(mapping)}
              disabled={busy}
            >
              {t('integrations.entra.console.clients.unlink')}
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-3" id="entra-console-clients">
      {/* items-center, not items-end: both children are the same height, and
          the filter group was being baseline-dragged out of line. */}
      <div className="flex flex-wrap items-center gap-2">
        {/* SearchInput's own input has no width rule, so without w-full it
            renders at the browser's default size, overflows this wrapper, and
            the filter group draws on top of it. */}
        <div className="min-w-[14rem] max-w-sm flex-1">
          <SearchInput
            id="entra-clients-search"
            className="w-full"
            placeholder={t('integrations.entra.console.clients.searchPlaceholder')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onClear={() => setSearch('')}
          />
        </div>
        {/* A segmented set, not four buttons: the chrome lives on the
            container so the neutral "All" state stops being the loudest
            control on the screen. Counts say whether a filter is worth a
            click — "Failing" alone answers nothing. */}
        <div
          className="flex flex-shrink-0 flex-wrap items-center gap-0.5 rounded-md border border-border/70 p-0.5"
          role="group"
        >
          {ENTRA_CLIENT_FILTERS.map((candidate) => (
            <Button
              key={candidate}
              id={`entra-clients-filter-${candidate}`}
              type="button"
              size="xs"
              variant={filter === candidate ? 'soft' : 'ghost'}
              aria-pressed={filter === candidate}
              onClick={() => setFilter(candidate)}
            >
              {t(`integrations.entra.console.clients.filters.${candidate}`)}
              <span className="ml-1.5 tabular-nums text-muted-foreground">
                {filterCounts[candidate]}
              </span>
            </Button>
          ))}
        </div>
      </div>

      {message ? (
        <p className="text-sm text-muted-foreground" id="entra-clients-message">{message}</p>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" id="entra-clients-error">{error}</p>
      ) : null}

      {mappings.length === 0 ? (
        /* Nothing mapped is a setup problem, not a filter problem. Telling a
           tenant that has never mapped a tenant that its filter matched nothing
           describes the wrong screen and names no way forward. */
        <div id="entra-clients-empty-unmapped">
        <EmptyState
          title={t('integrations.entra.console.clients.emptyTitle')}
          description={t('integrations.entra.console.clients.emptyDescription')}
          action={
            onOpenConnection ? (
              <Button
                id="entra-clients-open-connection"
                type="button"
                size="sm"
                variant="outline"
                onClick={onOpenConnection}
              >
                {t('integrations.entra.console.clients.emptyAction')}
              </Button>
            ) : undefined
          }
        />
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-start gap-2 py-6" id="entra-clients-empty">
          <p className="text-sm text-muted-foreground">
            {t('integrations.entra.console.clients.empty')}
          </p>
          <Button
            id="entra-clients-clear-filters"
            type="button"
            size="xs"
            variant="outline"
            onClick={() => {
              setSearch('');
              setFilter('all');
            }}
          >
            {t('integrations.entra.console.clients.clearFilters')}
          </Button>
        </div>
      ) : (
        <DataTable
          id="entra-clients-table"
          data={visible}
          columns={columns}
          pagination={visible.length > CLIENTS_PAGE_SIZE}
          pageSize={CLIENTS_PAGE_SIZE}
          expandedRowRender={(mapping) => {
            if (expanded !== mapping.managedTenantId) return null;
            const preview = previewByRow[mapping.managedTenantId];
            const busy = busyRow?.id === mapping.managedTenantId && busyRow.action === 'preview';

            // A first read has nothing to show yet; a re-check keeps the old
            // report on screen and marks the button busy, so the panel does
            // not blank out under the operator.
            if (busy && !preview) {
              return (
                <div
                  className="flex items-start gap-3"
                  id={`entra-client-preview-loading-${mapping.managedTenantId}`}
                  aria-busy="true"
                >
                  <Loader2
                    className="mt-0.5 h-4 w-4 flex-shrink-0 animate-spin text-[rgb(var(--color-primary-500))]"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {t('integrations.entra.console.clients.previewLoading', {
                        client: clientLabel(mapping),
                      })}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t('integrations.entra.console.clients.previewLoadingHint')}
                    </p>
                  </div>
                </div>
              );
            }

            return preview ? (
              <ContactPreflightReport
                report={preview}
                onRecheck={() => void runPreview(mapping)}
                rechecking={busy}
              />
            ) : null;
          }}
        />
      )}

      <ConfirmationDialog
        id="entra-client-unlink-dialog"
        isOpen={unlinkTarget !== null}
        onClose={() => setUnlinkTarget(null)}
        onConfirm={() => handleUnlink()}
        isConfirming={Boolean(unlinkTarget && busyRow?.id === unlinkTarget.managedTenantId)}
        title={t('integrations.entra.console.clients.unlinkConfirm.title', {
          client: unlinkTarget ? clientLabel(unlinkTarget) : '',
        })}
        message={t('integrations.entra.console.clients.unlinkConfirm.body', {
          client: unlinkTarget ? clientLabel(unlinkTarget) : '',
        })}
        confirmLabel={t('integrations.entra.console.clients.unlink')}
        cancelLabel={t('integrations.entra.settings.actions.cancel')}
      />
    </div>
  );
}

export default EntraClientsTab;
