'use client';

import React from 'react';
import Link from 'next/link';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Switch } from '@alga-psa/ui/components/Switch';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getAccountingSyncHealth,
  updateAccountingSyncSettingsAction,
  runAccountingSyncNow,
  setDefaultQboRealm,
} from '../../actions/accountingSyncActions';
import type { AccountingSyncHealth } from '../../actions/accountingSyncActions';
// eslint-disable-next-line custom-rules/no-feature-to-feature-imports -- billing-owned panel is slot-injected into the integrations settings page and reads the QBO catalogs directly (same bridge as the accounting export adapter)
import { getQboAccounts, getQboClasses, getQboDepartments } from '@alga-psa/integrations/actions';
// eslint-disable-next-line custom-rules/no-feature-to-feature-imports -- type-only import for the QBO catalog shapes above
import type { QboAccount, QboClass, QboDepartment } from '@alga-psa/integrations/actions';

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

function cycleStatusMeta(status: string | undefined, t: TranslateFn) {
  switch (status) {
    case 'succeeded':
      return { dot: 'bg-emerald-500', label: t('integrations.qbo.sync.status.succeeded', { defaultValue: 'Succeeded' }) };
    case 'failed':
      return { dot: 'bg-red-500', label: t('integrations.qbo.sync.status.failed', { defaultValue: 'Failed' }) };
    case 'running':
      return { dot: 'bg-amber-500', label: t('integrations.qbo.sync.status.running', { defaultValue: 'Running' }) };
    default:
      return { dot: 'bg-muted-foreground/60', label: status ?? '' };
  }
}

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

  const multiRealm = health.realms.length > 1;
  const lastCycle = health.lastCycle;
  const statusMeta = cycleStatusMeta(lastCycle?.status, t);

  // Token expiry: keep it quiet unless it is close or already lapsed.
  const tokenExpiresAt = health.refreshTokenExpiresAt
    ? new Date(health.refreshTokenExpiresAt)
    : null;
  const tokenMsLeft = tokenExpiresAt ? tokenExpiresAt.getTime() - Date.now() : null;
  const tokenExpired = tokenMsLeft !== null && tokenMsLeft <= 0;
  const tokenExpiringSoon = tokenMsLeft !== null && tokenMsLeft > 0 && tokenMsLeft <= 14 * 24 * 60 * 60 * 1000;
  const tokenDate = tokenExpiresAt ? tokenExpiresAt.toLocaleDateString() : '';

  const metrics: Array<{ value: number; label: string; tone: 'neutral' | 'warn' | 'error'; href?: string }> = [
    { value: health.pendingOps, label: t('integrations.qbo.sync.pendingOps', { defaultValue: 'Pending ops' }), tone: 'neutral' },
    { value: health.erroredOps, label: t('integrations.qbo.sync.erroredOps', { defaultValue: 'Errored ops' }), tone: 'error' },
    { value: health.driftCount, label: t('integrations.qbo.sync.driftCount', { defaultValue: 'Drift' }), tone: 'warn' },
    { value: health.openExceptions, label: t('integrations.qbo.sync.openExceptions', { defaultValue: 'Open exceptions' }), tone: 'error', href: '/msp/user-activities' }
  ];

  const metricToneClass = (value: number, tone: 'neutral' | 'warn' | 'error') => {
    if (value <= 0) return 'text-foreground';
    if (tone === 'error') return 'text-red-600';
    if (tone === 'warn') return 'text-amber-600';
    return 'text-foreground';
  };

  return (
    <section id="qbo-integration-sync-health-card" className="space-y-5 border-t pt-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            {t('integrations.qbo.sync.healthCardTitle', { defaultValue: 'Sync health' })}
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t('integrations.qbo.sync.healthCardDescription', {
              defaultValue: 'QuickBooks accounting sync runs automatically every 15 minutes when auto-sync is on.'
            })}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm font-medium text-foreground">
            {t('integrations.qbo.sync.autoSyncLabel', { defaultValue: 'Auto-sync' })}
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
                  // Silently ignore — toggle state stays as-is
                } finally {
                  setAutoSyncToggling(false);
                }
              }}
            />
          </label>
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
            <RefreshCw className={`mr-2 h-4 w-4${syncNowRunning ? ' animate-spin' : ''}`} />
            {syncNowRunning
              ? t('integrations.qbo.sync.syncNowRunning', { defaultValue: 'Syncing…' })
              : t('integrations.qbo.sync.syncNowButton', { defaultValue: 'Sync Now' })}
          </Button>
        </div>
      </div>

      {syncNowFeedback && (
        <Alert variant={syncNowFeedback.type === 'success' ? 'success' : 'destructive'}>
          <AlertDescription>{syncNowFeedback.message}</AlertDescription>
        </Alert>
      )}

      {/* Last sync cycle — a single status line, no badge */}
      <div className="space-y-1 text-sm">
        {lastCycle ? (
          <>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className={`h-2 w-2 shrink-0 rounded-full ${statusMeta.dot}`} aria-hidden="true" />
              <span className="font-medium text-foreground">{statusMeta.label}</span>
              {lastCycle.finished_at && (
                <span className="text-muted-foreground">
                  {t('integrations.qbo.sync.lastRunAt', {
                    time: new Date(lastCycle.finished_at).toLocaleString(),
                    defaultValue: `· last run ${new Date(lastCycle.finished_at).toLocaleString()}`
                  })}
                </span>
              )}
            </div>
            {lastCycle.stats && (
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 pl-4 text-xs text-muted-foreground">
                {lastCycle.stats.opsProcessed !== undefined && (
                  <span>{t('integrations.qbo.sync.statOpsProcessed', { count: lastCycle.stats.opsProcessed, defaultValue: `${lastCycle.stats.opsProcessed} ops processed` })}</span>
                )}
                {lastCycle.stats.driftFound !== undefined && (
                  <span>{t('integrations.qbo.sync.statDriftFound', { count: lastCycle.stats.driftFound, defaultValue: `${lastCycle.stats.driftFound} drift` })}</span>
                )}
                {lastCycle.stats.paymentsApplied !== undefined && (
                  <span>{t('integrations.qbo.sync.statPaymentsApplied', { count: lastCycle.stats.paymentsApplied, defaultValue: `${lastCycle.stats.paymentsApplied} payments applied` })}</span>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/60" aria-hidden="true" />
            {t('integrations.qbo.sync.noLastCycle', { defaultValue: 'No sync cycle has run yet.' })}
          </div>
        )}
        {tokenExpiresAt && !tokenExpired && !tokenExpiringSoon && (
          <p className="pl-4 text-xs text-muted-foreground">
            {t('integrations.qbo.sync.tokenValidUntil', { date: tokenDate, defaultValue: `Connection valid until ${tokenDate}` })}
          </p>
        )}
      </div>

      {/* Metrics — one grouped strip, errors highlighted only when present */}
      <dl className="grid grid-cols-2 divide-y divide-border overflow-hidden rounded-lg border sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        {metrics.map((m) => (
          <div key={m.label} className="px-4 py-3">
            <dt className="text-xs text-muted-foreground">{m.label}</dt>
            <dd className={`mt-0.5 text-xl font-semibold ${metricToneClass(m.value, m.tone)}`}>
              {m.href && m.value > 0 ? (
                <Link href={m.href} className="underline underline-offset-2">{m.value}</Link>
              ) : (
                m.value
              )}
            </dd>
          </div>
        ))}
      </dl>

      {/* QBO 'Automatically apply credits' conflicts with Alga-driven credit application */}
      {health.autoApplyCreditsEnabled === true && (
        <Alert variant="warning" id="qbo-auto-apply-credits-warning">
          <AlertDescription>
            {t('integrations.qbo.sync.autoApplyCreditsWarning', {
              defaultValue:
                'QuickBooks is set to automatically apply credits, which conflicts with credit applications driven from Alga: QuickBooks may apply exported credit memos to a different invoice before the sync does. In QuickBooks, go to Account and Settings → Advanced → Automation and turn off "Automatically apply credits".',
            })}
          </AlertDescription>
        </Alert>
      )}

      {/* Token expiry — only escalated when expired or close */}
      {(tokenExpired || tokenExpiringSoon) && (
        <Alert variant={tokenExpired ? 'destructive' : 'warning'}>
          <AlertDescription>
            {tokenExpired
              ? t('integrations.qbo.sync.refreshTokenExpired', { defaultValue: 'QuickBooks token expired — reconnect to resume syncing.' })
              : t('integrations.qbo.sync.refreshTokenExpirySoon', { date: tokenDate, defaultValue: `QuickBooks token expires ${tokenDate} — reconnect soon to avoid interruption.` })}
          </AlertDescription>
        </Alert>
      )}

      {/* Multi-realm: realm list with Make default */}
      {multiRealm && (
        <div id="qbo-realm-list" className="space-y-2">
          <h4 className="text-sm font-semibold text-foreground">
            {t('integrations.qbo.sync.connectedCompanies', { defaultValue: 'Connected companies' })}
          </h4>
          <div className="divide-y rounded-lg border">
            {health.realms.map((realm) => (
              <div key={realm.realmId} className="flex items-center justify-between gap-2 px-4 py-2.5">
                <span className="font-mono text-xs text-muted-foreground">{realm.realmId}</span>
                {realm.isDefault ? (
                  <span className="text-xs font-medium text-muted-foreground">
                    {t('integrations.qbo.sync.defaultRealm', { defaultValue: 'Default' })}
                  </span>
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
        <div id="qbo-sync-config-section" className="space-y-3">
          <div>
            <h4 className="text-sm font-semibold text-foreground">
              {t('integrations.qbo.sync.configTitle', { defaultValue: 'Sync configuration' })}
            </h4>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('integrations.qbo.sync.configDescription', {
                defaultValue: 'Defaults applied to documents Alga posts into QuickBooks.'
              })}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t('integrations.qbo.sync.depositAccount', { defaultValue: 'Deposit account' })}
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

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t('integrations.qbo.sync.defaultClass', { defaultValue: 'Default class' })}
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

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t('integrations.qbo.sync.defaultDepartment', { defaultValue: 'Default department' })}
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
        </div>
      )}
    </section>
  );
}
