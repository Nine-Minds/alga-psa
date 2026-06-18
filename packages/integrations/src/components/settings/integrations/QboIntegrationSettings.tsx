'use client';

import React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Link2,
  RefreshCw
} from 'lucide-react';
import {
  disconnectQbo,
  getQboConnectionStatus,
  saveQboCredentials
} from '@alga-psa/integrations/actions';
import { QboLiveMappingManager } from '../../qbo/QboLiveMappingManager';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

type QboStatus = Awaited<ReturnType<typeof getQboConnectionStatus>>;
type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

interface QboIntegrationSettingsProps {
  syncHealthSlot?: React.ReactNode;
  onboardingSlot?: React.ReactNode;
}

function describeCallbackError(
  code: string | null,
  t: TranslateFn
): string | null {
  switch (code) {
    case 'config_missing':
      return t('integrations.qbo.settings.callback.configMissing', {
        defaultValue:
          'QuickBooks could not start connecting because app setup is incomplete.'
      });
    case 'token_exchange_failed':
      return t('integrations.qbo.settings.callback.tokenExchangeFailed', {
        defaultValue:
          'Intuit did not finish the connection. Try connecting again.'
      });
    case 'oauth_failed':
      return t('integrations.qbo.settings.callback.oauthFailed', {
        defaultValue:
          'QuickBooks could not finish connecting. Try again. If it keeps failing, review Advanced setup.'
      });
    case 'invalid_state':
      return t('integrations.qbo.settings.callback.invalidState', {
        defaultValue:
          'This QuickBooks connection attempt expired. Start again.'
      });
    case 'missing_params':
      return t('integrations.qbo.settings.callback.missingParams', {
        defaultValue:
          'QuickBooks returned an incomplete response. Start again.'
      });
    case 'access_denied':
      return t('integrations.qbo.settings.callback.accessDenied', {
        defaultValue:
          'QuickBooks access was denied before the connection completed.'
      });
    default:
      return code
        ? t('integrations.qbo.settings.callback.generic', {
            defaultValue: 'QuickBooks returned an OAuth error: {{code}}',
            code
          })
        : null;
  }
}

