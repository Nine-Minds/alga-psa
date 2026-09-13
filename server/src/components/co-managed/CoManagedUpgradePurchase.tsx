'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import CoManagedCheckout from '@enterprise/components/co-managed/CoManagedCheckout';
import { purchaseCoManagedUpgradeAction, retryCoManagedUpgradePaymentAction } from '@ee/lib/actions/coManagedUpgradeActions';
import type { CoManagedUpgradePurchaseRequest } from '@alga-psa/co-managed';

export default function CoManagedUpgradePurchase({ seatsRequired, pendingPurchase, onChanged }: {
  seatsRequired: number; pendingPurchase?: (CoManagedUpgradePurchaseRequest & { paymentFailed?: boolean }) | null; onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation('msp/licensing');
  const [quantity, setQuantity] = useState(pendingPurchase?.quantity ?? seatsRequired);
  const [interval, setInterval] = useState<'month' | 'year'>(pendingPurchase?.interval ?? 'month');
  const [confirmRetry, setConfirmRetry] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<{ clientSecret: string; publishableKey: string } | null>(null);
  const command = useRef<CoManagedUpgradePurchaseRequest | null>(pendingPurchase ?? null), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (pendingPurchase) { command.current = pendingPurchase; setQuantity(pendingPurchase.quantity); setInterval(pendingPurchase.interval); }
  }, [pendingPurchase?.operationId]);
  const purchase = async (resetFailed = false) => {
    if (busy) return;
    command.current ??= { operationId: crypto.randomUUID(), quantity, interval };
    setBusy(true); setMessage(null);
    try {
      if (resetFailed) {
        await retryCoManagedUpgradePaymentAction(command.current.operationId);
        if (!alive.current) return;
        command.current = { operationId: crypto.randomUUID(), quantity, interval };
        setConfirmRetry(false);
      }
      const result = await purchaseCoManagedUpgradeAction(command.current);
      if (!alive.current) return;
      if (result.kind === 'checkout') setCheckout({ clientSecret: result.clientSecret, publishableKey: result.publishableKey });
      else {
        setCheckout(null);
        if (result.kind === 'expired') { command.current = null; setMessage('coManaged.checkoutExpired'); }
        if (result.kind === 'payment_failed') setMessage('coManaged.upgrade.paymentFailed');
        if (result.kind === 'processing') setMessage('coManaged.upgrade.paymentProcessing');
      }
      await onChanged();
    } catch { if (alive.current) { setMessage('coManaged.purchaseError'); await onChanged(); } }
    finally { if (alive.current) setBusy(false); }
  };
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">{t('coManaged.upgrade.purchaseScope')}</p>
    {pendingPurchase?.paymentFailed && <p role="alert">{t('coManaged.upgrade.paymentFailed')}</p>}
    {message && <p role="status">{t(message)}</p>}
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-2"><Label htmlFor="co-upgrade-purchase-quantity">{t('coManaged.quantity')}</Label>
        <Input id="co-upgrade-purchase-quantity" type="number" min={seatsRequired} max={100000} step={1} value={quantity}
          disabled={busy || Boolean(command.current)} onChange={event => setQuantity(Number(event.target.value))} /></div>
      <CustomSelect id="co-upgrade-purchase-interval" label={t('coManaged.upgrade.billingInterval')} value={interval}
        disabled={busy || Boolean(command.current)} options={['month', 'year'].map(value => ({ value, label: t(`coManaged.upgrade.${value}`) }))}
        onValueChange={value => setInterval(value as 'month' | 'year')} />
      {pendingPurchase?.paymentFailed ? <Button id="co-upgrade-payment-retry" disabled={busy} onClick={() => setConfirmRetry(true)}>{t('coManaged.upgrade.retryPayment')}</Button> : <Button id="co-upgrade-purchase" disabled={busy || (!command.current && (!Number.isSafeInteger(quantity) || quantity < seatsRequired || quantity > 100000))}
        onClick={() => void purchase()}>{t(command.current ? 'coManaged.resumePurchase' : 'coManaged.reviewPurchase')}</Button>}
    </div>
    <ConfirmationDialog id="co-upgrade-payment-retry-confirm" isOpen={confirmRetry} onClose={() => { if (!busy) setConfirmRetry(false); }}
      onConfirm={() => purchase(true)} title={t('coManaged.upgrade.retryTitle')} message={t('coManaged.upgrade.retryMessage')}
      confirmLabel={t('coManaged.upgrade.retryPayment')} cancelLabel={t('coManaged.upgrade.cancel')} isConfirming={busy} />
    <Dialog id="co-upgrade-checkout" isOpen={Boolean(checkout)} onClose={() => setCheckout(null)} title={t('coManaged.checkoutTitle')}>
      {checkout && <CoManagedCheckout {...checkout} onComplete={() => void purchase()} />}
    </Dialog>
  </div>;
}
