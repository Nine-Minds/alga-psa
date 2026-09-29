'use client';

import React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { CheckCircle2, ExternalLink, KeyRound } from 'lucide-react';
import { disconnectXero, forceFinalizeXeroDisconnect, getXeroConnectionStatus, saveXeroCredentials } from '../../../actions/integrations/xeroActions';
import { XeroLiveMappingManager } from '../../xero/XeroLiveMappingManager';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useAccountingCapabilities } from './useAccountingCapabilities';

type XeroStatus = Awaited<ReturnType<typeof getXeroConnectionStatus>>;
type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

function describeCallbackError(code: string | null, t: TranslateFn): string | null {
  switch (code) {
    case 'config_missing':
      return t('integrations.xero.settings.callback.configMissing', {
        defaultValue: 'Xero OAuth could not start because the tenant client ID and client secret were not fully configured.'
      });
    case 'no_connections':
      return t('integrations.xero.settings.callback.noConnections', {
        defaultValue: 'Xero did not return any organisations for this login. Check your Xero app and organisation access, then try again.'
      });
    case 'connections_unmapped':
      return t('integrations.xero.settings.callback.connectionsUnmapped', {
        defaultValue: 'Xero returned organisations, but none included the identifiers required to save a connection.'
      });
    case 'oauth_failed':
      return t('integrations.xero.settings.callback.oauthFailed', {
        defaultValue: 'The Xero OAuth callback failed. Try connecting again. If the problem persists, review your redirect URI and scopes.'
      });
    case 'invalid_state':
      return t('integrations.xero.settings.callback.invalidState', {
        defaultValue: 'The Xero OAuth state was invalid or expired. Start the connect flow again.'
      });
    case 'state_replayed':
      return t('integrations.xero.settings.callback.stateReplayed', {
        defaultValue: 'This Xero connection request was already used. Start the connect flow again.'
      });
    case 'session_expired':
      return t('integrations.xero.settings.callback.sessionExpired', {
        defaultValue: 'Your session is no longer valid. Sign in and start the Xero connection again.'
      });
    case 'user_mismatch':
      return t('integrations.xero.settings.callback.userMismatch', {
        defaultValue: 'This Xero connection request belongs to another user. Sign in as the user who started it and try again.'
      });
    case 'tenant_mismatch':
      return t('integrations.xero.settings.callback.tenantMismatch', {
        defaultValue: 'This Xero connection request belongs to another workspace. Sign in to the correct workspace and start again.'
      });
    case 'forbidden':
      return t('integrations.xero.settings.callback.forbidden', {
        defaultValue: 'You no longer have permission to manage accounting connections. Ask an administrator for access.'
      });
    case 'missing_params':
      return t('integrations.xero.settings.callback.missingParams', {
        defaultValue: 'The Xero callback was missing required parameters. Start the connect flow again.'
      });
    case 'access_denied':
      return t('integrations.xero.settings.callback.accessDenied', {
        defaultValue: 'Xero access was denied before the connection completed.'
      });
    case 'disconnect_in_progress':
      return t('integrations.xero.settings.callback.disconnectInProgress', {
        defaultValue: 'Xero is being disconnected. Finish or finalize the disconnect before connecting again.'
      });
    default:
      return code
        ? t('integrations.xero.settings.callback.generic', {
            defaultValue: 'Xero returned an OAuth error: {{code}}',
            code
          })
        : null;
  }
}

function statusBadgeVariant(status?: 'connected' | 'expired'): 'success' | 'secondary' | 'error' {
  if (status === 'expired') {
    return 'error';
  }
  if (status === 'connected') {
    return 'success';
  }
  return 'secondary';
}

