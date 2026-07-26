'use client';

import React from 'react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { SearchInput } from '@alga-psa/ui/components/SearchInput';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@alga-psa/ui/components/Table';
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
import { formatEntraExactTime, formatEntraRelativeTime } from './timeFormat';

interface EntraClientsTabProps {
  mappings: EntraConfirmedMapping[];
  loading: boolean;
  onChanged: () => void | Promise<void>;
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
}: EntraClientsTabProps): React.JSX.Element {
  const { t } = useTranslation('msp/integrations');
  const [search, setSearch] = React.useState('');
  const [filter, setFilter] = React.useState<EntraClientFilter>('all');
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [busyRow, setBusyRow] = React.useState<string | null>(null);
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
      if (!wasEntraSyncAccepted(result)) {
        setError(t('integrations.entra.console.errors.syncNotStarted'));
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
          <SearchInput
            id="entra-clients-search"
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
        <div className="flex flex-wrap items-center gap-0.5 rounded-md border border-border/70 p-0.5" role="group">
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

      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground" id="entra-clients-empty">
          {t('integrations.entra.console.clients.empty')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border/70">
          <Table>
            <TableHeader>
              {/* The console labels every group this way (Stat, RailCard); the
                  table was the one place still using sentence-case 14px. */}
              <TableRow className="border-b border-border/60 [&>th]:h-9 [&>th]:text-xs [&>th]:uppercase [&>th]:tracking-wide">
                <TableHead>{t('integrations.entra.console.lastRun.columns.client')}</TableHead>
                <TableHead className="text-right">
                  {t('integrations.entra.console.clients.columns.users')}
                </TableHead>
                <TableHead>{t('integrations.entra.console.clients.columns.lastSync')}</TableHead>
                <TableHead>{t('integrations.entra.console.lastRun.columns.result')}</TableHead>
                {/* Three self-labelling buttons need no column title. */}
                <TableHead aria-label={t('integrations.entra.tenantMapping.columns.actions')} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((mapping) => {
                const isExpanded = expanded === mapping.managedTenantId;
                const busy = busyRow === mapping.managedTenantId;
                const preview = previewByRow[mapping.managedTenantId];
                const health = entraClientHealth(mapping);

                return (
                  <React.Fragment key={mapping.managedTenantId}>
                    <TableRow
                      id={`entra-client-row-${mapping.managedTenantId}`}
                      className="border-b border-border/60"
                    >
                      <TableCell>
                        {/* The client is what the operator scans for, so it is
                            the only semibold in the row; the domain is the
                            disambiguator, not a column of its own. */}
                        <span className="font-semibold">{clientLabel(mapping)}</span>
                        <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                          {mapping.primaryDomain || mapping.entraTenantId}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {mapping.sourceUserCount}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {/* The badge beside this already says "Never synced";
                            repeating it here spends a column on a fact the next
                            column carries. */}
                        {mapping.lastSyncedAt ? (
                          <span title={formatEntraExactTime(mapping.lastSyncedAt) ?? undefined}>
                            {formatEntraRelativeTime(mapping.lastSyncedAt)}
                          </span>
                        ) : (
                          <span aria-hidden="true">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          size="sm"
                          variant={ENTRA_CLIENT_HEALTH_BADGE_VARIANTS[health] as never}
                        >
                          {t(ENTRA_CLIENT_HEALTH_LABEL_KEYS[health])}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-nowrap justify-end gap-1 whitespace-nowrap">
                          {/* Preview is the encouraged move — it writes nothing
                              — so it leads. Sync writes to contacts and is not
                              the loudest thing on a 200-row table. */}
                          <Button
                            id={`entra-client-preview-${mapping.managedTenantId}`}
                            type="button"
                            size="xs"
                            variant="soft"
                            onClick={() => void handlePreview(mapping)}
                            disabled={busy}
                          >
                            {t('integrations.entra.pilot.actions.preview')}
                          </Button>
                          <Button
                            id={`entra-client-sync-${mapping.managedTenantId}`}
                            type="button"
                            size="xs"
                            variant="outline"
                            onClick={() => void handleSync(mapping)}
                            disabled={busy}
                          >
                            {t('integrations.entra.console.clients.sync')}
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
                      </TableCell>
                    </TableRow>

                    {isExpanded && preview ? (
                      <TableRow>
                        <TableCell colSpan={5} className="bg-muted/20">
                          <ContactPreflightReport report={preview} />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
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
