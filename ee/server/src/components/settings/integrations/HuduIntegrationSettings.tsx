'use client';

import React, { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { useToast } from '@alga-psa/ui/hooks/use-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  connectHudu,
  disconnectHudu,
  getHuduConnectionStatus,
  testHuduConnection,
} from '../../../lib/actions/integrations/huduActions';
import type { HuduActionResult, HuduConnectionStatusData } from '../../../lib/actions/integrations/huduActions';
import type { HuduErrorKind } from '../../../lib/integrations/hudu/huduClient';
import HuduCompanyMappingManager from './hudu/HuduCompanyMappingManager';
import HuduAssetLayoutMapManager from './hudu/HuduAssetLayoutMapManager';
import HuduSyncAutomationManager from './hudu/HuduSyncAutomationManager';

type ConnectionBadgeState = 'not_connected' | 'connected' | 'error';

// Explicit type guard: the EE tsconfig is non-strict, where `!result.success`
// alone does not narrow the discriminated union.
function isHuduFailure<T>(
  result: HuduActionResult<T>
): result is Extract<HuduActionResult<T>, { success: false }> {
  return !result.success;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export default function HuduIntegrationSettings() {
  const { t } = useTranslation('msp/integrations');
  const { toast } = useToast();

  const [status, setStatus] = useState<HuduConnectionStatusData | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [baseUrl, setBaseUrl] = useState('');
  const [baseUrlError, setBaseUrlError] = useState<string | null>(null);
  // SECURITY: the stored API key is never returned by the server, so this
  // field always starts (and stays) empty unless the admin types a new key.
  const [apiKey, setApiKey] = useState('');

  const [isTesting, startTesting] = useTransition();
  const [isConnecting, startConnecting] = useTransition();
  const [isDisconnecting, startDisconnecting] = useTransition();
  const busy = isTesting || isConnecting || isDisconnecting;

  const errorMessageForKind = useCallback(
    (kind: HuduErrorKind | undefined): string | null => {
      switch (kind) {
        case 'invalid_key':
          return t('integrations.hudu.settings.errors.invalidKey', {
            defaultValue: 'Hudu rejected the API key (401). Enter a valid API key.',
          });
        case 'not_found':
          return t('integrations.hudu.settings.errors.invalidBaseUrl', {
            defaultValue: 'No Hudu API was found at this base URL (404). Check the base URL.',
          });
        case 'network_error':
          return t('integrations.hudu.settings.errors.unreachable', {
            defaultValue: 'Hudu could not be reached at this base URL. Check the URL and your network.',
          });
        default:
          return null;
      }
    },
    [t]
  );

  const reportFailure = useCallback(
    (message: string) => {
      setHasError(true);
      setSuccessMessage(null);
      setErrorMessage(message);
      toast({
        title: t('integrations.hudu.settings.toasts.errorTitle', { defaultValue: 'Hudu connection error' }),
        description: message,
        variant: 'destructive',
      });
    },
    [t, toast]
  );

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const result = await getHuduConnectionStatus();
      if (isHuduFailure(result)) {
        setStatus(null);
        setHasError(true);
        setErrorMessage(
          result.error ||
            t('integrations.hudu.settings.errors.loadStatus', {
              defaultValue: 'Failed to load the Hudu connection status.',
            })
        );
      } else {
        setStatus(result.data);
        setBaseUrl((current) => current || result.data.baseUrl || '');
      }
    } catch (err) {
      setStatus(null);
      setHasError(true);
      setErrorMessage(
        err instanceof Error
          ? err.message
          : t('integrations.hudu.settings.errors.loadStatus', {
              defaultValue: 'Failed to load the Hudu connection status.',
            })
      );
    } finally {
      setStatusLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const isConnected = Boolean(status?.connected);

  const badgeState: ConnectionBadgeState = hasError ? 'error' : isConnected ? 'connected' : 'not_connected';

  const statusBadge = useMemo(() => {
    switch (badgeState) {
      case 'connected':
        return (
          <Badge id="hudu-connection-status-badge" variant="success">
            {t('integrations.hudu.settings.status.connected', { defaultValue: 'Connected' })}
          </Badge>
        );
      case 'error':
        return (
          <Badge id="hudu-connection-status-badge" variant="error">
            {t('integrations.hudu.settings.status.error', { defaultValue: 'Error' })}
          </Badge>
        );
      default:
        return (
          <Badge id="hudu-connection-status-badge" variant="secondary">
            {t('integrations.hudu.settings.status.notConnected', { defaultValue: 'Not connected' })}
          </Badge>
        );
    }
  }, [badgeState, t]);

  // F033: only send api_key when the admin typed one. A blank key while
  // connected means "keep the stored key" — the payload omits apiKey entirely.
  const buildCredentialsPayload = useCallback(():
    | { baseUrl: string; apiKey?: string }
    | null => {
    const trimmedBase = baseUrl.trim();
    if (!trimmedBase) {
      setBaseUrlError(
        t('integrations.hudu.settings.errors.baseUrlRequired', { defaultValue: 'Base URL is required.' })
      );
      return null;
    }
    if (!isValidHttpUrl(trimmedBase)) {
      setBaseUrlError(
        t('integrations.hudu.settings.errors.baseUrlFormat', {
          defaultValue: 'Enter a valid URL, e.g. https://your-instance.huducloud.com',
        })
      );
      return null;
    }
    setBaseUrlError(null);

    const trimmedKey = apiKey.trim();
    return trimmedKey ? { baseUrl: trimmedBase, apiKey: trimmedKey } : { baseUrl: trimmedBase };
  }, [apiKey, baseUrl, t]);

  const handleTestConnection = () => {
    const payload = buildCredentialsPayload();
    if (!payload) return;

    startTesting(async () => {
      setErrorMessage(null);
      setSuccessMessage(null);
      const result = await testHuduConnection(payload);
      if (isHuduFailure(result)) {
        reportFailure(
          errorMessageForKind(result.errorKind) ||
            result.error ||
            t('integrations.hudu.settings.errors.testFailed', { defaultValue: 'Hudu connection test failed.' })
        );
        return;
      }

      if (!result.data.connected) {
        reportFailure(
          errorMessageForKind(result.data.errorKind) ||
            result.data.error ||
            t('integrations.hudu.settings.errors.testFailed', { defaultValue: 'Hudu connection test failed.' })
        );
        return;
      }

      setHasError(false);
      setSuccessMessage(
        result.data.passwordAccess
          ? t('integrations.hudu.settings.success.testPassedWithPasswords', {
              defaultValue: 'Hudu connection test succeeded. Password access is enabled for this key.',
            })
          : t('integrations.hudu.settings.success.testPassedNoPasswords', {
              defaultValue: 'Hudu connection test succeeded. Password access is not enabled for this key.',
            })
      );
    });
  };

  const handleConnect = () => {
    const payload = buildCredentialsPayload();
    if (!payload) return;

    startConnecting(async () => {
      setErrorMessage(null);
      setSuccessMessage(null);
      const result = await connectHudu(payload);
      if (isHuduFailure(result)) {
        reportFailure(
          errorMessageForKind(result.errorKind) ||
            result.error ||
            t('integrations.hudu.settings.errors.connectFailed', { defaultValue: 'Failed to connect to Hudu.' })
        );
        return;
      }

      setHasError(false);
      setStatus(result.data);
      setBaseUrl(result.data.baseUrl || payload.baseUrl);
      setApiKey('');
      setSuccessMessage(
        t('integrations.hudu.settings.success.connected', { defaultValue: 'Connected to Hudu.' })
      );
    });
  };

  const handleDisconnect = () => {
    startDisconnecting(async () => {
      setErrorMessage(null);
      setSuccessMessage(null);
      const result = await disconnectHudu();
      if (isHuduFailure(result)) {
        reportFailure(
          result.error ||
            t('integrations.hudu.settings.errors.disconnectFailed', { defaultValue: 'Failed to disconnect Hudu.' })
        );
        return;
      }

      setHasError(false);
      setApiKey('');
      setSuccessMessage(
        t('integrations.hudu.settings.success.disconnected', { defaultValue: 'Hudu connection disconnected.' })
      );
      await loadStatus();
    });
  };

  return (
    <>
    <Card id="hudu-integration-settings">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>{t('integrations.hudu.settings.title', { defaultValue: 'Hudu' })}</CardTitle>
            <CardDescription>
              {t('integrations.hudu.settings.description', {
                defaultValue:
                  'Connect your Hudu instance to surface client documentation and credentials inside AlgaPSA.',
              })}
            </CardDescription>
          </div>
          {statusBadge}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {statusLoading ? (
          <p className="text-sm text-muted-foreground">
            {t('integrations.hudu.settings.loading', { defaultValue: 'Loading Hudu connection status...' })}
          </p>
        ) : (
          <>
            {isConnected && (
              <div id="hudu-connection-details" className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">
                  {t('integrations.hudu.settings.detectedInstance', { defaultValue: 'Hudu instance' })}:
                </span>
                <span id="hudu-detected-instance" className="font-medium">
                  {status?.baseUrl}
                </span>
                <Badge
                  id="hudu-password-access-indicator"
                  variant={status?.passwordAccess ? 'success' : 'warning'}
                >
                  {status?.passwordAccess
                    ? t('integrations.hudu.settings.passwordAccess.enabled', {
                        defaultValue: 'Password access enabled',
                      })
                    : t('integrations.hudu.settings.passwordAccess.disabled', {
                        defaultValue: 'Password access not enabled for this key',
                      })}
                </Badge>
              </div>
            )}

            {errorMessage && (
              <Alert id="hudu-connection-error" variant="destructive">
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            )}
            {successMessage && (
              <Alert id="hudu-connection-success" variant="success">
                <AlertDescription>{successMessage}</AlertDescription>
              </Alert>
            )}

            <Input
              id="hudu-base-url"
              type="text"
              label={t('integrations.hudu.settings.fields.baseUrl.label', { defaultValue: 'Base URL' })}
              placeholder={t('integrations.hudu.settings.fields.baseUrl.placeholder', {
                defaultValue: 'https://your-instance.huducloud.com',
              })}
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              error={baseUrlError ?? undefined}
              disabled={busy}
            />

            <div className="space-y-1">
              <Input
                id="hudu-api-key"
                type="password"
                autoComplete="new-password"
                label={t('integrations.hudu.settings.fields.apiKey.label', { defaultValue: 'API key' })}
                placeholder={
                  isConnected
                    ? t('integrations.hudu.settings.fields.apiKey.keepExisting', {
                        defaultValue: 'Leave blank to keep the current API key',
                      })
                    : t('integrations.hudu.settings.fields.apiKey.placeholder', {
                        defaultValue: 'Enter your Hudu API key',
                      })
                }
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                disabled={busy}
              />
              <p id="hudu-api-key-hint" className="text-xs text-muted-foreground">
                {t('integrations.hudu.settings.fields.apiKey.writeOnlyHint', {
                  defaultValue: 'The stored API key is never displayed. Leave this blank to keep using it.',
                })}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button id="hudu-test-connection-button" variant="outline" onClick={handleTestConnection} disabled={busy}>
                {isTesting
                  ? t('integrations.hudu.settings.buttons.testing', { defaultValue: 'Testing...' })
                  : t('integrations.hudu.settings.buttons.test', { defaultValue: 'Test Connection' })}
              </Button>
              <Button id="hudu-connect-button" onClick={handleConnect} disabled={busy}>
                {isConnecting
                  ? t('integrations.hudu.settings.buttons.connecting', { defaultValue: 'Connecting...' })
                  : t('integrations.hudu.settings.buttons.connect', { defaultValue: 'Connect' })}
              </Button>
              <Button
                id="hudu-disconnect-button"
                variant="destructive"
                onClick={handleDisconnect}
                disabled={busy || !isConnected}
              >
                {isDisconnecting
                  ? t('integrations.hudu.settings.buttons.disconnecting', { defaultValue: 'Disconnecting...' })
                  : t('integrations.hudu.settings.buttons.disconnect', { defaultValue: 'Disconnect' })}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>

    {/* Company mappings - shown when connected (NinjaOne precedent) */}
    {isConnected && (
      <div className="mt-6">
        <HuduCompanyMappingManager />
      </div>
    )}

    {/* Asset layout -> asset type map (Phase 2 FR11/FR12) - shown when connected */}
    {isConnected && (
      <div className="mt-6">
        <HuduAssetLayoutMapManager />
      </div>
    )}

    {/* Tenant-wide import + daily auto-sync - shown when connected */}
    {isConnected && (
      <div className="mt-6">
        <HuduSyncAutomationManager />
      </div>
    )}
    </>
  );
}