function FeedbackMessage({
  tone,
  children
}: {
  tone: 'success' | 'error';
  children: React.ReactNode;
}) {
  const Icon = tone === 'success' ? CheckCircle2 : AlertCircle;
  const toneClass =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-red-200 bg-red-50 text-red-800';

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${toneClass}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

export default function QboIntegrationSettings({
  syncHealthSlot,
  onboardingSlot
}: QboIntegrationSettingsProps = {}) {
  const { t } = useTranslation('msp/integrations');
  const searchParams = useSearchParams();
  const [status, setStatus] = React.useState<QboStatus | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [disconnecting, setDisconnecting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(
    null
  );
  const [clientId, setClientId] = React.useState('');
  const [clientSecret, setClientSecret] = React.useState('');

  const oauthStatus = searchParams?.get('qbo_status');
  const oauthError = React.useMemo(
    () => describeCallbackError(searchParams?.get('qbo_error') ?? null, t),
    [searchParams, t]
  );

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getQboConnectionStatus();
      setStatus(result);
    } catch (err) {
      setError(
        t('integrations.qbo.settings.errors.load', {
          defaultValue: 'Failed to load QuickBooks settings.'
        })
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (oauthStatus === 'success') {
      setSuccessMessage(
        t('integrations.qbo.settings.connectSuccess', {
          defaultValue:
            'QuickBooks connected successfully. Alga will use this company for live exports and mappings.'
        })
      );
      void load();
      return;
    }

    if (oauthStatus === 'failure' && oauthError) {
      setError(oauthError);
    }
  }, [load, oauthError, oauthStatus, t]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const result = await saveQboCredentials({
        clientId,
        clientSecret
      });

      if (!result.success) {
        setError(
          t('integrations.qbo.settings.errors.saveCredentials', {
            defaultValue: 'Failed to save QuickBooks credentials.'
          })
        );
        return;
      }

      setClientId('');
      setClientSecret('');
      setSuccessMessage(
        t('integrations.qbo.settings.credentialsSaved', {
            defaultValue:
              'QuickBooks app setup saved. You can now connect a QuickBooks company.'
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
      const result = await disconnectQbo();
      if (!result.success) {
        setError(
          t('integrations.qbo.settings.errors.disconnect', {
            defaultValue: 'Failed to disconnect QuickBooks.'
          })
        );
        return;
      }

      setSuccessMessage(
        t('integrations.qbo.settings.disconnectSuccess', {
            defaultValue:
              'QuickBooks was disconnected. Saved app setup was left in place for reconnecting.'
        })
      );
      await load();
    } finally {
      setDisconnecting(false);
    }
  };

  const readyToSave =
    clientId.trim().length > 0 && clientSecret.trim().length > 0;
  const canConnect = Boolean(status?.credentials.ready);
  const defaultConnection = status?.defaultConnection;
  const tenantCredentialsConfigured = Boolean(
    status?.credentials.clientIdConfigured ||
    status?.credentials.clientSecretConfigured
  );
  const tenantCredentialsComplete = Boolean(
    status?.credentials.clientIdConfigured &&
    status?.credentials.clientSecretConfigured
  );
  const usingAppLevelCredentials = Boolean(
    status?.credentials.ready && !tenantCredentialsComplete
  );
  const shouldOpenCredentialDetails =
    !loading &&
    (!canConnect ||
      (tenantCredentialsConfigured && !tenantCredentialsComplete));
  const connectionStatusLabel = loading
    ? t('integrations.qbo.settings.connection.checking', {
        defaultValue: 'Checking connection'
      })
    : defaultConnection?.status === 'active'
      ? t('integrations.qbo.settings.connection.connected', {
          defaultValue: 'Connected'
        })
      : defaultConnection
        ? t('integrations.qbo.settings.connection.needsAttention', {
            defaultValue: 'Needs attention'
          })
        : canConnect
          ? t('integrations.qbo.settings.connection.ready', {
              defaultValue: 'Ready to connect'
            })
          : t('integrations.qbo.settings.connection.needsCredentials', {
              defaultValue: 'Setup required'
            });
  const connectionStatusDescription = loading
    ? t('integrations.qbo.settings.connection.checkingDescription', {
        defaultValue: 'Reading the tenant QuickBooks configuration.'
      })
    : defaultConnection
      ? t('integrations.qbo.settings.connection.connectedDescription', {
          defaultValue:
            'Live sync, mappings, and invoice delivery use this QuickBooks company.'
        })
      : canConnect
        ? t('integrations.qbo.settings.connection.readyToConnect', {
            defaultValue:
              'QuickBooks is ready. Connect a company to enable live mappings and invoice delivery.'
          })
        : t('integrations.qbo.settings.connection.notConnected', {
            defaultValue:
              'No QuickBooks company is connected yet. Finish setup, then connect a company.'
          });
  const connectionDotClass = loading
    ? 'bg-muted-foreground/60'
    : defaultConnection?.status === 'active'
      ? 'bg-emerald-500'
      : defaultConnection
        ? 'bg-amber-500'
        : canConnect
          ? 'bg-sky-500'
          : 'bg-muted-foreground/60';
  const credentialSourceLabel = usingAppLevelCredentials
    ? t('integrations.qbo.settings.credentialSource.hosted', {
        defaultValue: 'Hosted QuickBooks app'
      })
    : tenantCredentialsComplete
      ? t('integrations.qbo.settings.credentialSource.tenant', {
          defaultValue: 'Custom Intuit app'
        })
      : t('integrations.qbo.settings.credentialSource.missing', {
          defaultValue: 'Not configured'
        });
  const environmentLabel =
    status?.environment === 'production'
      ? t('integrations.qbo.settings.environmentProduction', {
          defaultValue: 'Production'
        })
      : t('integrations.qbo.settings.environmentSandbox', {
          defaultValue: 'Sandbox'
        });

  return (
    <div className="space-y-8" id="qbo-integration-settings">
      {successMessage ? (
        <FeedbackMessage tone="success">{successMessage}</FeedbackMessage>
      ) : null}

      {error ? <FeedbackMessage tone="error">{error}</FeedbackMessage> : null}

      <section id="qbo-integration-connection-card" className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span
              className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${connectionDotClass}`}
              aria-hidden="true"
            />
            <div className="min-w-0">
              <h4 className="text-base font-semibold text-foreground">
                {connectionStatusLabel}
              </h4>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                {connectionStatusDescription}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              id="qbo-connect-button"
              type="button"
              disabled={!canConnect}
              onClick={() =>
                window.location.assign('/api/integrations/qbo/connect')
              }
            >
              {defaultConnection
                ? t('integrations.qbo.settings.actions.reconnect', {
                    defaultValue: 'Reconnect QuickBooks'
                  })
                : t('integrations.qbo.settings.actions.connect', {
                    defaultValue: 'Connect QuickBooks'
                  })}
            </Button>

            <Button
              id="qbo-settings-refresh"
              type="button"
              variant="outline"
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('integrations.qbo.settings.actions.refresh', {
                defaultValue: 'Refresh'
              })}
            </Button>
          </div>
        </div>

        {status?.error && defaultConnection ? (
          <p
            className={
              status.connected
                ? 'text-sm text-muted-foreground'
                : 'text-sm text-red-600'
            }
          >
            {status.error}
          </p>
        ) : null}

        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {defaultConnection ? (
            <>
              <div className="min-w-0">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('integrations.qbo.settings.connection.defaultCompany', {
                    defaultValue: 'Connected company'
                  })}
                </dt>
                <dd className="mt-1 truncate text-foreground">
                  {defaultConnection.displayName || defaultConnection.realmId}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('integrations.qbo.settings.connection.realm', {
                    defaultValue: 'Realm ID'
                  })}
                </dt>
                <dd className="mt-1 flex items-center gap-1.5 font-mono text-xs text-foreground">
                  <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{defaultConnection.realmId}</span>
                </dd>
              </div>
            </>
          ) : null}
          <div className="min-w-0">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('integrations.qbo.settings.credentialSource.label', {
                defaultValue: 'App setup'
              })}
            </dt>
            <dd className="mt-1 text-foreground">{credentialSourceLabel}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('integrations.qbo.settings.environment', {
                defaultValue: 'Environment'
              })}
            </dt>
            <dd className="mt-1 text-foreground">{environmentLabel}</dd>
          </div>
        </dl>

        <details
          open={shouldOpenCredentialDetails}
          className="group rounded-lg border"
        >
          <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <div>
              <h4 className="text-sm font-semibold text-foreground">
                {t('integrations.qbo.settings.tenantOauthTitle', {
                  defaultValue: 'Advanced: use your own Intuit app'
                })}
              </h4>
              <p className="mt-1 text-sm text-muted-foreground">
                {usingAppLevelCredentials
                  ? t(
                      'integrations.qbo.settings.tenantOauthHostedDescription',
                      {
                        defaultValue:
                          'Alga already provides a QuickBooks app for connecting. Add your own only if this company needs its own Intuit app registration.'
                      }
                    )
                  : t('integrations.qbo.settings.tenantOauthDescription', {
                      defaultValue:
                        'Most teams can skip this. Add your own Intuit app credentials only if you need to. Saved secrets are hidden after they are stored.'
                    })}
              </p>
            </div>
            <ChevronDown className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-6 border-t px-4 py-5">
            {loading ? (
              <div className="text-sm text-muted-foreground">
                {t('integrations.qbo.settings.loading', {
                  defaultValue: 'Loading QuickBooks settings…'
                })}
              </div>
            ) : (
              <>
                <dl className="grid gap-4 text-sm">
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t('integrations.qbo.settings.redirectUri', {
                        defaultValue: 'Redirect URI'
                      })}
                    </dt>
                    <dd className="mt-1 break-all font-mono text-xs text-foreground">
                      {status?.redirectUri}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t('integrations.qbo.settings.requiredScopes', {
                        defaultValue: 'Required scopes'
                      })}
                    </dt>
                    <dd className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      {status?.scopes?.map((scope) => (
                        <code
                          key={scope}
                          className="font-mono text-xs text-foreground"
                        >
                          {scope}
                        </code>
                      ))}
                    </dd>
                  </div>
                </dl>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="qbo-client-id">
                      {t('integrations.qbo.settings.clientIdLabel', {
                        defaultValue: 'QuickBooks Client ID'
                      })}
                    </Label>
                    <Input
                      id="qbo-client-id"
                      value={clientId}
                      onChange={(event) => setClientId(event.target.value)}
                      placeholder={t(
                        'integrations.qbo.settings.clientIdPlaceholder',
                        { defaultValue: 'Paste your Intuit app client ID' }
                      )}
                    />
                    <p className="text-xs text-muted-foreground">
                      {status?.credentials.clientIdMasked
                        ? t('integrations.qbo.settings.storedClientId', {
                            defaultValue: 'Stored client ID: {{value}}',
                            value: status.credentials.clientIdMasked
                          })
                        : t('integrations.qbo.settings.noClientId', {
                            defaultValue: 'No custom client ID is stored.'
                          })}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="qbo-client-secret">
                      {t('integrations.qbo.settings.clientSecretLabel', {
                        defaultValue: 'QuickBooks Client Secret'
                      })}
                    </Label>
                    <Input
                      id="qbo-client-secret"
                      type="password"
                      value={clientSecret}
                      onChange={(event) => setClientSecret(event.target.value)}
                      placeholder={t(
                        'integrations.qbo.settings.clientSecretPlaceholder',
                        { defaultValue: 'Paste your Intuit app client secret' }
                      )}
                    />
                    <p className="text-xs text-muted-foreground">
                      {status?.credentials.clientSecretMasked
                        ? t('integrations.qbo.settings.storedClientSecret', {
                            defaultValue: 'Stored client secret: {{value}}',
                            value: status.credentials.clientSecretMasked
                          })
                        : t('integrations.qbo.settings.noClientSecret', {
                            defaultValue: 'No custom client secret is stored.'
                          })}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    {status?.credentials.ready
                      ? t('integrations.qbo.settings.credentialsReady', {
                          defaultValue: 'Custom Intuit app setup is complete.'
                        })
                      : t('integrations.qbo.settings.credentialsNotReady', {
                          defaultValue: 'Custom Intuit app setup is incomplete.'
                        })}
                  </p>
                  <Button
                    id="qbo-settings-save"
                    type="button"
                    onClick={() => void handleSave()}
                    disabled={!readyToSave || saving}
                  >
                    {saving
                      ? t('integrations.qbo.settings.actions.saving', {
                          defaultValue: 'Saving…'
                        })
                      : t('integrations.qbo.settings.actions.saveCredentials', {
                          defaultValue: 'Save credentials'
                        })}
                  </Button>
                </div>
              </>
            )}
          </div>
        </details>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <Button
            id="qbo-disconnect-button"
            type="button"
            variant="outline"
            disabled={!defaultConnection || disconnecting}
            onClick={() => void handleDisconnect()}
          >
            {disconnecting
              ? t('integrations.qbo.settings.actions.disconnecting', {
                  defaultValue: 'Disconnecting…'
                })
              : t('integrations.qbo.settings.actions.disconnect', {
                  defaultValue: 'Disconnect QuickBooks'
                })}
          </Button>

          {defaultConnection ? (
            <Button id="qbo-open-accounting-exports" asChild variant="link">
              <Link
                href="/msp/billing?tab=accounting-exports"
                className="inline-flex items-center gap-1.5"
              >
                {t('integrations.accounting.settings.viewExportHistory', {
                  defaultValue: 'View export history'
                })}
                <ExternalLink className="h-4 w-4" />
              </Link>
            </Button>
          ) : null}
        </div>
      </section>

      {defaultConnection ? syncHealthSlot : null}

      {defaultConnection ? onboardingSlot : null}

      {defaultConnection ? (
        <section
          id="qbo-integration-mapping-card"
          className="space-y-4 border-t pt-6"
        >
          <div>
            <h3 className="text-base font-semibold text-foreground">
              {t('integrations.qbo.settings.mapping.title', {
                defaultValue: 'Mappings'
              })}
            </h3>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {t('integrations.qbo.settings.mapping.description', {
                defaultValue:
                  'Match your services, tax codes, and payment terms to {{company}} so invoices land correctly in QuickBooks.',
                company:
                  defaultConnection.displayName || defaultConnection.realmId
              })}
            </p>
          </div>
          <QboLiveMappingManager defaultConnection={defaultConnection} />
        </section>
      ) : (
        <section
          id="qbo-integration-mapping-placeholder-card"
          className="space-y-2 border-t pt-6"
        >
          <h3 className="text-base font-semibold text-foreground">
            {t('integrations.qbo.settings.mapping.title', {
              defaultValue: 'Mappings'
            })}
          </h3>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t('integrations.qbo.settings.mapping.placeholderDescription', {
              defaultValue:
                'Connect a QuickBooks company to map your services, tax codes, and payment terms.'
            })}
          </p>
        </section>
      )}
    </div>
  );
}
