'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Phone } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { RELEASE_V1_6_FEATURE_FLAG } from '@alga-psa/core/features';
import {
  downloadThreecxTemplate,
  getThreecxCardState,
  rotateThreecxApiKey,
  setTelephonyAutoCreateTickets,
  setTelephonyProviderEnabled,
} from '../../../../actions/integrations/telephonyActions';
import type { ThreecxCardState } from '../../../../actions/integrations/telephonyActions';

/**
 * The 3CX provider card. Hidden unless the release flag is on (client) and the
 * server reports the provider available (edition + Pro tier). Shows status, the
 * two toggles, the endpoint URL, the masked key with Rotate, and Download
 * template; the full key is shown once right after Enable or Rotate mints it.
 */
export function ThreecxProviderCard() {
  const { t } = useTranslation('msp/integrations');
  const flag = useFeatureFlag(RELEASE_V1_6_FEATURE_FLAG);
  const [state, setState] = useState<ThreecxCardState | null>(null);
  const [fullKey, setFullKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await getThreecxCardState();
      setState(next);
      setError(next.success ? null : next.error ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, []);

  useEffect(() => {
    if (flag.enabled) {
      void load();
    }
  }, [flag.enabled, load]);

  if (!flag.enabled) {
    return null;
  }
  if (state && !state.available) {
    return null;
  }

  const canManage = Boolean(state?.canManage);
  const status = state?.status ?? 'not_configured';
  const isActive = status === 'active';
  const hasKey = Boolean(state?.keyLastFour);

  const statusBadge = () => {
    if (status === 'active') {
      return <Badge variant="success">{t('integrations.telephony.status.active', { defaultValue: 'Active' })}</Badge>;
    }
    if (status === 'error') {
      return <Badge variant="error">{t('integrations.telephony.status.error', { defaultValue: 'Error' })}</Badge>;
    }
    if (status === 'disabled') {
      return <Badge variant="secondary">{t('integrations.telephony.status.disabled', { defaultValue: 'Disabled' })}</Badge>;
    }
    return <Badge variant="secondary">{t('integrations.telephony.status.notConfigured', { defaultValue: 'Not configured' })}</Badge>;
  };

  const runBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = () =>
    runBusy(async () => {
      const result = await setTelephonyProviderEnabled({ provider: '3cx', enabled: !isActive });
      if (!result.success) {
        setError(result.error ?? null);
      } else if (result.apiKey) {
        setFullKey(result.apiKey);
      }
      await load();
    });

  const toggleAutoTicket = (checked: boolean) =>
    runBusy(async () => {
      await setTelephonyAutoCreateTickets({ provider: '3cx', autoCreateTickets: checked });
      await load();
    });

  const rotate = () =>
    runBusy(async () => {
      const result = await rotateThreecxApiKey();
      if (!result.success) {
        setError(result.error ?? null);
      } else if (result.apiKey) {
        setFullKey(result.apiKey);
      }
      await load();
    });

  const download = () =>
    runBusy(async () => {
      const result = await downloadThreecxTemplate();
      if (!result.success || !result.xml) {
        setError(result.error ?? null);
        return;
      }
      if (typeof window !== 'undefined') {
        const blob = new Blob([result.xml], { type: result.contentType ?? 'application/xml' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = result.filename ?? 'algapsa-3cx.xml';
        anchor.click();
        URL.revokeObjectURL(url);
      }
      await load();
    });

  const copy = (value: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(value);
    }
  };

  return (
    <Card className="relative overflow-hidden" id="telephony-provider-card-3cx">
      <CardHeader className="space-y-4 pb-3">
        <div className="relative flex h-24 w-full items-center justify-center rounded-lg bg-muted/40">
          <div className="absolute right-3 top-3">{statusBadge()}</div>
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[rgb(var(--color-primary-500))] text-white shadow-sm ring-1 ring-border">
            <Phone className="h-5 w-5" />
          </div>
        </div>
        <div className="space-y-1">
          <CardTitle className="text-base">
            {t('integrations.telephony.providers.threecx.label', { defaultValue: '3CX' })}
          </CardTitle>
          <CardDescription className="text-sm">
            {t('integrations.telephony.providers.threecx.description', {
              defaultValue: 'Journal 3CX calls as interactions and recognise callers in the 3CX client through the CRM template.',
            })}
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0 text-xs text-muted-foreground">
        {!canManage && (
          <p id="threecx-permission-message">
            {t('integrations.telephony.providers.threecx.permission', {
              defaultValue: 'You need the system settings permission to manage the 3CX integration.',
            })}
          </p>
        )}

        <div className="space-y-1">
          <span className="font-medium text-foreground/80">
            {t('integrations.telephony.providers.threecx.endpoint', { defaultValue: 'Endpoint base URL' })}
          </span>
          <div className="flex items-center gap-2">
            <code id="threecx-endpoint-url" className="truncate rounded bg-muted px-2 py-1">
              {state?.endpointBaseUrl ?? ''}
            </code>
            <Button
              id="threecx-copy-endpoint"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => copy(state?.endpointBaseUrl ?? '')}
            >
              {t('integrations.telephony.providers.threecx.copy', { defaultValue: 'Copy' })}
            </Button>
          </div>
        </div>

        {hasKey && (
          <div className="space-y-1">
            <span className="font-medium text-foreground/80">
              {t('integrations.telephony.providers.threecx.apiKey', { defaultValue: 'API key' })}
            </span>
            <div className="flex items-center gap-2">
              <code id="threecx-api-key-masked" className="rounded bg-muted px-2 py-1">
                {`••••${state?.keyLastFour ?? ''}`}
              </code>
              <Button
                id="threecx-rotate-key"
                variant="outline"
                size="sm"
                disabled={!canManage || busy}
                onClick={() => void rotate()}
              >
                {t('integrations.telephony.providers.threecx.rotate', { defaultValue: 'Rotate' })}
              </Button>
            </div>
          </div>
        )}

        {fullKey && (
          <div className="space-y-1 rounded border border-[rgb(var(--color-primary-300))] p-2" id="threecx-full-key">
            <p className="font-medium text-foreground/80">
              {t('integrations.telephony.providers.threecx.fullKeyWarning', {
                defaultValue: 'Copy this key now — it will not be shown again.',
              })}
            </p>
            <div className="flex items-center gap-2">
              <code id="threecx-full-key-value" className="truncate rounded bg-muted px-2 py-1">{fullKey}</code>
              <Button id="threecx-copy-key" variant="outline" size="sm" onClick={() => copy(fullKey)}>
                {t('integrations.telephony.providers.threecx.copy', { defaultValue: 'Copy' })}
              </Button>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-2">
          <span className="font-medium text-foreground/80">
            {t('integrations.telephony.autoTicket', { defaultValue: 'Create a ticket automatically for matched calls' })}
          </span>
          <Switch
            id="threecx-auto-ticket-toggle"
            checked={Boolean(state?.autoCreateTickets)}
            disabled={!canManage || busy || !isActive}
            onCheckedChange={(checked) => void toggleAutoTicket(checked)}
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            id="threecx-download-template"
            variant="outline"
            size="sm"
            disabled={!canManage || busy}
            onClick={() => void download()}
          >
            {t('integrations.telephony.providers.threecx.download', { defaultValue: 'Download template' })}
          </Button>
        </div>

        {error && (
          <p className="text-[rgb(var(--color-accent-600))]" id="threecx-error-message">
            {error}
          </p>
        )}
      </CardContent>

      <CardFooter className="pt-0">
        <Button
          id="threecx-enable-toggle"
          className="w-full"
          variant={isActive ? 'outline' : 'default'}
          disabled={!canManage || busy}
          onClick={() => void toggleEnabled()}
        >
          {isActive
            ? t('integrations.telephony.actions.disable', { defaultValue: 'Disable' })
            : t('integrations.telephony.actions.enable', { defaultValue: 'Enable' })}
        </Button>
      </CardFooter>
    </Card>
  );
}

export default ThreecxProviderCard;
