'use client';

import React, { useEffect, useState, useTransition } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { Building2, Link2, Link2Off, RefreshCw, RotateCcw, Save, Sparkles, X } from 'lucide-react';
import { useToast } from '@alga-psa/ui/hooks/use-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getAllClients } from '@alga-psa/clients/actions';
import type { IClient } from '@alga-psa/types';
import {
  clearHuduCompanyMapping,
  getHuduCompanyMappings,
  setHuduCompanyMapping,
  syncHuduCompanies,
} from '../../../../lib/actions/integrations/huduMappingActions';
import type {
  HuduCompanyMappingView,
  HuduMappingActionResult,
} from '../../../../lib/actions/integrations/huduMappingActions';
import type { HuduSuggestionSource } from '../../../../lib/integrations/hudu/companyMapping';

type RowStatus = 'mapped' | 'suggested' | 'unmapped';

// Explicit type guard: the EE tsconfig is non-strict, where `!result.success`
// alone does not narrow the discriminated union.
function isMappingFailure<T>(
  result: HuduMappingActionResult<T>
): result is Extract<HuduMappingActionResult<T>, { success: false }> {
  return !result.success;
}

function rowStatus(row: HuduCompanyMappingView): RowStatus {
  if (row.mapping) return 'mapped';
  if (row.suggestion) return 'suggested';
  return 'unmapped';
}

