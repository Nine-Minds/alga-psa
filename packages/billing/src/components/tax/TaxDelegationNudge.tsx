'use client';

import React from 'react';
import toast from 'react-hot-toast';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { Alert, AlertDescription, AlertTitle } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { Cloud } from 'lucide-react';
import {
  getTenantTaxSettings,
  updateTenantTaxSettings,
} from '@alga-psa/billing/actions';

type SupportedAdapter = { key: 'xero' | 'qbo'; label: string; statusParam: string };

const SUPPORTED_ADAPTERS: SupportedAdapter[] = [
  { key: 'xero', label: 'Xero', statusParam: 'xero_status' },
  { key: 'qbo', label: 'QuickBooks Online', statusParam: 'qbo_status' },
];

function detectJustConnectedAdapter(searchParams: URLSearchParams | null): SupportedAdapter | null {
  if (!searchParams) return null;
  for (const adapter of SUPPORTED_ADAPTERS) {
    if (searchParams.get(adapter.statusParam) === 'success') {
      return adapter;
    }
  }
  return null;
}

export function TaxDelegationNudge(): React.JSX.Element | null {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const justConnected = React.useMemo(
    () => detectJustConnectedAdapter(searchParams as URLSearchParams | null),
    [searchParams],
  );

  const [currentSource, setCurrentSource] = React.useState<string | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(false);
  const [applying, setApplying] = React.useState(false);

  React.useEffect(() => {
    if (!justConnected) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const settings = await getTenantTaxSettings();
        if (cancelled) return;
        setCurrentSource(settings?.default_tax_source ?? 'internal');
      } catch (err) {
        handleError(err, 'Unable to load current tax settings.');
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [justConnected]);

  const stripStatusParam = React.useCallback(() => {
    if (!justConnected || !searchParams || !pathname) return;
    const next = new URLSearchParams(searchParams.toString());
    next.delete(justConnected.statusParam);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [justConnected, pathname, router, searchParams]);

  const handleEnable = async () => {
    if (!justConnected) return;
    setApplying(true);
    try {
      await updateTenantTaxSettings({
        default_tax_source: 'external',
        allow_external_tax_override: true,
      });
      toast.success(
        `${justConnected.label} will calculate tax on new invoices. You can change this in Billing settings.`,
      );
      setDismissed(true);
      stripStatusParam();
    } catch (err) {
      handleError(err, 'Failed to enable external tax calculation.');
    } finally {
      setApplying(false);
    }
  };

  const handleKeepInternal = () => {
    setDismissed(true);
    stripStatusParam();
  };

  if (!justConnected || !loaded || dismissed) return null;
  if (currentSource && currentSource !== 'internal') return null;

  return (
    <Alert variant="info" id="tax-delegation-nudge" className="mb-4">
      <Cloud className="h-4 w-4" />
      <AlertTitle>Let {justConnected.label} calculate tax on future invoices?</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          Recommended. New invoices will post to {justConnected.label} without tax amounts,
          {' '}{justConnected.label} will apply its tax rules, and the calculated tax will sync back to Alga —
          keeping your two ledgers aligned. You can change this anytime in Billing → Tax Settings.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            id="tax-delegation-nudge-enable"
            size="sm"
            onClick={() => void handleEnable()}
            disabled={applying}
          >
            {applying ? 'Applying…' : `Yes, use ${justConnected.label}`}
          </Button>
          <Button
            id="tax-delegation-nudge-dismiss"
            size="sm"
            variant="outline"
            onClick={handleKeepInternal}
            disabled={applying}
          >
            Keep Alga calculating tax
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

export default TaxDelegationNudge;
