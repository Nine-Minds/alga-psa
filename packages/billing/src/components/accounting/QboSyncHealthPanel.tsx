'use client';

import React from 'react';
import { createPortal } from 'react-dom';
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

const useIsoLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

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

// LEVERAGE: friction section-primitives-home — verbatim re-impl of SettingsGroup's header (same 11px/uppercase/0.09em/pb-[9px] hairline); can't reuse the integrations primitive across the feature boundary (no-feature-to-feature-imports). Primitive's home should be @alga-psa/ui, not the integrations feature pkg.
/** Quiet, labelled hairline section — mirrors SettingsGroup in the integrations panels. */
function GroupHeader({ title, action }: { title: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b pb-[9px]">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">{title}</h4>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export default function QboSyncHealthPanel() {
  const { t } = useTranslation('msp/integrations');

  const [health, setHealth] = React.useState<AccountingSyncHealth | null>(null);
  const [healthHidden, setHealthHidden] = React.useState(false);
  const [syncNowRunning, setSyncNowRunning] = React.useState(false);
  const [syncNowFeedback, setSyncNowFeedback] = React.useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [autoSyncToggling, setAutoSyncToggling] = React.useState(false);
  const [attnMount, setAttnMount] = React.useState<HTMLElement | null>(null);
  const [suffixMount, setSuffixMount] = React.useState<HTMLElement | null>(null);

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

  // LEVERAGE: friction hero-portal-bridge — this billing panel is slot-injected BELOW PanelHero, but the design needs its attention strip + sync suffix to render INSIDE the hero. Composition only flows down, so we teleport upward via getElementById + createPortal into empty mount nodes the hero leaves behind. The layout wants content to flow child→ancestor; React's slot model won't, so we re-derive it through the DOM. (cost: high — global-id coupling, SSR shim, render-after-mount flicker)
  // The attention strip belongs inside the connection hero banner (rendered by the
  // integrations panel). Portal into that mount when present; otherwise render inline.
  useIsoLayoutEffect(() => {
    setAttnMount(document.getElementById('qbo-sync-attention-mount'));
    setSuffixMount(document.getElementById('qbo-hero-sync-suffix'));
  });

  const runSyncNow = React.useCallback(async () => {
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
  }, [loadHealth, t]);

  if (healthHidden || !health) {
    return null;
  }

  const multiRealm = health.realms.length > 1;
  const lastCycle = health.lastCycle;
  const statusMeta = cycleStatusMeta(lastCycle?.status, t);
  const autoSyncEnabled = health.settings.autoSyncEnabled;

  const tokenExpiresAt = health.refreshTokenExpiresAt ? new Date(health.refreshTokenExpiresAt) : null;
  const tokenMsLeft = tokenExpiresAt ? tokenExpiresAt.getTime() - Date.now() : null;
  const tokenExpired = tokenMsLeft !== null && tokenMsLeft <= 0;
  const tokenExpiringSoon = tokenMsLeft !== null && tokenMsLeft > 0 && tokenMsLeft <= 14 * 24 * 60 * 60 * 1000;
  const tokenDate = tokenExpiresAt ? tokenExpiresAt.toLocaleDateString() : '';

  const hasErrors = health.erroredOps > 0 || health.openExceptions > 0;
  const hasDrift = health.driftCount > 0;
  const tone: 'error' | 'warn' | 'calm' = hasErrors ? 'error' : hasDrift ? 'warn' : 'calm';

  // LEVERAGE: pattern status-tone-classes — Nth hand-rolled tone→tailwind-color map in this feature (cf. HERO_CHIP/HERO_DOT in accountingSectionPrimitives, connectionTone in QboIntegrationSettings, metricToneClass below). Each re-derives semantic status colors from literal red/amber/emerald classes. Missing a shared semantic-tone token layer.
  const attnSurface =
    tone === 'error'
      ? 'border-red-200 bg-red-50'
      : tone === 'warn'
        ? 'border-amber-200 bg-amber-50'
        : 'border-emerald-200 bg-emerald-50';
  const attnText = tone === 'error' ? 'text-red-800' : tone === 'warn' ? 'text-amber-800' : 'text-emerald-800';
  const attnStrong = tone === 'error' ? 'text-red-900' : tone === 'warn' ? 'text-amber-900' : 'text-emerald-900';
  const bigCount = health.openExceptions > 0 ? health.openExceptions : health.erroredOps;
  const bigColor = tone === 'error' ? 'text-red-600' : tone === 'warn' ? 'text-amber-600' : 'text-emerald-600';
  const headBold = hasErrors
    ? health.openExceptions > 0
      ? t('integrations.qbo.sync.attnExceptions', { defaultValue: 'open exceptions' })
      : t('integrations.qbo.sync.attnErrored', { defaultValue: 'errored ops' })
    : hasDrift
      ? t('integrations.qbo.sync.attnDrift', { defaultValue: 'drift detected' })
      : t('integrations.qbo.sync.attnHealthy', { defaultValue: 'Sync is up to date' });
  const headRest = hasErrors || hasDrift
    ? t('integrations.qbo.sync.attnNeedReview', { defaultValue: 'need attention before the next sync.' })
    : '';
  const line2Parts: string[] = [];
  if (!autoSyncEnabled) line2Parts.push(t('integrations.qbo.sync.attnAutoSyncOff', { defaultValue: 'Auto-sync is currently off' }));
  if (hasDrift && health.openExceptions > 0) line2Parts.push(t('integrations.qbo.sync.attnDriftDetail', { count: health.driftCount, defaultValue: `${health.driftCount} drift detected` }));
  const line2 = line2Parts.length ? `${line2Parts.join(' · ')}.` : '';

  const autoSyncControl = (
    <label className="flex items-center gap-2 text-sm font-medium text-foreground">
      {t('integrations.qbo.sync.autoSyncLabel', { defaultValue: 'Auto-sync' })}
      <Switch
        id="qbo-sync-auto-sync-toggle"
        checked={autoSyncEnabled}
        disabled={autoSyncToggling}
        onCheckedChange={async (checked) => {
          setAutoSyncToggling(true);
          try {
            const updated = await updateAccountingSyncSettingsAction({ autoSyncEnabled: checked });
            setHealth((prev) => prev ? { ...prev, settings: updated } : prev);
          } catch {
            // keep state
          } finally {
            setAutoSyncToggling(false);
          }
        }}
      />
    </label>
  );

  const syncNowButton = (
    <Button id="qbo-sync-now-button" type="button" variant="outline" disabled={syncNowRunning} onClick={() => void runSyncNow()}>
      <RefreshCw className={`mr-2 h-4 w-4${syncNowRunning ? ' animate-spin' : ''}`} />
      {syncNowRunning
        ? t('integrations.qbo.sync.syncNowRunning', { defaultValue: 'Syncing…' })
        : t('integrations.qbo.sync.syncNowButton', { defaultValue: 'Sync Now' })}
    </Button>
  );

  const attentionStrip = (
    <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-xl border px-4 py-[13px] ${attnSurface}`}>
      <div className="flex min-w-0 items-center gap-3">
        {bigCount > 0 ? <span className={`text-[22px] font-bold leading-none ${bigColor}`}>{bigCount}</span> : null}
        <p className={`text-[13px] ${attnText}`}>
          <strong className={`font-semibold ${attnStrong}`}>{headBold}</strong>
          {headRest ? ` ${headRest}` : ''}
          {line2 ? <><br />{line2}</> : ''}
        </p>
      </div>
      <div className="flex items-center gap-3.5">
        {autoSyncControl}
        {syncNowButton}
        {hasErrors && health.openExceptions > 0 ? (
          <Button id="qbo-sync-review-exceptions" asChild>
            <Link href="/msp/user-activities">
              {t('integrations.qbo.sync.reviewExceptions', { defaultValue: 'Review exceptions' })}
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );

  const metrics: Array<{ value: number; label: string; tone: 'neutral' | 'warn' | 'error'; href?: string }> = [
    { value: health.pendingOps, label: t('integrations.qbo.sync.pendingOps', { defaultValue: 'Pending ops' }), tone: 'neutral' },
    { value: health.erroredOps, label: t('integrations.qbo.sync.erroredOps', { defaultValue: 'Errored ops' }), tone: 'error' },
    { value: health.driftCount, label: t('integrations.qbo.sync.driftCount', { defaultValue: 'Drift' }), tone: 'warn' },
    { value: health.openExceptions, label: t('integrations.qbo.sync.openExceptions', { defaultValue: 'Open exceptions' }), tone: 'error', href: '/msp/user-activities' }
  ];
  const metricToneClass = (value: number, mtone: 'neutral' | 'warn' | 'error') => {
    if (value <= 0) return 'text-foreground';
    if (mtone === 'error') return 'text-red-600';
    if (mtone === 'warn') return 'text-amber-600';
    return 'text-foreground';
  };

  const lastCycleSummary = lastCycle?.stats
    ? t('integrations.qbo.sync.lastCycleSummary', {
        ops: lastCycle.stats.opsProcessed ?? 0,
        payments: lastCycle.stats.paymentsApplied ?? 0,
        defaultValue: `${lastCycle.stats.opsProcessed ?? 0} ops · ${lastCycle.stats.paymentsApplied ?? 0} payments`
      })
    : t('integrations.qbo.sync.notSynced', { defaultValue: 'Not synced yet' });

  const lastSyncedTime = lastCycle?.finished_at
    ? new Date(lastCycle.finished_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null;
  const heroSyncSuffix = lastSyncedTime
    ? ` · ${t('integrations.qbo.sync.lastSyncedShort', { time: lastSyncedTime, defaultValue: `Last synced ${lastSyncedTime}` })} · ${statusMeta.label}`
    : null;

  return (
    <section id="qbo-integration-sync-health-card" className="space-y-6">
      {attnMount ? createPortal(attentionStrip, attnMount) : attentionStrip}
      {suffixMount && heroSyncSuffix ? createPortal(heroSyncSuffix, suffixMount) : null}

      {syncNowFeedback && (
        <Alert variant={syncNowFeedback.type === 'success' ? 'success' : 'destructive'}>
          <AlertDescription>{syncNowFeedback.message}</AlertDescription>
        </Alert>
      )}

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

      {(tokenExpired || tokenExpiringSoon) && (
        <Alert variant={tokenExpired ? 'destructive' : 'warning'}>
          <AlertDescription>
            {tokenExpired
              ? t('integrations.qbo.sync.refreshTokenExpired', { defaultValue: 'QuickBooks token expired — reconnect to resume syncing.' })
              : t('integrations.qbo.sync.refreshTokenExpirySoon', { date: tokenDate, defaultValue: `QuickBooks token expires ${tokenDate} — reconnect soon to avoid interruption.` })}
          </AlertDescription>
        </Alert>
      )}

      {/* Sync activity — borderless inline "glance" */}
      <div className="space-y-4">
        <GroupHeader
          title={t('integrations.qbo.sync.activityTitle', { defaultValue: 'Sync activity' })}
          action={
            <span className="text-xs font-normal normal-case tracking-normal text-muted-foreground">
              {t('integrations.qbo.sync.runsEvery', { defaultValue: 'Runs every 15 min when on' })}
            </span>
          }
        />
        <div className="flex flex-wrap gap-y-3">
          {metrics.map((m) => (
            <div key={m.label} className="mr-[26px] border-r border-border pr-[26px]">
              <div className="text-xs text-muted-foreground">{m.label}</div>
              <div className={`mt-0.5 text-xl font-semibold ${metricToneClass(m.value, m.tone)}`}>
                {m.href && m.value > 0 ? (
                  <Link href={m.href} className="underline underline-offset-2">{m.value}</Link>
                ) : (
                  m.value
                )}
              </div>
            </div>
          ))}
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">{t('integrations.qbo.sync.lastCycle', { defaultValue: 'Last cycle' })}</div>
            <div className="mt-0.5 text-sm font-medium text-muted-foreground">{lastCycleSummary}</div>
          </div>
        </div>
        {tokenExpiresAt && !tokenExpired && !tokenExpiringSoon && (
          <p className="text-xs text-muted-foreground">
            {t('integrations.qbo.sync.tokenValidUntil', { date: tokenDate, defaultValue: `Connection valid until ${tokenDate}` })}
          </p>
        )}
      </div>

      {/* Multi-realm list */}
      {multiRealm && (
        <div id="qbo-realm-list" className="space-y-3">
          <GroupHeader title={t('integrations.qbo.sync.connectedCompanies', { defaultValue: 'Connected companies' })} />
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

      {/* Sync configuration */}
      {health.connected && (
        <div id="qbo-sync-config-section" className="space-y-3">
          <GroupHeader title={t('integrations.qbo.sync.configTitle', { defaultValue: 'Sync configuration' })} />
          <p className="-mt-1 text-sm text-muted-foreground">
            {t('integrations.qbo.sync.configDescription', { defaultValue: 'Defaults applied to documents Alga posts into QuickBooks.' })}
          </p>
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