export default function XeroIntegrationSettings({ syncHealthSlot }: { syncHealthSlot?: React.ReactNode } = {}) {
  const { t } = useTranslation('msp/integrations');
  const caps = useAccountingCapabilities();
  const searchParams = useSearchParams();
  const [status, setStatus] = React.useState<XeroStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [disconnecting, setDisconnecting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);
  const [clientId, setClientId] = React.useState('');
  const [clientSecret, setClientSecret] = React.useState('');
  const [editingCredentials, setEditingCredentials] = React.useState(false);
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = React.useState(false);
  const [syncIssue, setSyncIssue] = React.useState<{ reconnectRequired: boolean; error: string | null } | null>(null);

  const oauthStatus = searchParams?.get('xero_status');
  const oauthError = React.useMemo(() => describeCallbackError(searchParams?.get('xero_error') ?? null, t), [searchParams, t]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getXeroConnectionStatus();
      setStatus(result);
      return result;
    } catch (err) {
      setError(
        t('integrations.xero.settings.errors.load', {
          defaultValue: 'Failed to load Xero settings.'
        })
      );
      return null;
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    if (oauthStatus) return;
    void load();
  }, [load, oauthStatus]);

  React.useEffect(() => {
    const handleHealthChange = (event: Event) => {
      const detail = (event as CustomEvent<{ adapterType?: string | null; reconnectRequired?: boolean; error?: string | null }>).detail;
      if (detail?.adapterType !== 'xero') return;
      setSyncIssue({
        reconnectRequired: Boolean(detail.reconnectRequired),
        error: detail.error ?? null
      });
    };
    window.addEventListener('accounting-sync-health-changed', handleHealthChange);
    return () => window.removeEventListener('accounting-sync-health-changed', handleHealthChange);
  }, []);

  // The sync-health panel writes the same persisted default the settings panel
  // reads, so a default change must refresh this panel's status, catalog and
  // mapping context without a full page reload.
  React.useEffect(() => {
    const reload = () => {
      void load();
    };
    window.addEventListener('accounting-default-realm-changed', reload);
    return () => window.removeEventListener('accounting-default-realm-changed', reload);
  }, [load]);

  React.useEffect(() => {
    if (!oauthStatus) return;

    let cancelled = false;
    const consumeOauthResult = async () => {
      if (oauthStatus === 'success') {
        const result = await load();
        if (!cancelled && result) {
          if (result.connected && result.defaultConnection) {
            setSuccessMessage(
              t('integrations.xero.settings.connectSuccess', {
                count: result.connections.length,
                organisation: result.defaultConnection.tenantName ?? result.defaultConnection.xeroTenantId,
                defaultValue: 'Xero connected. {{count}} organisations linked; {{organisation}} is the default for sync.'
              })
            );
          } else {
            setError(
              t('integrations.xero.settings.connectNeedsAttention', {
                defaultValue: 'Xero authorization completed, but the connection still needs attention. Sync remains paused.'
              })
            );
          }
        }
      } else if (oauthStatus === 'failure' && oauthError) {
        setError(oauthError);
      }

      if (!cancelled) {
        const nextUrl = new URL(window.location.href);
        nextUrl.searchParams.delete('xero_status');
        nextUrl.searchParams.delete('xero_error');
        window.history.replaceState({}, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
      }
    };

    void consumeOauthResult();
    return () => {
      cancelled = true;
    };
  }, [load, oauthError, oauthStatus, t]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const result = await saveXeroCredentials({
        clientId,
        clientSecret
      });

      if (!result.success) {
        setError(
          result.error ??
            t('integrations.xero.settings.errors.saveCredentials', {
              defaultValue: 'Failed to save Xero credentials.'
            })
        );
        return;
      }

      setClientId('');
      setClientSecret('');
      setEditingCredentials(false);
      setSuccessMessage(
        t('integrations.xero.settings.credentialsSaved', {
          defaultValue: 'Xero credentials saved. You can now start the live Xero OAuth flow.'
        })
      );
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const result = await disconnectXero();
      if (result.status === 'disconnected') {
        setSuccessMessage(
          t('integrations.xero.settings.disconnectSuccess', {
            defaultValue: 'The stored Xero connection was removed. Tenant-owned Xero app credentials were preserved.'
          })
        );
        await load();
        return;
      }

      if (result.status === 'pending' || result.status === 'partial') {
        setSuccessMessage(
          t('integrations.xero.settings.disconnectPending', {
            defaultValue: 'Xero is being disconnected. Sync and exports are paused until provider cleanup completes; the disconnect keeps retrying automatically.'
          })
        );
        await load();
        return;
      }

      if (result.status === 'failed_permanent') {
        setError(
          result.error ??
            t('integrations.xero.settings.errors.disconnect', {
              defaultValue: 'Failed to disconnect Xero.'
            })
        );
        await load();
        return;
      }

      setError(
        result.error ??
          t('integrations.xero.settings.errors.disconnect', {
            defaultValue: 'Failed to disconnect Xero.'
          })
      );
    } finally {
      setDisconnecting(false);
    }
  };

  const handleRetryDisconnect = async () => {
    await handleDisconnect();
  };

  const handleForceFinalize = async () => {
    const reason = window.prompt(
      t('integrations.xero.settings.disconnect.forceFinalizePrompt', {
        defaultValue: 'Reason for force-finalizing the Xero disconnect (recorded in the audit log):'
      })
    );
    if (!reason?.trim()) return;

    setDisconnecting(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const result = await forceFinalizeXeroDisconnect({
        reason: reason.trim()
      });
      if (!result.success) {
        setError(
          result.error ??
            t('integrations.xero.settings.errors.disconnect', {
              defaultValue: 'Failed to finalize the Xero disconnect.'
            })
        );
        return;
      }
      setSuccessMessage(
        t('integrations.xero.settings.disconnectForceFinalized', {
          defaultValue: 'The Xero disconnect was force-finalized. Provider cleanup could not be confirmed, so the credentials were removed locally with an audit record.'
        })
      );
      await load();
    } finally {
      setDisconnecting(false);
    }
  };

  const readyToSave = clientId.trim().length > 0 && clientSecret.trim().length > 0;
  const canConnect = Boolean(status?.credentials.ready);
  const defaultConnection = status?.defaultConnection;
  const canManageConnections = caps.connectionsManage;
  const canManageMappings = caps.mappingsManage;
  const disconnectPending = Boolean(status?.disconnect && status.disconnect.status !== 'finalized');
  const disconnectFailedPermanent = status?.disconnect?.status === 'failed_permanent';
  const reconnectRequired = defaultConnection?.status === 'expired' || Boolean(syncIssue?.reconnectRequired);

  React.useEffect(() => {
    window.dispatchEvent(
      new CustomEvent('xero-connection-status-changed', {
        detail: { reconnectRequired }
      })
    );
  }, [reconnectRequired]);

  // Wait for the capability check to resolve before hiding the panel, so a
  // capable user never sees a brief "no permission" card while it loads.
  if (caps.loaded && !caps.hasAny) {
    return (
      <div className="space-y-6" id="xero-integration-settings">
        <Card id="xero-integration-no-permission-card">
          <CardHeader>
            <CardTitle>{t('integrations.xero.settings.title', { defaultValue: 'Xero' })}</CardTitle>
            <CardDescription>
              {t('integrations.xero.settings.noPermissionDescription', {
                defaultValue: 'You do not have permission to view or configure accounting integrations.'
              })}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }
  return (
    <div className="space-y-6" id="xero-integration-settings">
      {successMessage ? (
        <Alert variant="success">
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {caps.loaded && !canManageConnections ? (
        <Alert variant="info" id="xero-connection-manage-permission-notice">
          <AlertDescription>
            {t('integrations.xero.settings.connectionsPermissionNotice', {
              defaultValue: 'You can view Xero settings, but saving credentials, connecting, and disconnecting require the manage-connections capability. Ask an administrator to grant it.'
            })}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card id="xero-integration-connection-card">
        <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
          <div className="space-y-1.5">
            <CardTitle>
              {t('integrations.xero.settings.connection.title', {
                defaultValue: 'Xero connection'
              })}
            </CardTitle>
            <CardDescription>
              {t('integrations.xero.settings.connection.description', {
                defaultValue: 'One Xero authorization links these organisations to Alga PSA.'
              })}
            </CardDescription>
          </div>
          {!loading && !reconnectRequired ? (
            <Badge size="lg" variant={defaultConnection ? statusBadgeVariant(defaultConnection.status) : 'secondary'}>
              {defaultConnection
                  ? t('integrations.xero.settings.badges.defaultConnected', {
                      defaultValue: 'Connected'
                    })
                  : t('integrations.xero.settings.badges.noOrganisation', {
                      defaultValue: 'Not connected'
                    })}
            </Badge>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="text-sm text-muted-foreground">
              {t('integrations.xero.settings.loading', {
                defaultValue: 'Checking the Xero connection…'
              })}
            </div>
          ) : null}

          {status?.disconnect && status.disconnect.status !== 'finalized' ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-500/10" id="xero-disconnect-progress">
              <p className="text-sm font-medium text-foreground">
                {t('integrations.xero.settings.disconnect.inProgressTitle', {
                  defaultValue: 'Xero disconnect in progress'
                })}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('integrations.xero.settings.disconnect.inProgressDescription', {
                  defaultValue: 'Provider connections are being revoked. Sync and exports stay paused until every connection is confirmed removed.'
                })}
              </p>
              <ul className="mt-3 space-y-1.5 text-xs">
                {status.disconnect.targets.map((target) => (
                  <li key={target.targetId} className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono">
                      {target.targetId === '__xero_oauth_grant__' ? t('integrations.xero.settings.disconnect.grantTarget', { defaultValue: 'OAuth grant revocation' }) : target.targetId}
                    </span>
                    <Badge variant={target.status === 'revoked' ? 'success' : target.status === 'failed_permanent' ? 'error' : 'secondary'}>
                      {target.status === 'revoked'
                        ? t('integrations.xero.settings.disconnect.targetRevoked', { defaultValue: 'revoked' })
                        : target.status === 'failed_permanent'
                          ? t('integrations.xero.settings.disconnect.targetFailed', { defaultValue: 'needs attention' })
                          : t('integrations.xero.settings.disconnect.targetPending', { defaultValue: 'pending' })}
                    </Badge>
                  </li>
                ))}
              </ul>
              {status.disconnect.status === 'failed_permanent' ? (
                <Alert variant="destructive" className="mt-3">
                  <AlertDescription>
                    {t('integrations.xero.settings.disconnect.failedPermanentDescription', {
                      defaultValue: 'Provider cleanup hit a permanent error. You can retry, or force-finalize to remove the stored credentials with an audit record.'
                    })}
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : null}

          {defaultConnection ? (
            <div className="rounded-lg border bg-muted/20 p-5 text-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('integrations.xero.settings.connection.linkedOrganisations', {
                  count: status?.connections.length ?? 0,
                  defaultValue: 'Linked organisations ({{count}})'
                })}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {t('integrations.xero.settings.connection.organisationScope', {
                  defaultValue: 'Reconnect and disconnect apply to every organisation in this list.'
                })}
              </p>
              <ul className="mt-3 divide-y rounded-md border bg-background">
                {status?.connections.map((connection) => (
                  <li key={connection.connectionId} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <span className="font-medium text-foreground">{connection.tenantName || connection.xeroTenantId}</span>
                    {connection.connectionId === status.defaultConnectionId ? (
                      <Badge variant="secondary">
                        {t('integrations.xero.settings.connection.defaultBadge', { defaultValue: 'Default for sync' })}
                      </Badge>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : status?.errorCode === 'SELECTION_AMBIGUOUS' ? null : (
            <Alert variant="info">
              <AlertDescription>
                {t('integrations.xero.settings.connection.notConnected', {
                  defaultValue: 'No live Xero organisation is connected yet. Save credentials, then click Connect Xero.'
                })}
              </AlertDescription>
            </Alert>
          )}

          {reconnectRequired ? (
            <Alert variant="destructive" id="xero-reconnect-required-alert">
              <AlertTitle>{t('integrations.xero.settings.connection.reconnectRequiredTitle', { defaultValue: 'Connection expired' })}</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>
                  {t('integrations.xero.settings.connection.reconnectRequiredDescription', {
                    count: status?.connections.length ?? 0,
                    defaultValue: 'Sync and exports are paused. Reconnect once to resume them for all {{count}} linked organisations.'
                  })}
                </p>
                <Button
                  id="xero-reconnect-required-button"
                  type="button"
                  disabled={!canConnect || !canManageConnections || disconnectPending}
                  onClick={() => window.location.assign('/api/integrations/xero/connect')}
                >
                  {t('integrations.xero.settings.actions.reconnect', { defaultValue: 'Reconnect Xero' })}
                </Button>
              </AlertDescription>
            </Alert>
          ) : status?.error && (defaultConnection || status?.errorCode === 'SELECTION_AMBIGUOUS') ? (
            <Alert variant={status.connected ? 'info' : 'destructive'}>
              <AlertDescription>{status.error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-4 border-t bg-muted/10">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            {!defaultConnection ? (
              <Button
                id="xero-connect-button"
                type="button"
                disabled={!canConnect || !canManageConnections || disconnectPending}
                onClick={() => window.location.assign('/api/integrations/xero/connect')}
              >
                {t('integrations.xero.settings.actions.connect', { defaultValue: 'Connect Xero' })}
              </Button>
            ) : null}
            {caps.exportsExecute && !reconnectRequired ? (
              <Button id="xero-open-accounting-exports" asChild>
                <Link href="/msp/billing?tab=accounting-exports" className="inline-flex items-center gap-2">
                  {t('integrations.csv.settings.exports.openButton', {
                    defaultValue: 'Open Accounting Exports'
                  })}
                  <ExternalLink className="h-4 w-4 opacity-80" />
                </Link>
              </Button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-4">
            {defaultConnection ? (
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  {t('integrations.xero.settings.disconnect.dangerTitle', { defaultValue: 'Disconnect Xero' })}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('integrations.xero.settings.disconnect.dangerDescription', {
                    count: status?.connections.length ?? 0,
                    defaultValue: 'Stops sync and exports and removes all {{count}} linked organisations. App credentials remain saved.'
                  })}
                </p>
              </div>
            ) : null}
            {disconnectPending ? (
              <Button id="xero-retry-disconnect-button" type="button" variant="outline" disabled={disconnecting || !canManageConnections} onClick={() => void handleRetryDisconnect()}>
                {t('integrations.xero.settings.actions.retryDisconnect', {
                  defaultValue: 'Retry Disconnect'
                })}
              </Button>
            ) : null}
            {disconnectFailedPermanent ? (
              <Button id="xero-force-finalize-disconnect-button" type="button" variant="destructive" disabled={disconnecting || !canManageConnections} onClick={() => void handleForceFinalize()}>
                {t('integrations.xero.settings.actions.forceFinalizeDisconnect', { defaultValue: 'Force Finalize' })}
              </Button>
            ) : null}
            {defaultConnection || disconnectPending ? (
              <Button
                id="xero-disconnect-button"
                type="button"
                variant="outline"
                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={disconnecting || !canManageConnections}
                onClick={() => setDisconnectConfirmOpen(true)}
              >
                {disconnecting
                  ? t('integrations.xero.settings.actions.disconnecting', {
                      defaultValue: 'Disconnecting…'
                    })
                  : status?.connections.length && status.connections.length > 1
                    ? t('integrations.xero.settings.actions.disconnectAll', {
                        defaultValue: 'Disconnect all Xero organisations'
                      })
                    : t('integrations.xero.settings.actions.disconnect', {
                        defaultValue: 'Disconnect Xero'
                      })}
              </Button>
            ) : null}
          </div>
        </CardFooter>
      </Card>

      <ConfirmationDialog
        id="xero-disconnect-confirmation"
        isOpen={disconnectConfirmOpen}
        onClose={() => setDisconnectConfirmOpen(false)}
        onConfirm={async () => {
          await handleDisconnect();
          setDisconnectConfirmOpen(false);
        }}
        isConfirming={disconnecting}
        title={t('integrations.xero.settings.disconnect.confirmTitle', {
          defaultValue: 'Disconnect Xero from Alga PSA?'
        })}
        message={t('integrations.xero.settings.disconnect.confirmDescription', {
          organisations: status?.connections.map((connection) => connection.tenantName || connection.xeroTenantId).join(', ') ?? '',
          defaultValue: 'This disconnects {{organisations}} and pauses sync and exports. Your Xero app credentials will remain saved.'
        })}
        confirmLabel={
          status?.connections.length && status.connections.length > 1
            ? t('integrations.xero.settings.actions.disconnectAll', { defaultValue: 'Disconnect all Xero organisations' })
            : t('integrations.xero.settings.actions.disconnect', { defaultValue: 'Disconnect Xero' })
        }
        cancelLabel={t('integrations.accounting.dialog.cancel', { defaultValue: 'Cancel' })}
      />

      {defaultConnection ? syncHealthSlot : null}

      <Card id="xero-integration-credentials-card">
        <CardHeader>
          <CardTitle>
            {t('integrations.xero.settings.tenantOauthTitle', {
              defaultValue: 'Xero app credentials'
            })}
          </CardTitle>
          <CardDescription>
            {t('integrations.xero.settings.tenantOauthDescription', {
              defaultValue: 'Enter the Client ID and Client Secret from your Xero app. Alga PSA stores them securely.'
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {loading ? (
            <div className="text-sm text-muted-foreground">
              {t('integrations.xero.settings.loading', {
                defaultValue: 'Loading Xero settings…'
              })}
            </div>
          ) : (
            <>
              {status?.credentials.ready && !editingCredentials ? (
                <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-muted/20 p-4">
                  <div className="flex items-start gap-3">
                    <div className="rounded-full bg-success/10 p-2 text-success">
                      <CheckCircle2 className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{t('integrations.xero.settings.badges.credentialsReady', { defaultValue: 'Credentials saved' })}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t('integrations.xero.settings.credentialsStoredDescription', {
                          defaultValue: 'The Client ID and Client Secret are stored securely.'
                        })}
                      </p>
                    </div>
                  </div>
                  {canManageConnections ? (
                    <Button id="xero-replace-credentials" type="button" variant="outline" onClick={() => setEditingCredentials(true)}>
                      <KeyRound className="mr-2 h-4 w-4" />
                      {t('integrations.xero.settings.actions.replaceCredentials', { defaultValue: 'Replace credentials' })}
                    </Button>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-4">
                  {!status?.credentials.ready ? (
                    <Alert variant="info">
                      <AlertTitle>{t('integrations.xero.settings.badges.credentialsRequired', { defaultValue: 'Credentials required' })}</AlertTitle>
                      <AlertDescription>
                        {t('integrations.xero.settings.connection.notConnected', {
                          defaultValue: 'Add credentials from your Xero app before connecting an organisation.'
                        })}
                      </AlertDescription>
                    </Alert>
                  ) : null}

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="xero-client-id">
                        {t('integrations.xero.settings.clientIdLabel', {
                          defaultValue: 'Client ID'
                        })}
                      </Label>
                      <Input
                        id="xero-client-id"
                        value={clientId}
                        disabled={!canManageConnections}
                        onChange={(event) => setClientId(event.target.value)}
                        placeholder={t('integrations.xero.settings.clientIdPlaceholder', { defaultValue: 'Paste the Client ID from Xero' })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="xero-client-secret">
                        {t('integrations.xero.settings.clientSecretLabel', {
                          defaultValue: 'Client Secret'
                        })}
                      </Label>
                      <Input
                        id="xero-client-secret"
                        type="password"
                        value={clientSecret}
                        disabled={!canManageConnections}
                        onChange={(event) => setClientSecret(event.target.value)}
                        placeholder={t('integrations.xero.settings.clientSecretPlaceholder', { defaultValue: 'Paste the Client Secret from Xero' })}
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap justify-end gap-2">
                    {status?.credentials.ready ? (
                      <Button
                        id="xero-cancel-credentials"
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setClientId('');
                          setClientSecret('');
                          setEditingCredentials(false);
                        }}
                      >
                        {t('integrations.accounting.dialog.cancel', { defaultValue: 'Cancel' })}
                      </Button>
                    ) : null}
                    <Button id="xero-settings-save" type="button" onClick={() => void handleSave()} disabled={!readyToSave || saving || !canManageConnections}>
                      {saving
                        ? t('integrations.xero.settings.actions.saving', {
                            defaultValue: 'Saving…'
                          })
                        : t('integrations.xero.settings.actions.saveCredentials', { defaultValue: 'Save credentials' })}
                    </Button>
                  </div>
                </div>
              )}

              <details className="rounded-lg border px-4 py-3" id="xero-app-setup-details">
                <summary className="cursor-pointer text-sm font-medium text-foreground">
                  {t('integrations.xero.settings.howItWorksTitle', {
                    defaultValue: 'Xero app setup details'
                  })}
                </summary>
                <div className="mt-4 space-y-4 border-t pt-4">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {t('integrations.xero.settings.redirectUri', {
                        defaultValue: 'Redirect URI'
                      })}
                    </p>
                    <p className="mt-1 break-all rounded-md bg-muted/40 px-3 py-2 font-mono text-xs">{status?.redirectUri}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {t('integrations.xero.settings.requiredScopes', {
                        defaultValue: 'Permissions requested from Xero'
                      })}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {status?.scopes?.map((scope) => (
                        <Badge key={scope} variant="secondary">
                          {scope}
                        </Badge>
                      ))}
                      {status?.scopeSource === 'override' ? (
                        <Badge id="xero-scope-override-badge" variant="outline">
                          {t('integrations.xero.settings.scopeOverride', {
                            defaultValue: 'Deployment override (XERO_OAUTH_SCOPES)'
                          })}
                        </Badge>
                      ) : null}
                    </div>
                    {status?.scopeOverrideInvalid?.length ? (
                      <p id="xero-scope-override-invalid" className="mt-2 text-xs text-destructive">
                        {t('integrations.xero.settings.scopeOverrideInvalid', {
                          defaultValue: 'The XERO_OAUTH_SCOPES override was ignored because it contains invalid entries ({{scopes}}). The default scopes are used instead.',
                          scopes: status.scopeOverrideInvalid.join(', ')
                        })}
                      </p>
                    ) : null}
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t('integrations.xero.settings.scopeReconnectNote', {
                        defaultValue: 'Reconnect Xero after changing permissions. Token refreshes keep the permissions granted during the last authorization.'
                      })}
                    </p>
                  </div>
                </div>
              </details>

              <p className="text-sm text-muted-foreground">
                {t('integrations.xero.settings.csvAvailablePrefix', {
                  defaultValue: 'Prefer a file-based workflow?'
                })}{' '}
                <Link href="/msp/settings/integrations?category=accounting&accounting_integration=xero_csv" className="font-medium text-foreground underline underline-offset-4">
                  {t('integrations.xero.settings.xeroCsv', {
                    defaultValue: 'Use Xero CSV'
                  })}
                </Link>
                .
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {defaultConnection ? (
        <Card id="xero-integration-mapping-card">
          <CardHeader>
            <CardTitle>
              {t('integrations.xero.settings.mapping.title', {
                defaultValue: 'Live Xero Mapping & Configuration'
              })}
            </CardTitle>
            <CardDescription>
              {t('integrations.xero.settings.mapping.descriptionPrefix', {
                defaultValue: 'Configure live Xero mappings for the default connected organisation. These mappings are scoped to'
              })}{' '}
              <strong>{defaultConnection.tenantName || defaultConnection.xeroTenantId}</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="info">
              <AlertDescription>
                {t('integrations.xero.settings.mapping.alert', {
                  defaultValue:
                    'Xero items, revenue accounts, tax rates, and tracking categories are loaded from the selected default organisation, and mappings are saved against that connection so live exports and reconciliation use the same organisation.'
                })}
              </AlertDescription>
            </Alert>
            {canManageMappings ? (
              <XeroLiveMappingManager defaultConnection={defaultConnection} />
            ) : (
              <Alert variant="info" id="xero-mapping-permission-notice">
                <AlertDescription>
                  {t('integrations.xero.settings.mapping.permissionNotice', {
                    defaultValue: 'You can view the default connected organisation, but editing mappings requires the manage-mappings capability. Ask an administrator to grant it.'
                  })}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card id="xero-integration-mapping-placeholder-card">
          <CardHeader>
            <CardTitle>
              {t('integrations.xero.settings.mapping.title', {
                defaultValue: 'Live Xero Mapping & Configuration'
              })}
            </CardTitle>
            <CardDescription>
              {t('integrations.xero.settings.mapping.placeholderDescription', {
                defaultValue: 'Connect a live Xero organisation before configuring live Xero item and tax mappings.'
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Alert variant="info">
              <AlertDescription>
                {t('integrations.xero.settings.mapping.placeholderAlert', {
                  defaultValue: 'The mapping manager becomes available after the first Xero organisation is connected and set as the default live Xero context.'
                })}
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
