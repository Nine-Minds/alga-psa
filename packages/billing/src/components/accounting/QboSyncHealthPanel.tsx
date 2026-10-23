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
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import {
  getAccountingSyncHealth,
  updateAccountingSyncSettingsAction,
  runAccountingSyncNow,
  setDefaultAccountingRealm,
} from '../../actions/accountingSyncActions';
import type { AccountingSyncHealth } from '../../actions/accountingSyncActions';
// eslint-disable-next-line custom-rules/no-feature-to-feature-imports -- billing-owned panel is slot-injected into the integrations settings page and reads the QBO catalogs directly (same bridge as the accounting export adapter)
import { getQboAccounts, getQboClasses, getQboDepartments } from '@alga-psa/integrations/actions/qboActions';
// eslint-disable-next-line custom-rules/no-feature-to-feature-imports -- type-only import for the QBO catalog shapes above
import type { QboAccount, QboClass, QboDepartment } from '@alga-psa/integrations/actions/qboActions';
// eslint-disable-next-line custom-rules/no-feature-to-feature-imports -- billing panel gates its controls on the same capability hook the integrations settings panels use
import { useAccountingCapabilities } from '@alga-psa/integrations/components/settings/integrations/useAccountingCapabilities';

interface SyncHealthPanelProps {
  adapterType?: 'quickbooks_online' | 'xero';
}

export default function QboSyncHealthPanel(props: SyncHealthPanelProps) {
  return <SyncHealthPanel key={props.adapterType ?? 'default'} {...props} />;
}

