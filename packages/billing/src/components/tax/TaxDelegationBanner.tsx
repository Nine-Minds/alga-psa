'use client';

import React from 'react';
import toast from 'react-hot-toast';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import {
  handleError,
  isActionMessageError,
  isActionPermissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { Cloud } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { dismissTaxDelegationNudge, getTaxDelegationNudgeState, updateTenantTaxSettings } from '@alga-psa/billing/actions/taxSettingsActions';

type ReturnedActionError = ActionMessageError | ActionPermissionError;

const isReturnedActionError = (value: unknown): value is ReturnedActionError =>
  isActionMessageError(value) || isActionPermissionError(value);

export function TaxDelegationBanner(): React.JSX.Element | null {
  const { t } = useTranslation('msp/billing-settings');
  const [adapterLabel, setAdapterLabel] = React.useState<string | null>(null);
  const [shouldShow, setShouldShow] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [busy, setBusy] = React.useState<'enable' | 'dismiss' | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const state = await getTaxDelegationNudgeState();
        if (cancelled) return;
        setShouldShow(state.shouldShow);
        setAdapterLabel(state.adapterLabel);
      } catch (err) {
        handleError(err, t('tax.delegation.banner.errors.loadState', { defaultValue: 'Unable to load tax delegation recommendation state.' }));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleEnable = async () => {
    setBusy('enable');
    try {
      const result = await updateTenantTaxSettings({
        default_tax_source: 'external',
        allow_external_tax_override: true,
      });
      if (isReturnedActionError(result)) {
        handleError(result);
        return;
      }
      toast.success(
        adapterLabel
          ? t('tax.delegation.banner.toast.enabledWithProvider', {
              defaultValue: '{{provider}} will calculate tax on new invoices.',
              provider: adapterLabel,
            })
          : t('tax.delegation.banner.toast.enabled', { defaultValue: 'External tax calculation enabled.' }),
      );
      setShouldShow(false);
    } catch (err) {
      handleError(err, t('tax.delegation.errors.enableFailed', { defaultValue: 'Failed to enable external tax calculation.' }));
    } finally {
      setBusy(null);
    }
  };

  const handleDismiss = async () => {
    setBusy('dismiss');
    try {
      const result = await dismissTaxDelegationNudge();
      if (isReturnedActionError(result)) {
        handleError(result);
        return;
      }
      setShouldShow(false);
    } catch (err) {
      handleError(err, t('tax.delegation.banner.errors.dismissFailed', { defaultValue: 'Failed to dismiss the banner.' }));
    } finally {
      setBusy(null);
    }
  };

  if (!loaded || !shouldShow) return null;

  const label = adapterLabel ?? t('tax.delegation.defaultProvider', { defaultValue: 'your accounting system' });

  return (
    <Alert variant="info" id="tax-delegation-banner">
      <Cloud className="h-4 w-4" />
      <AlertTitle>
        {t('tax.delegation.banner.title', { defaultValue: 'Let {{provider}} calculate tax?', provider: label })}
      </AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          {t('tax.delegation.banner.description', {
            defaultValue:
              '{{provider}} is connected. Most customers prefer to have their accounting system handle tax so the two ledgers stay aligned — Alga will post invoices without tax amounts, {{provider}} applies its tax rules, and the result syncs back to Alga. Alga is not a tax package; we recommend delegating.',
            provider: label,
          })}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            id="tax-delegation-banner-enable"
            size="sm"
            onClick={() => void handleEnable()}
            disabled={busy !== null}
          >
            {busy === 'enable'
              ? t('tax.delegation.actions.applying', { defaultValue: 'Applying…' })
              : t('tax.delegation.banner.actions.enable', { defaultValue: 'Use {{provider}} for tax', provider: label })}
          </Button>
          <Button
            id="tax-delegation-banner-dismiss"
            size="sm"
            variant="outline"
            onClick={() => void handleDismiss()}
            disabled={busy !== null}
          >
            {busy === 'dismiss'
              ? t('tax.delegation.banner.actions.dismissing', { defaultValue: 'Dismissing…' })
              : t('tax.delegation.banner.actions.dismiss', { defaultValue: 'Not now' })}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

export default TaxDelegationBanner;
