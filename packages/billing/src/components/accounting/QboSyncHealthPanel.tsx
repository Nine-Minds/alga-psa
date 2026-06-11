'use client';

import React from 'react';
import Link from 'next/link';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Switch } from '@alga-psa/ui/components/Switch';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getAccountingSyncHealth,
  updateAccountingSyncSettingsAction,
  runAccountingSyncNow,
} from '../../actions/accountingSyncActions';
import type { AccountingSyncHealth } from '../../actions/accountingSyncActions';

export default function QboSyncHealthPanel() {
  const { t } = useTranslation('msp/integrations');

  const [health, setHealth] = React.useState<AccountingSyncHealth | null>(null);
  const [healthHidden, setHealthHidden] = React.useState(false);
  const [syncNowRunning, setSyncNowRunning] = React.useState(false);
  const [syncNowFeedback, setSyncNowFeedback] = React.useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [autoSyncToggling, setAutoSyncToggling] = React.useState(false);

  const loadHealth = React.useCallback(async () => {
    if (healthHidden) return;
    try {
      const h = await getAccountingSyncHealth();
      setHealth(h);
    } catch {
      // CE / no permission — suppress the health card entirely
      setHealthHidden(true);
    }
  }, [healthHidden]);

  React.useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  if (healthHidden || !health) {
    return null;
  }

  return (
    <Card id="qbo-integration-sync-health-card">
      <CardHeader>
        <CardTitle>{t('integrations.qbo.sync.healthCardTitle', { defaultValue: 'Sync Health' })}</CardTitle>
        <CardDescription>
          {t('integrations.qbo.sync.healthCardDescription', { defaultValue: 'QuickBooks accounting sync status and controls. Runs every 15 minutes.' })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {syncNowFeedback && (
          <Alert variant={syncNowFeedback.type === 'success' ? 'success' : 'destructive'}>
            <AlertDescription>{syncNowFeedback.message}</AlertDescription>
          </Alert>
        )}

        <>
          {/* Last cycle */}
          <div className="rounded-lg border bg-muted/20 p-4 space-y-2 text-sm">
            <p className="font-medium text-foreground">
              {t('integrations.qbo.sync.lastCycleTitle', { defaultValue: 'Last Sync Cycle' })}
            </p>
            {health.lastCycle ? (
              <div className="space-y-1">
                <div className="flex flex-wrap gap-2 items-center">
                  <Badge variant={health.lastCycle.status === 'succeeded' ? 'success' : health.lastCycle.status === 'failed' ? 'error' : 'secondary'}>
                    {health.lastCycle.status}
                  </Badge>
                  {health.lastCycle.finished_at && (
                    <span className="text-muted-foreground text-xs">
                      {new Date(health.lastCycle.finished_at).toLocaleString()}
                    </span>
                  )}
                </div>
                {health.lastCycle.stats && (
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    {health.lastCycle.stats.opsProcessed !== undefined && (
                      <span>
                        {t('integrations.qbo.sync.statOpsProcessed', {
                          count: health.lastCycle.stats.opsProcessed,
                          defaultValue: `${health.lastCycle.stats.opsProcessed} ops processed`,
                        })}
                      </span>
                    )}
                    {health.lastCycle.stats.driftFound !== undefined && (
                      <span>
                        {t('integrations.qbo.sync.statDriftFound', {
                          count: health.lastCycle.stats.driftFound,
                          defaultValue: `${health.lastCycle.stats.driftFound} drift`,
                        })}
                      </span>
                    )}
                    {health.lastCycle.stats.paymentsApplied !== undefined && (
                      <span>
                        {t('integrations.qbo.sync.statPaymentsApplied', {
                          count: health.lastCycle.stats.paymentsApplied,
                          defaultValue: `${health.lastCycle.stats.paymentsApplied} payments applied`,
                        })}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground text-xs">
                {t('integrations.qbo.sync.noLastCycle', { defaultValue: 'No sync cycle has run yet.' })}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {t('integrations.qbo.sync.nextRunHint', { defaultValue: 'Runs automatically every 15 minutes when auto-sync is enabled.' })}
            </p>
          </div>

          {/* Counts row */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-sm">
            <div className="rounded border bg-muted/10 p-3 text-center">
              <div className="text-2xl font-semibold">{health.pendingOps}</div>
              <div className="text-xs text-muted-foreground">
                {t('integrations.qbo.sync.pendingOps', { defaultValue: 'Pending ops' })}
              </div>
            </div>
            <div className="rounded border bg-muted/10 p-3 text-center">
              <div className="text-2xl font-semibold">{health.erroredOps}</div>
              <div className="text-xs text-muted-foreground">
                {t('integrations.qbo.sync.erroredOps', { defaultValue: 'Errored ops' })}
              </div>
            </div>
            <div className="rounded border bg-muted/10 p-3 text-center">
              <div className="text-2xl font-semibold">{health.driftCount}</div>
              <div className="text-xs text-muted-foreground">
                {t('integrations.qbo.sync.driftCount', { defaultValue: 'Drift' })}
              </div>
            </div>
            <div className="rounded border bg-muted/10 p-3 text-center">
              <div className="text-2xl font-semibold">
                <Link href="/msp/user-activities" className="underline">
                  {health.openExceptions}
                </Link>
              </div>
              <div className="text-xs text-muted-foreground">
                {t('integrations.qbo.sync.openExceptions', { defaultValue: 'Open exceptions' })}
              </div>
            </div>
          </div>

          {/* Refresh token expiry */}
          {health.refreshTokenExpiresAt && (() => {
            const expiresMs = new Date(health.refreshTokenExpiresAt!).getTime() - Date.now();
            const expired = expiresMs <= 0;
            const expiresDate = new Date(health.refreshTokenExpiresAt!).toLocaleDateString();
            return (
              <Alert variant={expired ? 'destructive' : 'info'}>
                <AlertDescription>
                  {expired
                    ? t('integrations.qbo.sync.refreshTokenExpired', { defaultValue: 'QuickBooks token expired — reconnect to resume syncing.' })
                    : t('integrations.qbo.sync.refreshTokenExpiry', { date: expiresDate, defaultValue: `QuickBooks token expires ${expiresDate}` })}
                </AlertDescription>
              </Alert>
            );
          })()}

          {/* Auto-sync toggle */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">
              {t('integrations.qbo.sync.autoSyncLabel', { defaultValue: 'Auto-sync enabled' })}
            </span>
            <Switch
              id="qbo-sync-auto-sync-toggle"
              checked={health.settings.autoSyncEnabled}
              disabled={autoSyncToggling}
              onCheckedChange={async (checked) => {
                setAutoSyncToggling(true);
                try {
                  const updated = await updateAccountingSyncSettingsAction({ autoSyncEnabled: checked });
                  setHealth((prev) => prev ? { ...prev, settings: updated } : prev);
                } catch {
                  // Silently ignore — badge state stays as-is
                } finally {
                  setAutoSyncToggling(false);
                }
              }}
            />
          </div>
        </>
      </CardContent>
      <CardFooter>
        <Button
          id="qbo-sync-now-button"
          type="button"
          variant="outline"
          disabled={syncNowRunning}
          onClick={async () => {
            setSyncNowRunning(true);
            setSyncNowFeedback(null);
            try {
              const result = await runAccountingSyncNow();
              if (result.ran) {
                setSyncNowFeedback({ type: 'success', message: t('integrations.qbo.sync.syncNowSuccess', { defaultValue: 'Sync completed successfully.' }) });
              } else {
                setSyncNowFeedback({
                  type: 'error',
                  message: t('integrations.qbo.sync.syncNowSkipped', {
                    reason: result.error ?? result.status,
                    defaultValue: `Sync skipped: ${result.error ?? result.status}`,
                  }),
                });
              }
              void loadHealth();
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              setSyncNowFeedback({
                type: 'error',
                message: t('integrations.qbo.sync.syncNowError', { error: msg, defaultValue: `Sync failed: ${msg}` }),
              });
            } finally {
              setSyncNowRunning(false);
            }
          }}
        >
          {syncNowRunning
            ? t('integrations.qbo.sync.syncNowRunning', { defaultValue: 'Syncing…' })
            : t('integrations.qbo.sync.syncNowButton', { defaultValue: 'Sync Now' })}
        </Button>
      </CardFooter>
    </Card>
  );
}