function SyncHealthPanel({ adapterType }: SyncHealthPanelProps) {
  const { t } = useTranslation('msp/integrations');
  const caps = useAccountingCapabilities();
  const canManageConnections = caps.connectionsManage;
  const canExecuteExports = caps.exportsExecute;

  const [health, setHealth] = React.useState<AccountingSyncHealth | null>(null);
  const [healthHidden, setHealthHidden] = React.useState(false);
  const [syncNowRunning, setSyncNowRunning] = React.useState(false);
  const [syncNowFeedback, setSyncNowFeedback] = React.useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [autoSyncToggling, setAutoSyncToggling] = React.useState(false);
  const [autoProvisionToggling, setAutoProvisionToggling] = React.useState(false);

  // Sync config catalog data
  const [accounts, setAccounts] = React.useState<QboAccount[]>([]);
  const [classes, setClasses] = React.useState<QboClass[]>([]);
  const [departments, setDepartments] = React.useState<QboDepartment[]>([]);
  const [catalogLoaded, setCatalogLoaded] = React.useState(false);
  const [catalogError, setCatalogError] = React.useState<string | null>(null);
  const [savingRef, setSavingRef] = React.useState<string | null>(null);
  const isReturnedActionError = (value: unknown) =>
    isActionMessageError(value) || isActionPermissionError(value);

  const loadHealth = React.useCallback(async () => {
    if (healthHidden) return;
    try {
      const h = await getAccountingSyncHealth({ preferredAdapterType: adapterType });
      setHealth(h);
      window.dispatchEvent(
        new CustomEvent('accounting-sync-health-changed', {
          detail: {
            adapterType: h.adapterType,
            reconnectRequired: h.reconnectRequired,
            error: h.reconnectRequired ? h.lastCycle?.error ?? null : null
          }
        })
      );
    } catch {
      // CE / no permission — suppress the health card entirely
      setHealthHidden(true);
    }
  }, [healthHidden, adapterType]);

  React.useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  React.useEffect(() => {
    // The sync-configuration pickers are connection administration
    // (connections_manage), so only load the QBO catalogs they need when the
    // user can actually change those settings. Xero has no QBO catalog, so
    // never issue QBO requests for a Xero connection.
    const providerIsXero = health?.adapterType === 'xero';
    if (!health?.connected || providerIsXero || catalogLoaded || !canManageConnections) return;
    setCatalogError(null);
    Promise.all([
      getQboAccounts(),
      getQboClasses(),
      getQboDepartments()
    ]).then(([accts, cls, deps]) => {
      const errors = [accts, cls, deps]
        .filter(isReturnedActionError)
        .map(getErrorMessage);

      setAccounts(isReturnedActionError(accts) ? [] : accts);
      setClasses(isReturnedActionError(cls) ? [] : cls);
      setDepartments(isReturnedActionError(deps) ? [] : deps);
      setCatalogError(errors.length > 0 ? errors.join(' ') : null);
      setCatalogLoaded(true);
    }).catch(() => {
      setCatalogError(t('integrations.qbo.sync.catalogLoadError', { defaultValue: 'Failed to load QuickBooks sync configuration options.' }));
      setCatalogLoaded(true);
    });
  }, [health?.connected, health?.adapterType, catalogLoaded, canManageConnections, t]);

  if (healthHidden || !health) {
    return null;
  }

  const defaultRealm = health.realms.find((r) => r.isDefault)?.realmId ?? null;
  const multiRealm = health.realms.length > 1;
  const isXero = health.adapterType === 'xero';
  const providerLabel = isXero ? 'Xero' : 'QuickBooks';
  const nonzeroCounts = [
    { value: health.pendingOps, label: t('integrations.qbo.sync.pendingOps', { defaultValue: 'Pending ops' }) },
    { value: health.erroredOps, label: t('integrations.qbo.sync.erroredOps', { defaultValue: 'Errored ops' }) },
    { value: health.driftCount, label: t('integrations.qbo.sync.driftCount', { defaultValue: 'Drift' }) },
    { value: health.openExceptions, label: t('integrations.qbo.sync.openExceptions', { defaultValue: 'Open exceptions' }), href: '/msp/user-activities' }
  ].filter((item) => item.value > 0);

  return (
    <Card id="qbo-integration-sync-health-card">
      <CardHeader>
        <CardTitle>{t('integrations.qbo.sync.healthCardTitleProvider', { provider: providerLabel, defaultValue: '{{provider}} sync activity' })}</CardTitle>
        <CardDescription>
          {t('integrations.qbo.sync.healthCardDescriptionProvider', {
            provider: providerLabel,
            defaultValue: 'Review recent {{provider}} activity, outstanding items, and automatic sync settings.'
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!health.connected && (
          <Alert variant="destructive">
            <AlertDescription>{t('integrations.qbo.sync.connectionUnavailableProvider', {
              provider: providerLabel,
              defaultValue: '{{provider}} connection is unavailable. Reconnect to resume syncing.'
            })}</AlertDescription>
          </Alert>
        )}
        {catalogError && (
          <Alert variant="destructive">
            <AlertDescription>{catalogError}</AlertDescription>
          </Alert>
        )}

        <>
          {/* Last cycle */}
          <div className="rounded-lg border bg-muted/20 p-4 space-y-2 text-sm">
            <p className="font-medium text-foreground">
              {t('integrations.qbo.sync.lastCycleTitle', { defaultValue: 'Most recent sync' })}
            </p>
            {health.lastCycle ? (
              <div className="space-y-1">
                <div className="flex flex-wrap gap-2 items-center">
                  <Badge variant={health.lastCycle.status === 'succeeded' ? 'success' : health.lastCycle.status === 'failed' ? 'error' : 'secondary'}>
                    {health.lastCycle.status === 'succeeded'
                      ? t('integrations.qbo.sync.syncSucceeded', { defaultValue: 'Sync completed' })
                      : t('integrations.qbo.sync.syncStopped', { defaultValue: 'Sync stopped' })}
                  </Badge>
                  {health.lastCycle.finished_at && (
                    <span className="text-muted-foreground text-xs">
                      {new Date(health.lastCycle.finished_at).toLocaleString()}
                    </span>
                  )}
                </div>
                {health.lastCycle.error && !health.reconnectRequired && (
                  <Alert variant="destructive"><AlertDescription>{health.lastCycle.error}</AlertDescription></Alert>
                )}
                {health.lastCycle.stats?.truncated && (
                  <Alert variant="destructive"><AlertDescription>{t('integrations.qbo.sync.syncIncomplete', {
                    defaultValue: 'Sync is incomplete. The cursor was preserved because the provider returned a partial change set.'
                  })}</AlertDescription></Alert>
                )}
                {health.lastCycle.stats && (
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    {(health.lastCycle.stats.opsProcessed ?? 0) > 0 && (
                      <span>
                        {t('integrations.qbo.sync.statOpsProcessed', {
                          count: health.lastCycle.stats.opsProcessed,
                          defaultValue: `${health.lastCycle.stats.opsProcessed} ops processed`,
                        })}
                      </span>
                    )}
                    {(health.lastCycle.stats.driftFound ?? 0) > 0 && (
                      <span>
                        {t('integrations.qbo.sync.statDriftFound', {
                          count: health.lastCycle.stats.driftFound,
                          defaultValue: `${health.lastCycle.stats.driftFound} drift`,
                        })}
                      </span>
                    )}
                    {(health.lastCycle.stats.paymentsApplied ?? 0) > 0 && (
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
            {!health.reconnectRequired ? (
              <p className="text-xs text-muted-foreground">
                {t('integrations.qbo.sync.nextRunHint', { defaultValue: 'Runs automatically every 15 minutes when automatic sync is on.' })}
              </p>
            ) : null}
          </div>

          {/* Counts row */}
          {nonzeroCounts.length > 0 ? (
            <div className="space-y-2">
              <div>
                <p className="text-sm font-medium text-foreground">{t('integrations.qbo.sync.outstandingItems', { defaultValue: 'Outstanding items' })}</p>
                <p className="text-xs text-muted-foreground">
                  {health.reconnectRequired
                    ? t('integrations.qbo.sync.outstandingItemsReconnect', { defaultValue: 'Across all linked organisations. These items are preserved until you reconnect Xero.' })
                    : t('integrations.qbo.sync.outstandingItemsDescription', { defaultValue: 'Items that still need review or another sync attempt.' })}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 text-sm">
                {nonzeroCounts.map((item) => (
                  <div key={item.label} className="rounded border bg-muted/10 p-3 text-center">
                    <div className="text-2xl font-semibold">
                      {item.href ? <Link href={item.href} className="underline">{item.value}</Link> : item.value}
                    </div>
                    <div className="text-xs text-muted-foreground">{item.label}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

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

          {/* Refresh token expiry / reconnect-required */}
          {!health.reconnectRequired && health.refreshTokenExpiresAt && (() => {
            const expiresMs = new Date(health.refreshTokenExpiresAt!).getTime() - Date.now();
            const expired = expiresMs <= 0;
            const expiresDate = new Date(health.refreshTokenExpiresAt!).toLocaleDateString();
            return expired ? (
              <Alert variant="destructive">
                <AlertDescription>
                  {t('integrations.qbo.sync.refreshTokenExpiredProvider', { provider: providerLabel, defaultValue: '{{provider}} token expired — reconnect to resume syncing.' })}
                </AlertDescription>
              </Alert>
            ) : (
              <p id="accounting-token-valid-until" className="text-xs text-muted-foreground">
                {t('integrations.qbo.sync.refreshTokenValidUntilProvider', {
                  provider: providerLabel,
                  date: expiresDate,
                  defaultValue: '{{provider}} authorization valid until {{date}}. Tokens refresh automatically.'
                })}
              </p>
            );
          })()}

          {/* The default-organisation action validates the selected provider. */}
          {multiRealm && (
            <div id="qbo-realm-list" className="rounded-lg border p-4 space-y-2 text-sm">
              <p className="font-medium text-foreground">
                {isXero
                  ? t('integrations.qbo.sync.connectedOrganisations', { defaultValue: 'Xero organisations' })
                  : t('integrations.qbo.sync.connectedCompanies', { defaultValue: 'Connected Companies' })}
              </p>
              {isXero ? (
                <p className="text-xs text-muted-foreground">
                  {t('integrations.qbo.sync.defaultOrganisationDescription', { defaultValue: 'The default organisation is used for sync, exports, and mappings.' })}
                </p>
              ) : null}
              <div className="space-y-2">
                {health.realms.map((realm) => (
                  <div key={realm.realmId} className="flex items-center justify-between gap-2">
                    <span className="text-sm text-foreground">{realm.displayName || realm.realmId}</span>
                    {realm.isDefault ? (
                      <Badge variant="secondary">
                        {t('integrations.qbo.sync.defaultRealm', { defaultValue: 'Default' })}
                      </Badge>
                    ) : canManageConnections ? (
                      <Button
                        id={`qbo-make-default-${realm.realmId}`}
                        variant="outline"
                        size="sm"
                        disabled={savingRef === realm.realmId}
                        onClick={async () => {
                          setSavingRef(realm.realmId);
                          try {
                            const providerType = health.adapterType === 'xero' ? 'xero' : 'quickbooks_online';
                            const result = await setDefaultAccountingRealm(providerType, realm.realmId);
                            if (!result.success) throw new Error(result.error ?? t('integrations.qbo.sync.defaultRealmError', {
                              defaultValue: 'Could not select this organisation. Reconnect and try again.'
                            }));
                            await loadHealth();
                            window.dispatchEvent(
                              new CustomEvent('accounting-default-realm-changed', {
                                detail: { adapterType: providerType, realmId: realm.realmId }
                              })
                            );
                          } catch (error) {
                            setSyncNowFeedback({ type: 'error', message: getErrorMessage(error) });
                          } finally {
                            setSavingRef(null);
                          }
                        }}
                      >
                        {savingRef === realm.realmId
                          ? t('integrations.qbo.sync.saving', { defaultValue: 'Saving…' })
                          : t('integrations.qbo.sync.makeDefault', { defaultValue: 'Make default' })}
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sync configuration: deposit / class / department pickers. These
              write QBO connection settings, so they are QBO-only and connection
              administration (connections_manage). */}
          {health.connected && canManageConnections && !isXero && (
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

          {/* Auto-sync toggle (connection administration — connections_manage) */}
          {canManageConnections && (
            <div className="flex items-center justify-between">
              <label htmlFor="qbo-sync-auto-sync-toggle" className="text-sm font-medium">
                {t('integrations.qbo.sync.autoSyncLabel', { defaultValue: 'Automatic sync' })}
              </label>
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
          )}

          {/* Customer auto-provisioning toggle (connection administration — connections_manage) */}
          {canManageConnections && (
            <div className="flex items-center justify-between">
              <div className="pr-4">
                <span className="text-sm font-medium">
                  {t('integrations.qbo.sync.autoProvisionCustomersLabelProvider', {
                    provider: providerLabel,
                    defaultValue: 'Create {{provider}} customers automatically'
                  })}
                </span>
                <p className="text-xs text-muted-foreground">
                  {t('integrations.qbo.sync.autoProvisionCustomersHint', {
                    defaultValue:
                      'Off: exports for unmapped customers pause with an exception until you link them in the customer mapping screen.'
                  })}
                </p>
              </div>
              <Switch
                id="qbo-sync-auto-provision-toggle"
                checked={Boolean(health.settings.autoProvisionCustomers)}
                disabled={autoProvisionToggling}
                onCheckedChange={async (checked) => {
                  setAutoProvisionToggling(true);
                  try {
                    const updated = await updateAccountingSyncSettingsAction({ autoProvisionCustomers: checked });
                    setHealth((prev) => prev ? { ...prev, settings: updated } : prev);
                  } catch {
                    // Silently ignore — badge state stays as-is
                  } finally {
                    setAutoProvisionToggling(false);
                  }
                }}
              />
            </div>
          )}
        </>
      </CardContent>
      <CardFooter className="flex-wrap gap-3">
        <Button
          id="qbo-sync-now-button"
          type="button"
          variant="outline"
          disabled={syncNowRunning || savingRef !== null || !canExecuteExports || !health.connected || !defaultRealm}
          onClick={async () => {
            if (!canExecuteExports) return;
            setSyncNowRunning(true);
            setSyncNowFeedback(null);
            try {
              const result = await runAccountingSyncNow({
                preferredAdapterType: health.adapterType === 'xero' ? 'xero' : 'quickbooks_online',
                preferredTargetRealm: defaultRealm ?? undefined
              });
              if (result.ran && result.status === 'succeeded' && !result.stats?.truncated && !result.stats?.opsFailed) {
                setSyncNowFeedback({ type: 'success', message: t('integrations.qbo.sync.syncNowSuccess', { defaultValue: 'Sync completed successfully.' }) });
              } else if (result.ran) {
                const message = result.error ?? (result.stats?.truncated
                  ? t('integrations.qbo.sync.syncIncomplete', { defaultValue: 'Sync is incomplete. The cursor was preserved because the provider returned a partial change set.' })
                  : result.stats?.opsFailed
                    ? t('integrations.qbo.sync.syncOperationsFailed', { defaultValue: 'Some accounting operations failed. Review the sync errors before retrying.' })
                    : result.status);
                setSyncNowFeedback({ type: 'error', message });
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
        {syncNowFeedback ? (
          <Alert
            id="qbo-sync-now-feedback"
            className="min-w-64 flex-1"
            variant={syncNowFeedback.type === 'success' ? 'success' : 'destructive'}
            role={syncNowFeedback.type === 'success' ? 'status' : 'alert'}
            aria-live={syncNowFeedback.type === 'success' ? 'polite' : 'assertive'}
          >
            <AlertDescription>{syncNowFeedback.message}</AlertDescription>
          </Alert>
        ) : null}
      </CardFooter>
    </Card>
  );
}
