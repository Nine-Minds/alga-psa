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
      ? 'border-emerald-200 text-emerald-800'
      : 'border-red-200 text-red-800';

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-3 rounded-md border px-4 py-3 text-sm ${toneClass}`}
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
    <div className="space-y-6" id="qbo-integration-settings">
      {successMessage ? (
        <FeedbackMessage tone="success">{successMessage}</FeedbackMessage>
      ) : null}

      {error ? <FeedbackMessage tone="error">{error}</FeedbackMessage> : null}

      <section id="qbo-integration-connection-card" className="space-y-5">
        <div className="border-b pb-4">
          <h3 className="text-base font-semibold text-foreground">
            {t('integrations.qbo.settings.connection.title', {
              defaultValue: 'Live QuickBooks Connection'
            })}
          </h3>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {t('integrations.qbo.settings.connection.description', {
              defaultValue:
                'Connect the QuickBooks company Alga should use for live sync, mappings, and invoice delivery.'
            })}
          </p>
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <span
                className={`mt-2 h-3 w-3 rounded-full ${connectionDotClass}`}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  {t('integrations.qbo.settings.title', {
                    defaultValue: 'QuickBooks Online'
                  })}
                </p>
                <h4 className="mt-1 text-2xl font-semibold tracking-normal text-foreground">
                  {connectionStatusLabel}
                </h4>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                  {connectionStatusDescription}
                </p>
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

            {defaultConnection ? (
              <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium uppercase text-muted-foreground">
                    {t('integrations.qbo.settings.connection.defaultCompany', {
                      defaultValue: 'Connected company'
                    })}
                  </dt>
                  <dd className="mt-1 truncate text-foreground">
                    {defaultConnection.displayName || defaultConnection.realmId}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase text-muted-foreground">
                    {t('integrations.qbo.settings.connection.realm', {
                      defaultValue: 'Realm'
                    })}
                  </dt>
                  <dd className="mt-1 flex items-center gap-2 font-mono text-xs text-foreground">
                    <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="truncate">
                      {defaultConnection.realmId}
                    </span>
                  </dd>
                </div>
              </dl>
            ) : null}
          </div>

          <div className="border-t pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-1">
            <dl className="space-y-4 text-sm">
              <div>
                <dt className="text-xs font-medium uppercase text-muted-foreground">
                  {t('integrations.qbo.settings.connection.state', {
                    defaultValue: 'State'
                  })}
                </dt>
                <dd className="mt-1 text-foreground">
                  {connectionStatusLabel}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase text-muted-foreground">
                  {t('integrations.qbo.settings.credentialSource.label', {
                    defaultValue: 'App setup'
                  })}
                </dt>
                <dd className="mt-1 text-foreground">
                  {credentialSourceLabel}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase text-muted-foreground">
                  {t('integrations.qbo.settings.environment', {
                    defaultValue: 'Intuit Environment'
                  })}
                </dt>
                <dd className="mt-1 text-foreground">{environmentLabel}</dd>
              </div>
            </dl>
          </div>
        </div>

        <details open={shouldOpenCredentialDetails} className="group border-t">
          <summary className="flex cursor-pointer list-none items-start justify-between gap-4 py-4 [&::-webkit-details-marker]:hidden">
            <div>
              <h4 className="text-sm font-semibold text-foreground">
                {t('integrations.qbo.settings.tenantOauthTitle', {
                  defaultValue: 'Advanced: Custom Intuit App'
                })}
              </h4>
              <p className="mt-1 text-sm text-muted-foreground">
                {usingAppLevelCredentials
                  ? t(
                      'integrations.qbo.settings.tenantOauthHostedDescription',
                      {
                        defaultValue:
                          'This environment already has the hosted QuickBooks app configured. Add a custom Intuit app only when this company needs its own app registration.'
                      }
                    )
                  : t('integrations.qbo.settings.tenantOauthDescription', {
                      defaultValue:
                        'Use this only when this company needs its own Intuit app. Saved secrets are hidden after they are stored.'
                    })}
              </p>
            </div>
            <ChevronDown className="mt-1 h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-6 border-t py-5">
            {usingAppLevelCredentials ? (
              <p className="text-sm text-muted-foreground">
                {t('integrations.qbo.settings.hostedAppReadyDescription', {
                  defaultValue:
                    'The usual Connect QuickBooks flow is available. Custom Intuit credentials are optional.'
                })}
              </p>
            ) : null}

            {loading ? (
              <div className="text-sm text-muted-foreground">
                {t('integrations.qbo.settings.loading', {
                  defaultValue: 'Loading QuickBooks settings…'
                })}
              </div>
            ) : (
              <>
                <dl className="grid gap-4 text-sm md:grid-cols-2">
                  <div className="md:col-span-2">
                    <dt className="text-xs font-medium uppercase text-muted-foreground">
                      {t('integrations.qbo.settings.redirectUri', {
                        defaultValue: 'Redirect URI'
                      })}
                    </dt>
                    <dd className="mt-1 break-all font-mono text-xs text-foreground">
                      {status?.redirectUri}
                    </dd>
                  </div>
                  <div className="md:col-span-2">
                    <dt className="text-xs font-medium uppercase text-muted-foreground">
                      {t('integrations.qbo.settings.requiredScopes', {
                        defaultValue: 'Required Scopes'
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

                <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
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
                          defaultValue: 'Save QuickBooks Credentials'
                        })}
                  </Button>
                </div>
              </>
            )}
          </div>
        </details>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <div className="flex flex-wrap items-center gap-2">
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

          <div className="flex flex-wrap items-center gap-2">
            {defaultConnection ? (
              <Button
                id="qbo-open-accounting-exports"
                asChild
                variant="outline"
              >
                <Link
                  href="/msp/billing?tab=accounting-exports"
                  className="inline-flex items-center gap-2"
                >
                  {t('integrations.csv.settings.exports.openButton', {
                    defaultValue: 'View Export History'
                  })}
                  <ExternalLink className="h-4 w-4 opacity-80" />
                </Link>
              </Button>
            ) : null}

            <Button
              id="qbo-disconnect-button"
              type="button"
              variant="destructive"
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
          </div>
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
                defaultValue: 'Live QuickBooks Mapping & Configuration'
              })}
            </h3>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              {t('integrations.qbo.settings.mapping.descriptionPrefix', {
                defaultValue:
                  'Configure live QuickBooks mappings for the connected company. These mappings are scoped to'
              })}{' '}
              <strong>
                {defaultConnection.displayName || defaultConnection.realmId}
              </strong>
              .
            </p>
            <p className="max-w-3xl text-sm text-muted-foreground">
              {t('integrations.qbo.settings.mapping.alert', {
                defaultValue:
                  'QuickBooks items, tax codes, and terms are loaded from the connected company.'
              })}
            </p>
          </div>
          <QboLiveMappingManager defaultConnection={defaultConnection} />
        </section>
      ) : (
        <section
          id="qbo-integration-mapping-placeholder-card"
          className="space-y-3 border-t pt-6"
        >
          <div>
            <h3 className="text-base font-semibold text-foreground">
              {t('integrations.qbo.settings.mapping.title', {
                defaultValue: 'Live QuickBooks Mapping & Configuration'
              })}
            </h3>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              {t('integrations.qbo.settings.mapping.placeholderDescription', {
                defaultValue:
                  'Connect a QuickBooks company before configuring live QuickBooks item and tax mappings.'
              })}
            </p>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {t('integrations.qbo.settings.mapping.placeholderAlert', {
              defaultValue:
                'The mapping manager becomes available after a QuickBooks company is connected.'
            })}
          </p>
        </section>
      )}
    </div>
  );
}