const HuduCompanyMappingManager: React.FC = () => {
  const { t } = useTranslation('msp/integrations');
  const { toast } = useToast();

  const [rows, setRows] = useState<HuduCompanyMappingView[]>([]);
  const [clients, setClients] = useState<IClient[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSyncing, startSyncTransition] = useTransition();
  const [isSaving, setIsSaving] = useState(false);
  // Staged picks awaiting explicit Save, keyed by Hudu company id (null = staged unmap).
  const [pendingSelections, setPendingSelections] = useState<Map<number, string | null>>(new Map());
  const [clientFilterState, setClientFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [mappingsResult, clientsResult] = await Promise.all([
        getHuduCompanyMappings(),
        getAllClients(true), // All clients; the picker's state filter defaults to active
      ]);
      if (isMappingFailure(mappingsResult)) {
        setError(
          mappingsResult.error ||
            t('integrations.hudu.mapping.errors.load', {
              defaultValue: 'Failed to load Hudu company mappings.',
            })
        );
        setRows([]);
      } else {
        setRows(mappingsResult.data.companies);
      }
      setClients(clientsResult);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('integrations.hudu.mapping.errors.load', {
              defaultValue: 'Failed to load Hudu company mappings.',
            })
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mappingErrorMessage = (result: { error: string; code?: string }): string => {
    switch (result.code) {
      case 'client_already_mapped':
        return t('integrations.hudu.mapping.errors.clientAlreadyMapped', {
          defaultValue: 'That client is already mapped to another Hudu company. Clear the existing mapping first.',
        });
      case 'company_already_mapped':
        return t('integrations.hudu.mapping.errors.companyAlreadyMapped', {
          defaultValue: 'This Hudu company is already mapped to another client. Clear the existing mapping first.',
        });
      case 'mapping_conflict':
        return t('integrations.hudu.mapping.errors.mappingConflict', {
          defaultValue: 'This mapping conflicts with an existing one. Refresh and try again.',
        });
      case 'not_found':
        return t('integrations.hudu.mapping.errors.notFound', {
          defaultValue: 'Mapping not found. Refresh and try again.',
        });
      default:
        return (
          result.error ||
          t('integrations.hudu.mapping.errors.save', { defaultValue: 'Failed to update the mapping.' })
        );
    }
  };

  const reportMappingFailure = (result: { error: string; code?: string }) => {
    const message = mappingErrorMessage(result);
    setError(message);
    toast({
      title: t('integrations.hudu.mapping.toasts.errorTitle', { defaultValue: 'Hudu mapping error' }),
      description: message,
      variant: 'destructive',
    });
  };

  const updateRow = (huduCompanyId: number, mapping: HuduCompanyMappingView['mapping']) => {
    setRows((prev) =>
      prev.map((row) => (row.hudu_company_id === huduCompanyId ? { ...row, mapping } : row))
    );
  };

  const handleRefresh = () => {
    startSyncTransition(async () => {
      setError(null);
      setSuccessMessage(null);
      const result = await syncHuduCompanies();
      if (isMappingFailure(result)) {
        setError(
          result.error ||
            t('integrations.hudu.mapping.errors.refresh', {
              defaultValue: 'Failed to refresh Hudu companies.',
            })
        );
        return;
      }
      setSuccessMessage(
        t('integrations.hudu.mapping.success.refreshed', { defaultValue: 'Hudu companies refreshed.' })
      );
      await loadData();
    });
  };

  // Persisted state vs. what the row's picker shows: a suggestion pre-fills the
  // picker but is only persisted once the user confirms with Save.
  const baselineSelection = (row: HuduCompanyMappingView): string | null => row.mapping?.client_id ?? null;
  const defaultSelection = (row: HuduCompanyMappingView): string | null =>
    row.mapping?.client_id ?? row.suggestion?.client_id ?? null;
  const effectiveSelection = (row: HuduCompanyMappingView): string | null =>
    pendingSelections.has(row.hudu_company_id)
      ? pendingSelections.get(row.hudu_company_id)!
      : defaultSelection(row);
  const isDirty = (row: HuduCompanyMappingView): boolean =>
    effectiveSelection(row) !== baselineSelection(row);

  const stageSelection = (row: HuduCompanyMappingView, clientId: string | null) => {
    if (isSaving) return;
    setPendingSelections((prev) => {
      const next = new Map(prev);
      if (clientId === defaultSelection(row)) {
        next.delete(row.hudu_company_id);
      } else {
        next.set(row.hudu_company_id, clientId);
      }
      return next;
    });
  };

  // One button per row: revert a staged change, stage an unmap of a saved
  // mapping, or dismiss a suggestion (a dismissed suggestion is excluded from Save).
  const handleRowAction = (row: HuduCompanyMappingView) => {
    if (isSaving) return;
    if (pendingSelections.has(row.hudu_company_id)) {
      setPendingSelections((prev) => {
        const next = new Map(prev);
        next.delete(row.hudu_company_id);
        return next;
      });
    } else if (row.mapping || row.suggestion) {
      stageSelection(row, null);
    }
  };

  const handleDiscard = () => {
    if (isSaving) return;
    setPendingSelections(new Map());
  };

  const handleSaveAll = async () => {
    const dirtyRows = rows.filter(isDirty);
    if (dirtyRows.length === 0 || isSaving) return;

    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);
    let savedCount = 0;
    let firstFailure: { error: string; code?: string } | null = null;
    const remainingPending = new Map(pendingSelections);

    try {
      for (const row of dirtyRows) {
        const target = effectiveSelection(row);
        try {
          if (row.mapping) {
            // Replace is explicit clear+set: the server rejects overwrites.
            const cleared = await clearHuduCompanyMapping({ mappingId: row.mapping.mapping_id });
            if (isMappingFailure(cleared)) {
              firstFailure = firstFailure ?? cleared;
              continue;
            }
            updateRow(row.hudu_company_id, null);
            if (target === null) {
              remainingPending.delete(row.hudu_company_id);
              savedCount += 1;
              continue;
            }
          }

          const result = await setHuduCompanyMapping({
            clientId: target as string,
            huduCompanyId: row.hudu_company_id,
            metadata: {
              hudu_company_name: row.hudu_company_name,
              id_in_integration: row.id_in_integration,
              url: row.url,
            },
          });
          if (isMappingFailure(result)) {
            firstFailure = firstFailure ?? result;
            continue;
          }

          const clientName = clients.find((c) => c.client_id === target)?.client_name ?? null;
          updateRow(row.hudu_company_id, {
            mapping_id: result.data.mapping_id,
            client_id: target as string,
            client_name: clientName,
          });
          remainingPending.delete(row.hudu_company_id);
          savedCount += 1;
        } catch (err) {
          firstFailure = firstFailure ?? { error: err instanceof Error ? err.message : String(err) };
        }
      }

      setPendingSelections(remainingPending);
      if (firstFailure) {
        reportMappingFailure(firstFailure);
      }
      if (savedCount > 0 && !firstFailure) {
        setSuccessMessage(
          t('integrations.hudu.mapping.success.saved', {
            defaultValue: 'Mappings saved: {{total}}',
            total: savedCount,
          })
        );
      }
    } finally {
      setIsSaving(false);
    }
  };

  const suggestionSourceLabel = (source: HuduSuggestionSource): string => {
    switch (source) {
      case 'integration_id':
        return t('integrations.hudu.mapping.suggestion.source.integrationId', {
          defaultValue: 'PSA integration id',
        });
      case 'exact_name':
        return t('integrations.hudu.mapping.suggestion.source.exactName', { defaultValue: 'Exact name' });
      default:
        return t('integrations.hudu.mapping.suggestion.source.fuzzyName', { defaultValue: 'Similar name' });
    }
  };

  const mappedCount = rows.filter((row) => rowStatus(row) === 'mapped').length;
  const suggestedCount = rows.filter((row) => rowStatus(row) === 'suggested').length;
  const unmappedCount = rows.length - mappedCount - suggestedCount;
  const dirtyCount = rows.filter(isDirty).length;

  if (isLoading) {
    return (
      <Card id="hudu-company-mapping-manager">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            {t('integrations.hudu.mapping.title', { defaultValue: 'Company Mappings' })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            {t('integrations.hudu.mapping.loading', { defaultValue: 'Loading company mappings...' })}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card id="hudu-company-mapping-manager">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              {t('integrations.hudu.mapping.title', { defaultValue: 'Company Mappings' })}
            </CardTitle>
            <CardDescription>
              {t('integrations.hudu.mapping.description', {
                defaultValue: 'Map Hudu companies to AlgaPSA clients to surface their documentation.',
              })}
            </CardDescription>
          </div>
          <Button
            id="hudu-refresh-companies-btn"
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isSyncing}
          >
            {isSyncing ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                {t('integrations.hudu.mapping.buttons.refreshing', { defaultValue: 'Refreshing...' })}
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                {t('integrations.hudu.mapping.buttons.refresh', { defaultValue: 'Refresh Companies' })}
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {successMessage && (
          <Alert id="hudu-mapping-success" variant="success">
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert id="hudu-mapping-error" variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Summary */}
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <span id="hudu-mapping-count-mapped" className="flex items-center gap-1">
            <Link2 className="h-4 w-4 text-green-500" />
            {mappedCount} {t('integrations.hudu.mapping.counters.mapped', { defaultValue: 'mapped' })}
          </span>
          <span id="hudu-mapping-count-suggested" className="flex items-center gap-1">
            <Sparkles className="h-4 w-4 text-blue-500" />
            {suggestedCount} {t('integrations.hudu.mapping.counters.suggested', { defaultValue: 'suggested' })}
          </span>
          <span id="hudu-mapping-count-unmapped" className="flex items-center gap-1">
            <Link2Off className="h-4 w-4 text-amber-500" />
            {unmappedCount} {t('integrations.hudu.mapping.counters.unmapped', { defaultValue: 'unmapped' })}
          </span>
          <span id="hudu-mapping-count-total" className="flex items-center gap-1">
            {rows.length} {t('integrations.hudu.mapping.counters.total', { defaultValue: 'total' })}
          </span>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <Building2 className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <p className="mt-2 text-sm text-muted-foreground">
              {t('integrations.hudu.mapping.empty.title', { defaultValue: 'No Hudu companies loaded yet.' })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('integrations.hudu.mapping.empty.hint', {
                defaultValue: 'Click "Refresh Companies" to fetch companies from Hudu.',
              })}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left text-sm font-medium">
                    {t('integrations.hudu.mapping.table.huduCompany', { defaultValue: 'Hudu Company' })}
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium">
                    {t('integrations.hudu.mapping.table.algaClient', { defaultValue: 'AlgaPSA Client' })}
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-medium w-28">
                    {t('integrations.hudu.mapping.table.status', { defaultValue: 'Status' })}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const hasPendingEntry = pendingSelections.has(row.hudu_company_id);
                  const selectedClientId = effectiveSelection(row);
                  // A pending entry that isn't dirty is a dismissed suggestion → Unmapped.
                  const status: RowStatus | 'pending' = hasPendingEntry
                    ? isDirty(row)
                      ? 'pending'
                      : 'unmapped'
                    : rowStatus(row);
                  return (
                    <tr
                      key={row.hudu_company_id}
                      className="border-b last:border-b-0 hover:bg-muted/30"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium">{row.hudu_company_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {t('integrations.hudu.mapping.companyId', { defaultValue: 'ID' })}: {row.hudu_company_id}
                          {row.id_in_integration ? (
                            <>
                              {' · '}
                              {t('integrations.hudu.mapping.idInIntegration', { defaultValue: 'PSA id' })}:{' '}
                              {row.id_in_integration}
                            </>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className={`flex items-center gap-1 ${isSaving ? 'pointer-events-none opacity-60' : ''}`}>
                          <ClientPicker
                            id={`hudu-client-picker-${row.hudu_company_id}`}
                            clients={clients}
                            selectedClientId={selectedClientId}
                            onSelect={(clientId) => stageSelection(row, clientId)}
                            filterState={clientFilterState}
                            onFilterStateChange={setClientFilterState}
                            clientTypeFilter={clientTypeFilter}
                            onClientTypeFilterChange={setClientTypeFilter}
                            placeholder={t('integrations.hudu.mapping.selectClient', {
                              defaultValue: 'Select client',
                            })}
                            fitContent={true}
                            className="w-full"
                          />
                          {(hasPendingEntry || row.mapping || row.suggestion) && (
                            <Button
                              id={`hudu-mapping-row-action-${row.hudu_company_id}`}
                              variant="ghost"
                              size="sm"
                              disabled={isSaving}
                              title={
                                hasPendingEntry
                                  ? t('integrations.hudu.mapping.rowActions.revert', {
                                      defaultValue: 'Revert change',
                                    })
                                  : row.mapping
                                    ? t('integrations.hudu.mapping.rowActions.unmap', { defaultValue: 'Unmap' })
                                    : t('integrations.hudu.mapping.rowActions.dismiss', {
                                        defaultValue: 'Dismiss suggestion',
                                      })
                              }
                              onClick={() => handleRowAction(row)}
                            >
                              {hasPendingEntry ? (
                                <RotateCcw className="h-4 w-4" />
                              ) : row.mapping ? (
                                <Link2Off className="h-4 w-4" />
                              ) : (
                                <X className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                        </div>
                        {status === 'suggested' && row.suggestion && (
                          <div
                            id={`hudu-mapping-suggestion-${row.hudu_company_id}`}
                            className="mt-1 text-xs text-muted-foreground"
                          >
                            {t('integrations.hudu.mapping.suggestion.label', { defaultValue: 'Suggested' })}:{' '}
                            {suggestionSourceLabel(row.suggestion.source)} (
                            {Math.round(row.suggestion.confidence * 100)}%)
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {status === 'pending' ? (
                          <Badge id={`hudu-mapping-status-${row.hudu_company_id}`} variant="secondary">
                            {t('integrations.hudu.mapping.status.pending', { defaultValue: 'Pending' })}
                          </Badge>
                        ) : status === 'mapped' ? (
                          <Badge id={`hudu-mapping-status-${row.hudu_company_id}`} variant="success">
                            {t('integrations.hudu.mapping.status.mapped', { defaultValue: 'Mapped' })}
                          </Badge>
                        ) : status === 'suggested' ? (
                          <Badge id={`hudu-mapping-status-${row.hudu_company_id}`} variant="primary">
                            {t('integrations.hudu.mapping.status.suggested', { defaultValue: 'Suggested' })}
                          </Badge>
                        ) : (
                          <Badge id={`hudu-mapping-status-${row.hudu_company_id}`} variant="warning">
                            {t('integrations.hudu.mapping.status.unmapped', { defaultValue: 'Unmapped' })}
                          </Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {unmappedCount + suggestedCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {t('integrations.hudu.mapping.unmappedHint', {
              defaultValue:
                'Documentation is only surfaced for mapped clients. Map each Hudu company to an AlgaPSA client to enable it.',
            })}
          </p>
        )}

        {dirtyCount > 0 && (
          <div id="hudu-mapping-save-bar" className="flex items-center justify-end gap-3 border-t pt-4">
            <span className="text-sm text-muted-foreground">
              {t('integrations.hudu.mapping.pendingSummary', {
                defaultValue: 'Unsaved changes: {{total}}',
                total: dirtyCount,
              })}
            </span>
            {pendingSelections.size > 0 && (
              <Button
                id="hudu-mapping-discard-btn"
                variant="outline"
                size="sm"
                onClick={handleDiscard}
                disabled={isSaving}
              >
                {t('integrations.hudu.mapping.buttons.discard', { defaultValue: 'Discard' })}
              </Button>
            )}
            <Button id="hudu-mapping-save-btn" size="sm" onClick={() => void handleSaveAll()} disabled={isSaving}>
              {isSaving ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  {t('integrations.hudu.mapping.buttons.saving', { defaultValue: 'Saving...' })}
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  {t('integrations.hudu.mapping.buttons.save', { defaultValue: 'Save mappings' })}
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default HuduCompanyMappingManager;
