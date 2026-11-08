'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { manageCoManagedUpgradeBillingAction } from '@ee/lib/actions/coManagedUpgradeActions';

export default function CoManagedUpgradeBilling({ seatsRequired, paidSeats, canChangeSeats }: {
  seatsRequired: number; paidSeats?: number | null; canChangeSeats: boolean;
}) {
  const { t } = useTranslation('msp/licensing');
  const [quantity, setQuantity] = useState(Math.max(seatsRequired, paidSeats ?? 0));
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const open = async (kind: 'payment_method' | 'seats') => {
    setBusy(true); setError(false);
    try {
      const result = await manageCoManagedUpgradeBillingAction({ kind, ...(kind === 'seats' ? { quantity } : {}) });
      if (alive.current) window.location.assign(result.url);
    } catch { if (alive.current) setError(true); }
    finally { if (alive.current) setBusy(false); }
  };
  return <section className="space-y-3 border-t border-[rgb(var(--color-border-200))] pt-4">
    <h2 className="font-semibold">{t('coManaged.upgrade.billingTitle')}</h2>
    {error && <p role="alert" className="text-destructive">{t('coManaged.upgrade.billingError')}</p>}
    <Button id="co-upgrade-payment-method" variant="outline" disabled={busy} onClick={() => void open('payment_method')}>
      {t('coManaged.upgrade.paymentMethod')}</Button>
    {canChangeSeats && <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-2"><Label htmlFor="co-upgrade-paid-seats">{t('coManaged.upgrade.paidSeats')}</Label>
        <Input id="co-upgrade-paid-seats" type="number" min={seatsRequired} max={100000} step={1} value={quantity}
          disabled={busy} onChange={event => setQuantity(Number(event.target.value))} /></div>
      <Button id="co-upgrade-review-seats" variant="outline" disabled={busy || quantity === paidSeats || !Number.isSafeInteger(quantity) || quantity < seatsRequired || quantity > 100000}
        onClick={() => void open('seats')}>{t('coManaged.upgrade.reviewSeatChange')}</Button>
    </div>}
  </section>;
}
