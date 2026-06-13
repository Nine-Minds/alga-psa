'use client';

/**
 * Client Hudu tab — Assets mapping manager (F223–F227, EE-only).
 *
 * Clone of HuduCompanyMappingManager's staged Save/Discard semantics, keyed by
 * Hudu asset id: pickers stage, suggestions are confirmed by Save, replace is
 * explicit clear+set. Adds per-row / bulk Import (asset create RBAC) and
 * "Sync from Hudu" (asset update RBAC); affordances hide without permission.
 */

import React, { useEffect, useState, useTransition } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import {
  Download,
  ExternalLink,
  HardDrive,
  Link2,
  Link2Off,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
  X,
} from 'lucide-react';
import { useToast } from '@alga-psa/ui/hooks/use-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { checkCurrentUserPermissions } from '@alga-psa/auth/actions';
import { listAssets } from '@alga-psa/assets/actions/assetActions';
import {
  clearHuduAssetMapping,
  getHuduAssetMappings,
  setHuduAssetMapping,
} from '../../../lib/actions/integrations/huduAssetMappingActions';
import type {
  HuduAssetMappingActionResult,
  HuduAssetMappingView,
} from '../../../lib/actions/integrations/huduAssetMappingActions';
import {
  importAllUnmatchedHuduAssets,
  importHuduAsset,
} from '../../../lib/actions/integrations/huduAssetImportActions';
import type {
  HuduAssetBulkImportResult,
  HuduAssetBulkImportSummary,
  HuduAssetImportFailure,
  HuduAssetImportResult,
} from '../../../lib/actions/integrations/huduAssetImportActions';
import { syncHuduClientAssets } from '../../../lib/actions/integrations/huduAssetSyncActions';
import type { HuduAssetSuggestionSource } from '../../../lib/integrations/hudu/assetMatching';

export interface HuduAssetMappingManagerProps {
  clientId: string;
}

interface AssetOption {
  asset_id: string;
  name: string;
}

interface SyncSummary {
  updated: number;
  unchanged: number;
  stale: number;
  rmmSkipped: number;
  syncedAt: string;
}

type RowStatus = 'mapped' | 'suggested' | 'unmapped';

// Explicit type guard: the EE tsconfig is non-strict, where `!result.success`
// alone does not narrow the discriminated union.
function isMappingFailure<T>(
  result: HuduAssetMappingActionResult<T>
): result is Extract<HuduAssetMappingActionResult<T>, { success: false }> {
  return !result.success;
}

function isImportFailure(result: HuduAssetImportResult): result is HuduAssetImportFailure {
  return !result.success;
}

function isBulkImportFailure(
  result: HuduAssetBulkImportResult
): result is Extract<HuduAssetBulkImportResult, { success: false }> {
  return !result.success;
}

function rowStatus(row: HuduAssetMappingView): RowStatus {
  if (row.mapping) return 'mapped';
  if (row.suggestion) return 'suggested';
  return 'unmapped';
}

