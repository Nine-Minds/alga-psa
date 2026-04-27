'use client';

import React from 'react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getEntraMappingPreview, confirmEntraMappings } from '@alga-psa/integrations/actions';
import { skipEntraTenantMapping, importEntraTenantAsClient } from '@alga-psa/integrations/actions';
import { getAllClients } from '@alga-psa/clients/actions';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import type { IClient } from '@alga-psa/types';

type MatchReason = 'exact_domain' | 'secondary_domain' | 'fuzzy_name';

interface MappingCandidate {
  clientId: string;
  clientName: string;
  confidenceScore: number;
  reason: MatchReason;
}

interface MappingTenantRow {
  managedTenantId: string;
  entraTenantId: string;
  displayName: string | null;
  primaryDomain: string | null;
  sourceUserCount: number;
  state: 'auto_matched' | 'needs_review' | 'unmatched' | 'imported';
  candidates: MappingCandidate[];
  selectedClientId: string | null;
  isSkipped: boolean;
}

export interface EntraMappingSummary {
  mapped: number;
  skipped: number;
  needsReview: number;
}

export interface EntraSkippedTenant {
  managedTenantId: string;
  displayName: string | null;
  primaryDomain: string | null;
}

function formatConfidence(score: number): string {
  return `${Math.round(score * 100)}%`;
}

function mapPreviewToRows(payload: any): MappingTenantRow[] {
  const autoMatched = Array.isArray(payload?.autoMatched) ? payload.autoMatched : [];
  const fuzzyCandidates = Array.isArray(payload?.fuzzyCandidates) ? payload.fuzzyCandidates : [];
  const unmatched = Array.isArray(payload?.unmatched) ? payload.unmatched : [];

  const rows: MappingTenantRow[] = [];

  for (const item of autoMatched) {
    const match = item?.match || {};
    rows.push({
      managedTenantId: String(item?.managedTenantId || ''),
      entraTenantId: String(item?.entraTenantId || ''),
      displayName: item?.displayName || null,
      primaryDomain: item?.primaryDomain || null,
      sourceUserCount: Number(item?.sourceUserCount || 0),
      state: 'auto_matched',
      candidates: [
        {
          clientId: String(match.clientId || ''),
          clientName: String(match.clientName || ''),
          confidenceScore: Number(match.confidenceScore || 0),
          reason: (match.reason || 'exact_domain') as MatchReason,
        },
      ],
      selectedClientId: String(match.clientId || '') || null,
      isSkipped: false,
    });
  }

  for (const item of fuzzyCandidates) {
    const candidates = Array.isArray(item?.candidates) ? item.candidates : [];
    rows.push({
      managedTenantId: String(item?.managedTenantId || ''),
      entraTenantId: String(item?.entraTenantId || ''),
      displayName: item?.displayName || null,
      primaryDomain: item?.primaryDomain || null,
      sourceUserCount: Number(item?.sourceUserCount || 0),
      state: 'needs_review',
      candidates: candidates.map((candidate: any) => ({
        clientId: String(candidate?.clientId || ''),
        clientName: String(candidate?.clientName || ''),
        confidenceScore: Number(candidate?.confidenceScore || 0),
        reason: (candidate?.reason || 'fuzzy_name') as MatchReason,
      })),
      selectedClientId: null,
      isSkipped: false,
    });
  }

  for (const item of unmatched) {
    rows.push({
      managedTenantId: String(item?.managedTenantId || ''),
      entraTenantId: String(item?.entraTenantId || ''),
      displayName: item?.displayName || null,
      primaryDomain: item?.primaryDomain || null,
      sourceUserCount: Number(item?.sourceUserCount || 0),
      state: 'unmatched',
      candidates: [],
      selectedClientId: null,
      isSkipped: false,
    });
  }

  return rows;
}

