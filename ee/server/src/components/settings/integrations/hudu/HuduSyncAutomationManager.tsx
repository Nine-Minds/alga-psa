'use client';

import React, { useCallback, useEffect, useState, useTransition } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Switch } from '@alga-psa/ui/components/Switch';
import { DownloadCloud, RefreshCw } from 'lucide-react';
import { useToast } from '@alga-psa/ui/hooks/use-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getHuduConnectionStatus } from '../../../../lib/actions/integrations/huduActions';
import type { HuduConnectionStatusData } from '../../../../lib/actions/integrations/huduActions';
import {
  importAllHuduClients,
  setHuduAutoSync,
  syncAllHuduClients,
} from '../../../../lib/actions/integrations/huduTenantSyncActions';
import type { HuduTenantSyncActionResult } from '../../../../lib/actions/integrations/huduTenantSyncActions';

const SYNCING_POLL_MS = 4000;

// The EE tsconfig is non-strict, so `!result.success` alone does not narrow.
function isSyncFailure(
  result: HuduTenantSyncActionResult
): result is Extract<HuduTenantSyncActionResult, { success: false }> {
  return !result.success;
}

export default function HuduSyncAutomationManager() {
  const { t } = useTranslation('msp/integrations');
  const { toast } = useToast();

  const [status, setStatus] = useState<HuduConnectionStatusData | null>(null);
  const [isImporting, startImport] = useTransition();
  const [isSyncing, startSync] = useTransition();
  const [isTogglingAuto, startToggle] = useTransition();
  const busy = isImporting || isSyncing || isTogglingAuto;

  const loadStatus = useCallback(async () => {
    const result = await getHuduConnectionStatus();
    if (result.success) {
      setStatus(result.data);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // Poll while a tenant-wide run is in flight so the badge + last-run summary
  // converge without a manual refresh (RMM refreshes after; this also catches
  // background/auto runs that finish while the page is open).
  const runInFlight = status?.syncStatus === 'syncing';
  useEffect(() => {
    if (!runInFlight) return;
    const timer = setInterval(() => void loadStatus(), SYNCING_POLL_MS);
    return () => clearInterval(timer);
  }, [runInFlight, loadStatus]);

  const summaryText = useCallback(
    (data: NonNullable<HuduTenantSyncActionResult & { success: true }>['data']) =>
      t('integrations.hudu.settings.sync.summary', {
        defaultValue: '{{created}} created · {{updated}} updated · {{skipped}} skipped · {{failed}} failed',
        created: data.items_created,
        updated: data.items_updated,
        skipped: data.items_skipped,
        failed: data.items_failed,
      }),
    [t]
  );

  const handleImportAll = () => {
    startImport(async () => {
      const result = await importAllHuduClients();
      if (isSyncFailure(result)) {
        toast({
          title: t('integrations.hudu.settings.sync.toastErrorTitle', { defaultValue: 'Hudu import failed' }),
          description: result.error,
          variant: 'destructive',
        });
      } else {
        toast({
          title: t('integrations.hudu.settings.sync.importDoneTitle', { defaultValue: 'Hudu import finished' }),
          description: summaryText(result.data),
        });
      }
      await loadStatus();
    });
  };

  const handleSyncAll = () => {
    startSync(async () => {
      const result = await syncAllHuduClients();
      if (isSyncFailure(result)) {
        toast({
          title: t('integrations.hudu.settings.sync.toastErrorTitle', { defaultValue: 'Hudu sync failed' }),
          description: result.error,
          variant: 'destructive',
        });
      } else {
        toast({
          title: t('integrations.hudu.settings.sync.syncDoneTitle', { defaultValue: 'Hudu sync finished' }),
          description: summaryText(result.data),
        });
      }
      await loadStatus();
    });
  };

  const handleToggleAutoSync = (enabled: boolean) => {
    startToggle(async () => {
      const result = await setHuduAutoSync({ enabled });
      if (!result.success) {
        toast({
          title: t('integrations.hudu.settings.sync.toastErrorTitle', { defaultValue: 'Hudu auto-sync update failed' }),
          // EE tsconfig doesn't narrow this discriminated union on `!success`.
          description: (result as { success: false; error: string }).error,
          variant: 'destructive',
        });
      }
      await loadStatus();
    });
  };

  const syncBadge = () => {
    switch (status?.syncStatus) {
      case 'syncing':
        return (
          <Badge id="hudu-sync-status-badge" variant="secondary">
            {t('integrations.hudu.settings.sync.status.syncing', { defaultValue: 'Running…' })}
          </Badge>
        );
      case 'completed':
        return (
          <Badge id="hudu-sync-status-badge" variant="success">
            {t('integrations.hudu.settings.sync.status.completed', { defaultValue: 'Completed' })}
          </Badge>
        );
      case 'error':
        return (
          <Badge id="hudu-sync-status-badge" variant="error">
            {t('integrations.hudu.settings.sync.status.error', { defaultValue: 'Error' })}
          </Badge>
        );
      default:
        return null;
    }
  };

  const lastRunText = () => {
    const last = status?.lastSync;
    const at = status?.lastFullSyncAt;
    if (!last || !at) {
      return t('integrations.hudu.settings.sync.neverRun', { defaultValue: 'No tenant-wide run yet.' });
    }
    return t('integrations.hudu.settings.sync.lastRun', {
      defaultValue: 'Last run {{at}}: {{created}} created · {{updated}} updated · {{skipped}} skipped · {{failed}} failed',
      at: new Date(at).toLocaleString(),
      created: last.items_created,
      updated: last.items_updated,
      skipped: last.items_skipped,
      failed: last.items_failed,
    });
  };

  return (
    <Card id="hudu-sync-automation">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>
              {t('integrations.hudu.settings.sync.title', { defaultValue: 'Sync & automation' })}
            </CardTitle>
            <CardDescription>
              {t('integrations.hudu.settings.sync.description', {
                defaultValue:
                  'Import assets for every mapped client at once, and keep them up to date automatically. Mapping a company or layout only configures the integration — assets appear only after an import.',
              })}
            </CardDescription>
          </div>
          {syncBadge()}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {status?.syncStatus === 'error' && status.syncError && (
          <Alert id="hudu-sync-error" variant="destructive">
            <AlertDescription>{status.syncError}</AlertDescription>
          </Alert>
        )}

        <p id="hudu-sync-last-run" className="text-sm text-muted-foreground">
          {lastRunText()}
        </p>

        <div className="flex flex-wrap gap-2">
          <Button id="hudu-import-all-button" onClick={handleImportAll} disabled={busy || runInFlight}>
            <DownloadCloud className="mr-2 h-4 w-4" />
            {isImporting
              ? t('integrations.hudu.settings.sync.importing', { defaultValue: 'Importing…' })
              : t('integrations.hudu.settings.sync.importAll', { defaultValue: 'Import all mapped clients' })}
          </Button>
          <Button
            id="hudu-sync-all-button"
            variant="outline"
            onClick={handleSyncAll}
            disabled={busy || runInFlight}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            {isSyncing
              ? t('integrations.hudu.settings.sync.syncing2', { defaultValue: 'Syncing…' })
              : t('integrations.hudu.settings.sync.syncAll', { defaultValue: 'Sync all' })}
          </Button>
        </div>

        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <p className="text-sm font-medium">
              {t('integrations.hudu.settings.sync.autoSyncLabel', { defaultValue: 'Daily auto-sync' })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('integrations.hudu.settings.sync.autoSyncHint', {
                defaultValue:
                  'Automatically import new assets and refresh existing ones once a day for every mapped client.',
              })}
            </p>
          </div>
          <Switch
            id="hudu-auto-sync-toggle"
            checked={status?.autoSync.enabled === true}
            onCheckedChange={handleToggleAutoSync}
            disabled={isTogglingAuto}
          />
        </div>
      </CardContent>
    </Card>
  );
}
