'use client';

import React, { useEffect, useState, useTransition } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { Building2, Link2, Link2Off, RefreshCw, Sparkles } from 'lucide-react';
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
  const [savingCompanyId, setSavingCompanyId] = useState<number | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [mappingsResult, clientsResult] = await Promise.all([
        getHuduCompanyMappings(),
        getAllClients(false), // Only active clients
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

  const handleSelect = async (row: HuduCompanyMappingView, clientId: string | null) => {
    if (savingCompanyId !== null) return;
    const currentClientId = row.mapping?.client_id ?? null;
    if (clientId === currentClientId) return;
    // Clearing an unmapped row's suggested pre-fill persists nothing.
    if (clientId === null && !row.mapping) return;

    setSavingCompanyId(row.hudu_company_id);
    setError(null);
    setSuccessMessage(null);
    try {
      if (row.mapping) {
        // Replace is explicit clear+set: the server rejects overwrites.
        const cleared = await clearHuduCompanyMapping({ mappingId: row.mapping.mapping_id });
        if (isMappingFailure(cleared)) {
          reportMappingFailure(cleared);
          return;
        }
        updateRow(row.hudu_company_id, null);
        if (clientId === null) return;
      }

      const result = await setHuduCompanyMapping({
        clientId: clientId as string,
        huduCompanyId: row.hudu_company_id,
        metadata: {
          hudu_company_name: row.hudu_company_name,
          id_in_integration: row.id_in_integration,
          url: row.url,
        },
      });
      if (isMappingFailure(result)) {
        reportMappingFailure(result);
        return;
      }

      const clientName = clients.find((c) => c.client_id === clientId)?.client_name ?? null;
      updateRow(row.hudu_company_id, {
        mapping_id: result.data.mapping_id,
        client_id: clientId as string,
        client_name: clientName,
      });
    } catch (err) {
      reportMappingFailure({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSavingCompanyId(null);
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
                  const status = rowStatus(row);
                  const isSaving = savingCompanyId === row.hudu_company_id;
                  const selectedClientId = row.mapping?.client_id ?? row.suggestion?.client_id ?? null;
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
                        <div className={isSaving ? 'pointer-events-none opacity-60' : undefined}>
                          <ClientPicker
                            id={`hudu-client-picker-${row.hudu_company_id}`}
                            clients={clients}
                            selectedClientId={selectedClientId}
                            onSelect={(clientId) => {
                              if (isSaving) return;
                              void handleSelect(row, clientId);
                            }}
                            filterState="active"
                            onFilterStateChange={() => {}}
                            clientTypeFilter="all"
                            onClientTypeFilterChange={() => {}}
                            placeholder={t('integrations.hudu.mapping.selectClient', {
                              defaultValue: 'Select client',
                            })}
                            fitContent={true}
                            className="w-full"
                          />
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
                        {status === 'mapped' ? (
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
      </CardContent>
    </Card>
  );
};

export default HuduCompanyMappingManager;