export function EntraTenantMappingTable({
  onSummaryChange,
  onSkippedTenantsChange,
  onPersistedMappingChange,
  refreshKey,
}: {
  onSummaryChange?: (summary: EntraMappingSummary) => void;
  onSkippedTenantsChange?: (rows: EntraSkippedTenant[]) => void;
  onPersistedMappingChange?: () => void;
  refreshKey?: number;
}) {
  const { t } = useTranslation('msp/integrations');
  const reasonLabel = React.useCallback((reason: MatchReason): string => {
    if (reason === 'exact_domain') return t('integrations.entra.tenantMapping.reasons.exactDomain');
    if (reason === 'secondary_domain') return t('integrations.entra.tenantMapping.reasons.secondaryDomain');
    return t('integrations.entra.tenantMapping.reasons.fuzzyName');
  }, [t]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<MappingTenantRow[]>([]);
  const [allClients, setAllClients] = React.useState<IClient[]>([]);
  const [skippingByRow, setSkippingByRow] = React.useState<Record<string, boolean>>({});
  const [importingByRow, setImportingByRow] = React.useState<Record<string, boolean>>({});
  const [confirmingMappings, setConfirmingMappings] = React.useState(false);
  const [confirmFeedback, setConfirmFeedback] = React.useState<string | null>(null);

  const loadPreview = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getEntraMappingPreview();
      if ('error' in result) {
        setRows([]);
        setError(result.error || t('integrations.entra.tenantMapping.errors.loadFailed'));
        return;
      }

      setRows(mapPreviewToRows(result.data));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadPreview();
  }, [loadPreview, refreshKey]);

  React.useEffect(() => {
    const loadClients = async () => {
      try {
        const result = await getAllClients();
        const normalized = (Array.isArray(result) ? result : []) as IClient[];
        normalized.sort((a, b) => (a.client_name || '').localeCompare(b.client_name || ''));
        setAllClients(normalized);
      } catch {
        setAllClients([]);
      }
    };

    void loadClients();
  }, []);

  const summary = React.useMemo<EntraMappingSummary>(() => ({
    mapped: rows.filter((row) => !row.isSkipped && Boolean(row.selectedClientId)).length,
    skipped: rows.filter((row) => row.isSkipped).length,
    needsReview: rows.filter((row) => !row.isSkipped && row.state === 'needs_review').length,
  }), [rows]);

  const skippedTenants = React.useMemo<EntraSkippedTenant[]>(() => (
    rows
      .filter((row) => row.isSkipped)
      .map((row) => ({
        managedTenantId: row.managedTenantId,
        displayName: row.displayName,
        primaryDomain: row.primaryDomain,
      }))
  ), [rows]);

  // Use refs to keep track of what was last reported, to avoid unnecessary state up- propagation
  const lastSummaryRef = React.useRef<typeof summary | null>(null);
  const lastSkippedRef = React.useRef<typeof skippedTenants | null>(null);

  React.useEffect(() => {
    if (lastSummaryRef.current !== summary) {
      lastSummaryRef.current = summary;
      onSummaryChange?.(summary);
    }
  }, [summary, onSummaryChange]);

  React.useEffect(() => {
    if (lastSkippedRef.current !== skippedTenants) {
      lastSkippedRef.current = skippedTenants;
      onSkippedTenantsChange?.(skippedTenants);
    }
  }, [skippedTenants, onSkippedTenantsChange]);

  const mappingsToConfirm = React.useMemo(
    () =>
      rows
        .filter((row) => !row.isSkipped && row.state !== 'imported' && Boolean(row.selectedClientId))
        .map((row) => ({
          managedTenantId: row.managedTenantId,
          clientId: String(row.selectedClientId),
          mappingState: 'mapped' as const,
          confidenceScore: row.candidates[0]?.confidenceScore ?? null,
        })),
    [rows]
  );

  const updateSelection = React.useCallback((managedTenantId: string, selectedClientId: string) => {
    setRows((currentRows) =>
      currentRows.map((row) =>
        row.managedTenantId === managedTenantId
          ? { ...row, selectedClientId: selectedClientId || null }
          : row
      )
    );
  }, []);

  const handleSkip = React.useCallback(async (row: MappingTenantRow) => {
    if (!row.managedTenantId) {
      return;
    }

    setConfirmFeedback(null);
    setSkippingByRow((current) => ({ ...current, [row.managedTenantId]: true }));
    try {
      const result = await skipEntraTenantMapping({
        managedTenantId: row.managedTenantId,
      });

      if ('error' in result) {
        setError(result.error || t('integrations.entra.tenantMapping.errors.skipFailed'));
        return;
      }

      setRows((currentRows) =>
        currentRows.map((currentRow) =>
          currentRow.managedTenantId === row.managedTenantId
            ? { ...currentRow, isSkipped: true, selectedClientId: null }
            : currentRow
        )
      );
      onPersistedMappingChange?.();
    } finally {
      setSkippingByRow((current) => ({ ...current, [row.managedTenantId]: false }));
    }
  }, [onPersistedMappingChange]);

  const handleImportAsClient = React.useCallback(async (row: MappingTenantRow) => {
    if (!row.managedTenantId) {
      return;
    }

    setConfirmFeedback(null);
    setImportingByRow((current) => ({ ...current, [row.managedTenantId]: true }));
    try {
      const result = await importEntraTenantAsClient({
        managedTenantId: row.managedTenantId,
      });

      if ('error' in result) {
        setError(result.error || t('integrations.entra.tenantMapping.errors.importFailed'));
        return;
      }

      // Update the row state locally so the table visually marks it as imported, and update the client picker
      const clientResult = await getAllClients();
      if (Array.isArray(clientResult)) {
        const normalized = clientResult as IClient[];
        normalized.sort((a, b) => (a.client_name || '').localeCompare(b.client_name || ''));
        setAllClients(normalized);
      }

      setRows((currentRows) =>
        currentRows.map((r) =>
          r.managedTenantId === row.managedTenantId && 'clientId' in result.data
            ? { ...r, state: 'imported', selectedClientId: result.data.clientId, isSkipped: false }
            : r
        )
      );
      onPersistedMappingChange?.();
    } finally {
      setImportingByRow((current) => ({ ...current, [row.managedTenantId]: false }));
    }
  }, [onPersistedMappingChange]);

  const handleConfirmSelectedMappings = React.useCallback(async () => {
    if (mappingsToConfirm.length === 0) {
      setConfirmFeedback(t('integrations.entra.tenantMapping.errors.selectAtLeastOne'));
      return;
    }

    setConfirmFeedback(null);
    setConfirmingMappings(true);
    try {
      const result = await confirmEntraMappings({
        mappings: mappingsToConfirm,
      });

      if ('error' in result) {
        setError(result.error || t('integrations.entra.tenantMapping.errors.confirmFailed'));
        return;
      }

      setError(null);
      const confirmed = Number(result.data?.confirmedMappings || 0);
      setConfirmFeedback(
        confirmed === 1
          ? t('integrations.entra.tenantMapping.feedback.confirmedOne', { count: confirmed })
          : t('integrations.entra.tenantMapping.feedback.confirmed', { count: confirmed }),
      );
      onPersistedMappingChange?.();
    } finally {
      setConfirmingMappings(false);
    }
  }, [mappingsToConfirm, onPersistedMappingChange, t]);

  const handlePreselectExactMatches = React.useCallback(() => {
    setRows((currentRows) =>
      currentRows.map((row) => {
        if (row.state !== 'auto_matched' || row.isSkipped) {
          return row;
        }

        const topCandidate = row.candidates[0];
        if (!topCandidate?.clientId) {
          return row;
        }

        return {
          ...row,
          selectedClientId: topCandidate.clientId,
        };
      })
    );
  }, []);

  return (
    <div className="space-y-3" id="entra-mapping-table">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{t('integrations.entra.tenantMapping.title')}</p>
        <div className="flex gap-2">
          <Button
            id="entra-confirm-selected-mappings"
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleConfirmSelectedMappings()}
            disabled={loading || confirmingMappings || mappingsToConfirm.length === 0}
          >
            {confirmingMappings
              ? t('integrations.entra.tenantMapping.actions.confirming')
              : t('integrations.entra.tenantMapping.actions.confirmSelected')}
          </Button>
          <Button
            id="entra-preselect-exact-matches"
            type="button"
            variant="outline"
            size="sm"
            onClick={handlePreselectExactMatches}
            disabled={loading}
          >
            {t('integrations.entra.tenantMapping.actions.preselectExact')}
          </Button>
          <Button id="entra-mapping-refresh" type="button" variant="outline" size="sm" onClick={loadPreview} disabled={loading}>
            {t('integrations.entra.tenantMapping.actions.refresh')}
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {confirmFeedback ? <p className="text-sm text-muted-foreground">{confirmFeedback}</p> : null}

      <div className="overflow-x-auto rounded-lg border border-border/70">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/30 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">{t('integrations.entra.tenantMapping.columns.entraTenant')}</th>
              <th className="px-3 py-2 font-medium">{t('integrations.entra.tenantMapping.columns.primaryDomain')}</th>
              <th className="px-3 py-2 font-medium">{t('integrations.entra.tenantMapping.columns.status')}</th>
              <th className="px-3 py-2 font-medium">{t('integrations.entra.tenantMapping.columns.suggestedClient')}</th>
              <th className="px-3 py-2 font-medium">{t('integrations.entra.tenantMapping.columns.confidence')}</th>
              <th className="px-3 py-2 font-medium">{t('integrations.entra.tenantMapping.columns.selectClient')}</th>
              <th className="px-3 py-2 font-medium">{t('integrations.entra.tenantMapping.columns.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const topCandidate = row.candidates[0];
              return (
                <tr key={row.managedTenantId} className="border-t border-border/60">
                  <td className="px-3 py-2">
                    <p className="font-medium">{row.displayName || row.entraTenantId}</p>
                    <p className="text-xs text-muted-foreground">{row.entraTenantId}</p>
                  </td>
                  <td className="px-3 py-2">{row.primaryDomain || '—'}</td>
                  <td className="px-3 py-2">
                    {row.isSkipped ? (
                      <Badge variant="outline">{t('integrations.entra.tenantMapping.states.skipped')}</Badge>
                    ) : row.state === 'auto_matched' ? (
                      <Badge variant="secondary">{t('integrations.entra.tenantMapping.states.autoMatched')}</Badge>
                    ) : row.state === 'imported' ? (
                      <Badge variant="secondary">{t('integrations.entra.tenantMapping.states.imported')}</Badge>
                    ) : row.state === 'needs_review' ? (
                      <Badge variant="outline">{t('integrations.entra.tenantMapping.states.needsReview')}</Badge>
                    ) : (
                      <Badge variant="outline">{t('integrations.entra.tenantMapping.states.unmatched')}</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {topCandidate ? (
                      <div>
                        <p>{topCandidate.clientName || t('integrations.entra.tenantMapping.picker.unknownClient')}</p>
                        <p className="text-xs text-muted-foreground">{reasonLabel(topCandidate.reason)}</p>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">{t('integrations.entra.tenantMapping.noSuggestion')}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {topCandidate ? formatConfidence(topCandidate.confidenceScore) : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <div className={loading || row.isSkipped ? 'opacity-50 pointer-events-none' : ''}>
                      <ClientPicker
                        id={`entra-client-picker-${row.managedTenantId}`}
                        clients={allClients}
                        selectedClientId={row.selectedClientId}
                        onSelect={(val) => updateSelection(row.managedTenantId, val || '')}
                        filterState="active"
                        onFilterStateChange={() => { }}
                        clientTypeFilter="all"
                        onClientTypeFilterChange={() => { }}
                        triggerButtonClassName="h-9 w-full bg-background font-normal"
                        placeholder={t('integrations.entra.tenantMapping.picker.placeholder')}
                        modal={true}
                        fitContent={false}
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {row.state !== 'auto_matched' && row.state !== 'imported' ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          id={`entra-import-row-${row.managedTenantId}`}
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void handleImportAsClient(row)}
                          disabled={loading || row.isSkipped || Boolean(importingByRow[row.managedTenantId])}
                        >
                          {importingByRow[row.managedTenantId]
                            ? t('integrations.entra.tenantMapping.actions.importing')
                            : t('integrations.entra.tenantMapping.actions.import')}
                        </Button>
                        <Button
                          id={`entra-skip-row-${row.managedTenantId}`}
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void handleSkip(row)}
                          disabled={loading || row.isSkipped || Boolean(skippingByRow[row.managedTenantId])}
                        >
                          {row.isSkipped
                            ? t('integrations.entra.tenantMapping.actions.skipped')
                            : t('integrations.entra.tenantMapping.actions.skip')}
                        </Button>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}

            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                  {t('integrations.entra.tenantMapping.empty')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