const HuduAssetMappingManager: React.FC<HuduAssetMappingManagerProps> = ({ clientId }) => {
  const { t } = useTranslation('msp/integrations');
  const { toast } = useToast();

  const [rows, setRows] = useState<HuduAssetMappingView[]>([]);
  const [assetOptions, setAssetOptions] = useState<AssetOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUnmapped, setIsUnmapped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [canCreateAssets, setCanCreateAssets] = useState(false);
  const [canUpdateAssets, setCanUpdateAssets] = useState(false);
  const [isSyncing, startSyncTransition] = useTransition();
  const [isSaving, setIsSaving] = useState(false);
  const [isImportingAll, setIsImportingAll] = useState(false);
  const [importingRowId, setImportingRowId] = useState<number | null>(null);
  const [syncSummary, setSyncSummary] = useState<SyncSummary | null>(null);
  const [bulkSummary, setBulkSummary] = useState<HuduAssetBulkImportSummary | null>(null);
  // Staged picks awaiting explicit Save, keyed by Hudu asset id (null = staged unmap).
  const [pendingSelections, setPendingSelections] = useState<Map<number, string | null>>(new Map());

  const isBusy = isSaving || isSyncing || isImportingAll || importingRowId !== null;

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [mappingsResult, assetsResponse] = await Promise.all([
        getHuduAssetMappings(clientId),
        listAssets({ client_id: clientId, limit: 1000 }),
      ]);
      if (mappingsResult.state === 'unmapped') {
        setIsUnmapped(true);
        setRows([]);
      } else if (mappingsResult.state === 'error') {
        setError(
          mappingsResult.error ||
            t('integrations.hudu.assets.errors.load', {
              defaultValue: 'Failed to load Hudu asset mappings.',
            })
        );
        setRows([]);
      } else {
        setIsUnmapped(false);
        setRows(mappingsResult.assets);
      }
      setAssetOptions(
        assetsResponse.assets.map((asset) => ({ asset_id: asset.asset_id, name: asset.name }))
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('integrations.hudu.assets.errors.load', {
              defaultValue: 'Failed to load Hudu asset mappings.',
            })
      );
    } finally {
      setIsLoading(false);
    }
  };

  const loadPermissions = async () => {
    const results = await checkCurrentUserPermissions([
      { resource: 'asset', action: 'create' },
      { resource: 'asset', action: 'update' },
    ]);
    setCanCreateAssets(results.find((r) => r.action === 'create')?.granted === true);
    setCanUpdateAssets(results.find((r) => r.action === 'update')?.granted === true);
  };

  useEffect(() => {
    void loadData();
    void loadPermissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const mappingErrorMessage = (result: { error: string; code?: string }): string => {
    switch (result.code) {
      case 'asset_already_mapped':
        return t('integrations.hudu.assets.errors.assetAlreadyMapped', {
          defaultValue: 'That asset is already mapped to another Hudu asset. Clear the existing mapping first.',
        });
      case 'hudu_asset_already_mapped':
        return t('integrations.hudu.assets.errors.huduAssetAlreadyMapped', {
          defaultValue: 'This Hudu asset is already mapped to an asset. Clear the existing mapping first.',
        });
      case 'mapping_conflict':
        return t('integrations.hudu.assets.errors.mappingConflict', {
          defaultValue: 'This mapping conflicts with an existing one. Refresh and try again.',
        });
      case 'not_found':
        return t('integrations.hudu.assets.errors.notFound', {
          defaultValue: 'Mapping not found. Refresh and try again.',
        });
      default:
        return (
          result.error ||
          t('integrations.hudu.assets.errors.save', { defaultValue: 'Failed to update the asset mapping.' })
        );
    }
  };

  // F262: serial conflicts name the existing asset; other codes fall back to
  // the server message.
  const importErrorMessage = (failure: { error: string; code?: string; existing_asset_name?: string }): string => {
    if (failure.code === 'serial_conflict') {
      return t('integrations.hudu.assets.errors.serialConflict', {
        defaultValue: 'Serial number already in use by "{{name}}".',
        name: failure.existing_asset_name ?? '',
      });
    }
    return (
      failure.error ||
      t('integrations.hudu.assets.errors.import', { defaultValue: 'Failed to import the Hudu asset.' })
    );
  };

  const reportMappingFailure = (result: { error: string; code?: string }) => {
    const message = mappingErrorMessage(result);
    setError(message);
    toast({
      title: t('integrations.hudu.assets.toasts.errorTitle', { defaultValue: 'Hudu asset mapping error' }),
      description: message,
      variant: 'destructive',
    });
  };

  const updateRow = (huduAssetId: number, mapping: HuduAssetMappingView['mapping']) => {
    setRows((prev) => prev.map((row) => (row.hudu_asset_id === huduAssetId ? { ...row, mapping } : row)));
  };

  // Persisted state vs. what the row's picker shows: a suggestion pre-fills the
  // picker but is only persisted once the user confirms with Save.
  const baselineSelection = (row: HuduAssetMappingView): string | null => row.mapping?.asset_id ?? null;
  const defaultSelection = (row: HuduAssetMappingView): string | null =>
    row.mapping?.asset_id ?? row.suggestion?.asset_id ?? null;
  const effectiveSelection = (row: HuduAssetMappingView): string | null =>
    pendingSelections.has(row.hudu_asset_id)
      ? pendingSelections.get(row.hudu_asset_id)!
      : defaultSelection(row);
  const isDirty = (row: HuduAssetMappingView): boolean => effectiveSelection(row) !== baselineSelection(row);

  const stageSelection = (row: HuduAssetMappingView, assetId: string | null) => {
    if (isBusy) return;
    setPendingSelections((prev) => {
      const next = new Map(prev);
      if (assetId === defaultSelection(row)) {
        next.delete(row.hudu_asset_id);
      } else {
        next.set(row.hudu_asset_id, assetId);
      }
      return next;
    });
  };

  // One button per row: revert a staged change, stage an unmap of a saved
  // mapping, or dismiss a suggestion (a dismissed suggestion is excluded from Save).
  const handleRowAction = (row: HuduAssetMappingView) => {
    if (isBusy) return;
    if (pendingSelections.has(row.hudu_asset_id)) {
      setPendingSelections((prev) => {
        const next = new Map(prev);
        next.delete(row.hudu_asset_id);
        return next;
      });
    } else if (row.mapping || row.suggestion) {
      stageSelection(row, null);
    }
  };

  const handleDiscard = () => {
    if (isBusy) return;
    setPendingSelections(new Map());
  };

  const handleSaveAll = async () => {
    const dirtyRows = rows.filter(isDirty);
    if (dirtyRows.length === 0 || isBusy) return;

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
            const cleared = await clearHuduAssetMapping({ mappingId: row.mapping.mapping_id });
            if (isMappingFailure(cleared)) {
              firstFailure = firstFailure ?? cleared;
              continue;
            }
            updateRow(row.hudu_asset_id, null);
            if (target === null) {
              remainingPending.delete(row.hudu_asset_id);
              savedCount += 1;
              continue;
            }
          }

          const result = await setHuduAssetMapping({
            clientId,
            assetId: target as string,
            huduAssetId: row.hudu_asset_id,
            metadata: {
              hudu_asset_name: row.hudu_asset_name,
              asset_layout_id: row.asset_layout_id,
              asset_layout_name: row.asset_layout_name,
              primary_serial: row.primary_serial,
              url: row.url,
            },
          });
          if (isMappingFailure(result)) {
            firstFailure = firstFailure ?? result;
            continue;
          }

          const assetName = assetOptions.find((a) => a.asset_id === target)?.name ?? null;
          updateRow(row.hudu_asset_id, {
            mapping_id: result.data.mapping_id,
            asset_id: target as string,
            asset_name: assetName,
            stale: false,
          });
          remainingPending.delete(row.hudu_asset_id);
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
          t('integrations.hudu.assets.success.saved', {
            defaultValue: 'Asset mappings saved: {{total}}',
            total: savedCount,
          })
        );
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleImportRow = async (row: HuduAssetMappingView) => {
    if (isBusy) return;
    setImportingRowId(row.hudu_asset_id);
    setError(null);
    setSuccessMessage(null);
    try {
      const result = await importHuduAsset({ clientId, huduAssetId: row.hudu_asset_id });
      if (isImportFailure(result)) {
        setError(importErrorMessage(result));
        return;
      }
      setAssetOptions((prev) =>
        prev.some((a) => a.asset_id === result.data.asset_id)
          ? prev
          : [...prev, { asset_id: result.data.asset_id, name: row.hudu_asset_name }]
      );
      updateRow(row.hudu_asset_id, {
        mapping_id: result.data.mapping_id,
        asset_id: result.data.asset_id,
        asset_name: row.hudu_asset_name,
        stale: false,
      });
      setPendingSelections((prev) => {
        const next = new Map(prev);
        next.delete(row.hudu_asset_id);
        return next;
      });
      setSuccessMessage(
        t('integrations.hudu.assets.success.imported', {
          defaultValue: 'Imported "{{name}}" from Hudu.',
          name: row.hudu_asset_name,
        })
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('integrations.hudu.assets.errors.import', { defaultValue: 'Failed to import the Hudu asset.' })
      );
    } finally {
      setImportingRowId(null);
    }
  };

  const handleImportAll = async () => {
    if (isBusy) return;
    setIsImportingAll(true);
    setError(null);
    setSuccessMessage(null);
    setBulkSummary(null);
    try {
      const result = await importAllUnmatchedHuduAssets({ clientId });
      // Reload first: loadData clears `error`, and partial imports change rows.
      await loadData();
      if (isBulkImportFailure(result)) {
        setBulkSummary(result.partial);
        setError(
          result.code === 'rate_limited'
            ? t('integrations.hudu.assets.errors.rateLimited', {
                defaultValue: 'Hudu rate limit reached. Try again later.',
              })
            : result.error ||
                t('integrations.hudu.assets.errors.importAll', {
                  defaultValue: 'Bulk import failed.',
                })
        );
      } else {
        setBulkSummary(result.data);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('integrations.hudu.assets.errors.importAll', { defaultValue: 'Bulk import failed.' })
      );
    } finally {
      setIsImportingAll(false);
    }
  };

  const handleSync = () => {
    if (isBusy) return;
    startSyncTransition(async () => {
      setError(null);
      setSuccessMessage(null);
      setSyncSummary(null);
      const result = await syncHuduClientAssets({ clientId });
      if (result.state === 'ok') {
        setSyncSummary(result);
        await loadData();
        return;
      }
      if (result.state === 'unmapped') {
        setError(
          t('integrations.hudu.assets.errors.unmapped', {
            defaultValue: 'This client is not mapped to a Hudu company.',
          })
        );
        return;
      }
      setError(
        result.errorKind === 'rate_limited'
          ? t('integrations.hudu.assets.errors.rateLimited', {
              defaultValue: 'Hudu rate limit reached. Try again later.',
            })
          : result.error ||
              t('integrations.hudu.assets.errors.sync', { defaultValue: 'Failed to sync from Hudu.' })
      );
    });
  };

  const suggestionSourceLabel = (source: HuduAssetSuggestionSource): string => {
    switch (source) {
      case 'serial':
        return t('integrations.hudu.assets.suggestion.source.serial', { defaultValue: 'Serial match' });
      case 'exact_name':
        return t('integrations.hudu.assets.suggestion.source.exactName', { defaultValue: 'Exact name' });
      default:
        return t('integrations.hudu.assets.suggestion.source.fuzzyName', { defaultValue: 'Similar name' });
    }
  };

  const mappedCount = rows.filter((row) => rowStatus(row) === 'mapped').length;
  const suggestedCount = rows.filter((row) => rowStatus(row) === 'suggested').length;
  const unmappedCount = rows.length - mappedCount - suggestedCount;
  const dirtyCount = rows.filter(isDirty).length;
  // Excluded-layout rows never import (F259) — they don't count toward Import all.
  const unmatchedCount = rows.filter((row) => !row.mapping && !row.suggestion && !row.layout_excluded).length;
  const selectOptions = assetOptions.map((asset) => ({ value: asset.asset_id, label: asset.name }));

  if (isUnmapped) {
    return null;
  }

  if (isLoading) {
    return (
      <Card id="hudu-asset-mapping-manager">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            {t('integrations.hudu.assets.title', { defaultValue: 'Assets' })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            {t('integrations.hudu.assets.loading', { defaultValue: 'Loading asset mappings...' })}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card id="hudu-asset-mapping-manager">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="h-5 w-5" />
              {t('integrations.hudu.assets.title', { defaultValue: 'Assets' })}
            </CardTitle>
            <CardDescription>
              {t('integrations.hudu.assets.description', {
                defaultValue: 'Map Hudu assets to AlgaPSA assets, import unmatched ones, and pull updates from Hudu.',
              })}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {canCreateAssets && (
              <Button
                id="hudu-asset-import-all-btn"
                variant="outline"
                size="sm"
                onClick={() => void handleImportAll()}
                disabled={isBusy || unmatchedCount === 0}
              >
                <Download className="mr-2 h-4 w-4" />
                {isImportingAll
                  ? t('integrations.hudu.assets.buttons.importingAll', { defaultValue: 'Importing...' })
                  : t('integrations.hudu.assets.buttons.importAll', { defaultValue: 'Import all unmatched' })}
              </Button>
            )}
            {canUpdateAssets && (
              <Button
                id="hudu-asset-sync-btn"
                variant="outline"
                size="sm"
                onClick={handleSync}
                disabled={isBusy}
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing
                  ? t('integrations.hudu.assets.buttons.syncing', { defaultValue: 'Syncing...' })
                  : t('integrations.hudu.assets.buttons.sync', { defaultValue: 'Sync from Hudu' })}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {successMessage && (
          <Alert id="hudu-asset-mapping-success" variant="success">
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        )}

        {error && (
          <Alert id="hudu-asset-mapping-error" variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {syncSummary && (
          <div
            id="hudu-asset-sync-summary"
            className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
          >
            <span>
              {t('integrations.hudu.assets.sync.summary', {
                defaultValue: 'Sync complete: {{updated}} updated · {{unchanged}} unchanged · {{stale}} stale.',
                updated: syncSummary.updated,
                unchanged: syncSummary.unchanged,
                stale: syncSummary.stale,
              })}
            </span>{' '}
            {syncSummary.rmmSkipped > 0 && (
              <span id="hudu-asset-sync-rmm-skipped">
                {t('integrations.hudu.assets.sync.rmmSkipped', {
                  defaultValue: '{{rmmSkipped}} RMM-managed skipped.',
                  rmmSkipped: syncSummary.rmmSkipped,
                })}{' '}
              </span>
            )}
            <span>
              {t('integrations.hudu.assets.sync.lastSynced', {
                defaultValue: 'Last synced: {{timestamp}}',
                timestamp: new Date(syncSummary.syncedAt).toLocaleString(),
              })}
            </span>
          </div>
        )}

        {bulkSummary && (
          <div
            id="hudu-asset-import-summary"
            className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
          >
            <span>
              {t('integrations.hudu.assets.import.summary', {
                defaultValue: 'Import finished: {{created}} created · {{skipped}} skipped · {{failed}} failed.',
                created: bulkSummary.created,
                skipped: bulkSummary.skipped,
                failed: bulkSummary.failed.length,
              })}
            </span>
            {bulkSummary.failed.length > 0 && (
              <ul className="mt-1 list-disc pl-4 text-xs">
                {bulkSummary.failed.map((failure) => (
                  <li key={failure.huduAssetId} id={`hudu-asset-import-failure-${failure.huduAssetId}`}>
                    {rows.find((row) => row.hudu_asset_id === failure.huduAssetId)?.hudu_asset_name ??
                      failure.huduAssetId}
                    {': '}
                    {importErrorMessage(failure)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Summary */}
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <span id="hudu-asset-count-mapped" className="flex items-center gap-1">
            <Link2 className="h-4 w-4 text-green-500" />
            {mappedCount} {t('integrations.hudu.assets.counters.mapped', { defaultValue: 'mapped' })}
          </span>
          <span id="hudu-asset-count-suggested" className="flex items-center gap-1">
            <Sparkles className="h-4 w-4 text-blue-500" />
            {suggestedCount} {t('integrations.hudu.assets.counters.suggested', { defaultValue: 'suggested' })}
          </span>
          <span id="hudu-asset-count-unmapped" className="flex items-center gap-1">
            <Link2Off className="h-4 w-4 text-amber-500" />
            {unmappedCount} {t('integrations.hudu.assets.counters.unmapped', { defaultValue: 'unmapped' })}
          </span>
          <span id="hudu-asset-count-total" className="flex items-center gap-1">
            {rows.length} {t('integrations.hudu.assets.counters.total', { defaultValue: 'total' })}
          </span>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <HardDrive className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <p className="mt-2 text-sm text-muted-foreground">
              {t('integrations.hudu.assets.empty', { defaultValue: 'No Hudu assets for this company.' })}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left text-sm font-medium">
                    {t('integrations.hudu.assets.table.huduAsset', { defaultValue: 'Hudu Asset' })}
                  </th>
                  <th className="px-4 py-3 text-left text-sm font-medium">
                    {t('integrations.hudu.assets.table.algaAsset', { defaultValue: 'AlgaPSA Asset' })}
                  </th>
                  <th className="px-4 py-3 text-center text-sm font-medium w-32">
                    {t('integrations.hudu.assets.table.status', { defaultValue: 'Status' })}
                  </th>
                  {canCreateAssets && (
                    <th className="px-4 py-3 text-center text-sm font-medium w-28">
                      {t('integrations.hudu.assets.table.actions', { defaultValue: 'Actions' })}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const hasPendingEntry = pendingSelections.has(row.hudu_asset_id);
                  const selectedAssetId = effectiveSelection(row);
                  // A pending entry that isn't dirty is a dismissed suggestion → Unmapped.
                  const status: RowStatus | 'pending' = hasPendingEntry
                    ? isDirty(row)
                      ? 'pending'
                      : 'unmapped'
                    : rowStatus(row);
                  const importable = !row.mapping && selectedAssetId === null && !row.layout_excluded;
                  const meta = [
                    row.asset_layout_name,
                    row.primary_serial
                      ? `${t('integrations.hudu.assets.serial', { defaultValue: 'Serial' })}: ${row.primary_serial}`
                      : null,
                    row.archived
                      ? t('integrations.hudu.assets.archivedLabel', { defaultValue: 'Archived' })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <tr key={row.hudu_asset_id} className="border-b last:border-b-0 hover:bg-muted/30">
                      <td className="px-4 py-3">
                        {row.url ? (
                          <a
                            id={`hudu-asset-link-${row.hudu_asset_id}`}
                            href={row.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-medium text-[rgb(var(--color-primary-600))] hover:underline"
                          >
                            {row.hudu_asset_name}
                            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                          </a>
                        ) : (
                          <span id={`hudu-asset-link-${row.hudu_asset_id}`} className="font-medium">
                            {row.hudu_asset_name}
                          </span>
                        )}
                        {meta && <div className="text-xs text-muted-foreground">{meta}</div>}
                        {row.layout_excluded && (
                          <div
                            id={`hudu-asset-excluded-${row.hudu_asset_id}`}
                            className="text-xs text-muted-foreground"
                          >
                            {t('integrations.hudu.assets.excludedHint', {
                              defaultValue: 'Not imported (layout excluded)',
                            })}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className={`flex items-center gap-1 ${isBusy ? 'pointer-events-none opacity-60' : ''}`}>
                          <CustomSelect
                            id={`hudu-asset-picker-${row.hudu_asset_id}`}
                            options={selectOptions}
                            value={selectedAssetId}
                            onValueChange={(value) => stageSelection(row, value === '' ? null : value)}
                            placeholder={t('integrations.hudu.assets.selectAsset', {
                              defaultValue: 'Select asset',
                            })}
                            disabled={isBusy || !canUpdateAssets}
                            allowClear={true}
                            className="w-full"
                          />
                          {canUpdateAssets && (hasPendingEntry || row.mapping || row.suggestion) && (
                            <Button
                              id={`hudu-asset-row-action-${row.hudu_asset_id}`}
                              variant="ghost"
                              size="sm"
                              disabled={isBusy}
                              title={
                                hasPendingEntry
                                  ? t('integrations.hudu.assets.rowActions.revert', {
                                      defaultValue: 'Revert change',
                                    })
                                  : row.mapping
                                    ? t('integrations.hudu.assets.rowActions.unmap', { defaultValue: 'Unmap' })
                                    : t('integrations.hudu.assets.rowActions.dismiss', {
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
                            id={`hudu-asset-suggestion-${row.hudu_asset_id}`}
                            className="mt-1 text-xs text-muted-foreground"
                          >
                            {t('integrations.hudu.assets.suggestion.label', { defaultValue: 'Suggested' })}:{' '}
                            {suggestionSourceLabel(row.suggestion.source)} (
                            {Math.round(row.suggestion.confidence * 100)}%)
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {status === 'pending' ? (
                            <Badge id={`hudu-asset-status-${row.hudu_asset_id}`} variant="secondary">
                              {t('integrations.hudu.assets.status.pending', { defaultValue: 'Pending' })}
                            </Badge>
                          ) : status === 'mapped' ? (
                            <Badge id={`hudu-asset-status-${row.hudu_asset_id}`} variant="success">
                              {t('integrations.hudu.assets.status.mapped', { defaultValue: 'Mapped' })}
                            </Badge>
                          ) : status === 'suggested' ? (
                            <Badge id={`hudu-asset-status-${row.hudu_asset_id}`} variant="primary">
                              {t('integrations.hudu.assets.status.suggested', { defaultValue: 'Suggested' })}
                            </Badge>
                          ) : (
                            <Badge id={`hudu-asset-status-${row.hudu_asset_id}`} variant="warning">
                              {t('integrations.hudu.assets.status.unmapped', { defaultValue: 'Unmapped' })}
                            </Badge>
                          )}
                          {row.mapping?.stale && (
                            <Badge id={`hudu-asset-stale-${row.hudu_asset_id}`} variant="error">
                              {t('integrations.hudu.assets.status.stale', { defaultValue: 'Stale' })}
                            </Badge>
                          )}
                        </div>
                      </td>
                      {canCreateAssets && (
                        <td className="px-4 py-3 text-center">
                          {importable && (
                            <Button
                              id={`hudu-asset-import-${row.hudu_asset_id}`}
                              variant="outline"
                              size="sm"
                              disabled={isBusy}
                              onClick={() => void handleImportRow(row)}
                            >
                              <Download className="mr-2 h-4 w-4" />
                              {importingRowId === row.hudu_asset_id
                                ? t('integrations.hudu.assets.buttons.importing', { defaultValue: 'Importing...' })
                                : t('integrations.hudu.assets.buttons.import', { defaultValue: 'Import' })}
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {canUpdateAssets && dirtyCount > 0 && (
          <div id="hudu-asset-mapping-save-bar" className="flex items-center justify-end gap-3 border-t pt-4">
            <span className="text-sm text-muted-foreground">
              {t('integrations.hudu.assets.pendingSummary', {
                defaultValue: 'Unsaved changes: {{total}}',
                total: dirtyCount,
              })}
            </span>
            {pendingSelections.size > 0 && (
              <Button
                id="hudu-asset-mapping-discard-btn"
                variant="outline"
                size="sm"
                onClick={handleDiscard}
                disabled={isBusy}
              >
                {t('integrations.hudu.assets.buttons.discard', { defaultValue: 'Discard' })}
              </Button>
            )}
            <Button
              id="hudu-asset-mapping-save-btn"
              size="sm"
              onClick={() => void handleSaveAll()}
              disabled={isBusy}
            >
              {isSaving ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  {t('integrations.hudu.assets.buttons.saving', { defaultValue: 'Saving...' })}
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  {t('integrations.hudu.assets.buttons.save', { defaultValue: 'Save mappings' })}
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default HuduAssetMappingManager;
