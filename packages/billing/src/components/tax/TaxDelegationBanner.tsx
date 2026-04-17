'use client';

import React from 'react';
import toast from 'react-hot-toast';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { Cloud } from 'lucide-react';
import {
  dismissTaxDelegationNudge,
  getTaxDelegationNudgeState,
  updateTenantTaxSettings,
} from '@alga-psa/billing/actions';

export function TaxDelegationBanner(): React.JSX.Element | null {
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
        handleError(err, 'Unable to load tax delegation recommendation state.');
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
      await updateTenantTaxSettings({
        default_tax_source: 'external',
        allow_external_tax_override: true,
      });
      toast.success(
        adapterLabel
          ? `${adapterLabel} will calculate tax on new invoices.`
          : 'External tax calculation enabled.',
      );
      setShouldShow(false);
    } catch (err) {
      handleError(err, 'Failed to enable external tax calculation.');
    } finally {
      setBusy(null);
    }
  };

  const handleDismiss = async () => {
    setBusy('dismiss');
    try {
      await dismissTaxDelegationNudge();
      setShouldShow(false);
    } catch (err) {
      handleError(err, 'Failed to dismiss the banner.');
    } finally {
      setBusy(null);
    }
  };

  if (!loaded || !shouldShow) return null;

  const label = adapterLabel ?? 'your accounting system';

  return (
    <Alert variant="info" id="tax-delegation-banner">
      <Cloud className="h-4 w-4" />
      <AlertTitle>Let {label} calculate tax?</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          {label} is connected. Most customers prefer to have their accounting system
          handle tax so the two ledgers stay aligned — Alga will post invoices without
          tax amounts, {label} applies its tax rules, and the result syncs back to Alga.
          Alga is not a tax package; we recommend delegating.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            id="tax-delegation-banner-enable"
            size="sm"
            onClick={() => void handleEnable()}
            disabled={busy !== null}
          >
            {busy === 'enable' ? 'Applying…' : `Use ${label} for tax`}
          </Button>
          <Button
            id="tax-delegation-banner-dismiss"
            size="sm"
            variant="outline"
            onClick={() => void handleDismiss()}
            disabled={busy !== null}
          >
            {busy === 'dismiss' ? 'Dismissing…' : 'Not now'}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

export default TaxDelegationBanner;
