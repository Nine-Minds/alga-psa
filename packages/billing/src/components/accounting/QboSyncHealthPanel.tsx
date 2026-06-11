'use client';

import React from 'react';
import Link from 'next/link';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Switch } from '@alga-psa/ui/components/Switch';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getAccountingSyncHealth,
  updateAccountingSyncSettingsAction,
  runAccountingSyncNow,
  setDefaultQboRealm,
} from '../../actions/accountingSyncActions';
import type { AccountingSyncHealth } from '../../actions/accountingSyncActions';
import {
  getQboAccounts,
  getQboClasses,
  getQboDepartments,
} from '@alga-psa/integrations/actions';
import type { QboAccount, QboClass, QboDepartment } from '@alga-psa/integrations/actions';

export default function QboSyncHealthPanel() {
  const { t } = useTranslation('msp/integrations');

  const [health, setHealth] = React.useState<AccountingSyncHealth | null>(null);
  const [healthHidden, setHealthHidden] = React.useState(false);
  const [syncNowRunning, setSyncNowRunning] = React.useState(false);
  const [syncNowFeedback, setSyncNowFeedback] = React.useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [autoSyncToggling, setAutoSyncToggling] = React.useState(false);

  // Sync config catalog data
  const [accounts, setAccounts] = React.useState<QboAccount[]>([]);
  const [classes, setClasses] = React.useState<QboClass[]>([]);
  const [departments, setDepartments] = React.useState<QboDepartment[]>([]);
  const [catalogLoaded, setCatalogLoaded] = React.useState(false);
  const [savingRef, setSavingRef] = React.useState<string | null>(null);

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

  React.useEffect(() => {
    if (!health?.connected || catalogLoaded) return;
    Promise.all([
      getQboAccounts().catch(() => []),
      getQboClasses().catch(() => []),
      getQboDepartments().catch(() => [])
    ]).then(([accts, cls, deps]) => {
      setAccounts(accts);
      setClasses(cls);
      setDepartments(deps);
      setCatalogLoaded(true);
    });
  }, [health?.connected, catalogLoaded]);

  if (healthHidden || !health) {
    return null;
  }

  const defaultRealm = health.realms.find((r) => r.isDefault)?.realmId ?? null;
  const multiRealm = health.realms.length > 1;

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

          {/* Multi-realm: realm list with Make default */}
          {multiRealm && (
            <div id="qbo-realm-list" className="rounded-lg border p-4 space-y-2 text-sm">
              <p className="font-medium text-foreground">
                {t('integrations.qbo.sync.connectedCompanies', { defaultValue: 'Connected Companies' })}
              </p>
              <div className="space-y-2">
                {health.realms.map((realm) => (
                  <div key={realm.realmId} className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{realm.realmId}</span>
                    {realm.isDefault ? (
                      <Badge variant="secondary">
                        {t('integrations.qbo.sync.defaultRealm', { defaultValue: 'Default' })}
                      </Badge>
                    ) : (
                      <Button
                        id={`qbo-make-default-${realm.realmId}`}
                        variant="outline"
                        size="sm"
                        disabled={savingRef === realm.realmId}
                        onClick={async () => {
                          setSavingRef(realm.realmId);
                          try {
                            await setDefaultQboRealm(realm.realmId);
                            await loadHealth();
                          } finally {
                            setSavingRef(null);
                          }
                        }}
                      >
                        {savingRef === realm.realmId
                          ? t('integrations.qbo.sync.saving', { defaultValue: 'Saving…' })
                          : t('integrations.qbo.sync.makeDefault', { defaultValue: 'Make default' })}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sync configuration: deposit / class / department pickers */}
          {health.connected && (
            <div id="qbo-sync-config-section" className="rounded-lg border p-4 space-y-4 text-sm">
              <p className="font-medium text-foreground">
                {t('integrations.qbo.sync.configTitle', { defaultValue: 'Sync Configuration' })}
              </p>

              {/* Deposit account */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  {t('integrations.qbo.sync.depositAccount', { defaultValue: 'Deposit Account' })}
                </label>
                <CustomSelect
                  id="qbo-sync-deposit-account"
                  value={health.settings.depositAccountRef?.value ?? ''}
                  onValueChange={async (value) => {
                    const account = accounts.find((a) => a.id === value) ?? null;
                    const ref = account ? { value: account.id, name: account.name } : null;
                    const updated = await updateAccountingSyncSettingsAction({ depositAccountRef: ref });
                    setHealth((prev) => prev ? { ...prev, settings: updated } : prev);
                  }}
                  options={[
                    { value: '', label: t('integrations.qbo.sync.undepositedFunds', { defaultValue: 'Undeposited Funds (default)' }) },
                    ...accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.accountType})` }))
                  ]}
                />
              </div>

              {/* Default class */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  {t('integrations.qbo.sync.defaultClass', { defaultValue: 'Default Class' })}
                </label>
                <CustomSelect
                  id="qbo-sync-default-class"
                  value={health.settings.defaultClassRef?.value ?? ''}
                  onValueChange={async (value) => {
                    const cls = classes.find((c) => c.id === value) ?? null;
                    const ref = cls ? { value: cls.id, name: cls.name } : null;
                    const updated = await updateAccountingSyncSettingsAction({ defaultClassRef: ref });
                    setHealth((prev) => prev ? { ...prev, settings: updated } : prev);
                  }}
                  options={[
                    { value: '', label: t('integrations.qbo.sync.noDefault', { defaultValue: 'No default' }) },
                    ...classes.map((c) => ({ value: c.id, label: c.name }))
                  ]}
                />
              </div>

              {/* Default department */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  {t('integrations.qbo.sync.defaultDepartment', { defaultValue: 'Default Department' })}
                </label>
                <CustomSelect
                  id="qbo-sync-default-department"
                  value={health.settings.defaultDepartmentRef?.value ?? ''}
                  onValueChange={async (value) => {
                    const dept = departments.find((d) => d.id === value) ?? null;
                    const ref = dept ? { value: dept.id, name: dept.name } : null;
                    const updated = await updateAccountingSyncSettingsAction({ defaultDepartmentRef: ref });
                    setHealth((prev) => prev ? { ...prev, settings: updated } : prev);
                  }}
                  options={[
                    { value: '', label: t('integrations.qbo.sync.noDefault', { defaultValue: 'No default' }) },
                    ...departments.map((d) => ({ value: d.id, label: d.name }))
                  ]}
                />
              </div>
            </div>
          )}

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
