'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import CoManagedCheckout from '@enterprise/components/co-managed/CoManagedCheckout';
import { previewCoManagedSeatsAction, purchaseCoManagedSeatsAction } from '@enterprise/lib/actions/coManagedBillingActions';
import { getCoManagedBillingState } from '@/lib/actions/coManagedActions';
import CoManagedProvisioningPanel from './CoManagedProvisioningPanel';

export default function CoManagedOverview({ initialClientId }: { initialClientId?: string }) {
  const { t } = useTranslation('msp/licensing');
  const { formatCurrency, formatDate } = useFormatters();
  const [state, setState] = useState<Awaited<ReturnType<typeof getCoManagedBillingState>> | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewCoManagedSeatsAction>> | null>(null);
  const [checkout, setCheckout] = useState<{ clientSecret: string; publishableKey: string } | null>(null);
  const operation = useRef<string | null>(null);

  const reload = useCallback(async () => {
    const next = await getCoManagedBillingState();
    setState(next);
    setQuantity(next.pending?.quantity ?? Math.max(1, next.capacity));
    operation.current = next.pending?.operation_id ?? null;
  }, []);
  useEffect(() => { void reload().catch((err) => setError(err instanceof Error ? err.message : t('coManaged.loadError'))); }, [reload, t]);

  const review = async () => {
    setBusy(true); setError(null);
    try {
      setPreview(await previewCoManagedSeatsAction(quantity));
      operation.current = crypto.randomUUID();
    } catch (err) { setError(err instanceof Error ? err.message : t('coManaged.purchaseError')); }
    finally { setBusy(false); }
  };
  const purchase = async () => {
    if (!operation.current) return;
    setBusy(true); setError(null);
    try {
      const result = await purchaseCoManagedSeatsAction({ quantity, operationId: operation.current });
      setPreview(null);
      if (result.kind === 'checkout' && result.publishableKey) {
        setCheckout({ clientSecret: result.clientSecret, publishableKey: result.publishableKey });
      } else {
        setCheckout(null);
        if (result.kind === 'expired') setError(t('coManaged.checkoutExpired'));
      }
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('coManaged.purchaseError'));
      await reload().catch(() => undefined);
    } finally { setBusy(false); }
  };

  return <div className="mx-auto max-w-5xl space-y-6 p-6">
    <div><h1 className="text-3xl font-bold">{t('coManaged.title')}</h1>
      <p className="mt-2 text-muted-foreground">{t('coManaged.description')}</p></div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!state ? (!error && <p role="status">{t('coManaged.loading')}</p>) : <>
      <div className="grid gap-4 sm:grid-cols-3">
        {(['capacity', 'allocated', 'available'] as const).map((key) => <Card key={key}>
          <CardHeader><CardTitle>{t(`coManaged.${key}`)}</CardTitle></CardHeader>
          <CardContent><p className="text-3xl font-semibold">{state[key]}</p></CardContent>
        </Card>)}
      </div>
      {state.graceEndsAt && <p role="status">{t(state.isReadOnly ? 'coManaged.readOnly' : 'coManaged.grace', { date: formatDate(new Date(state.graceEndsAt)) })}</p>}
      {!state.isPro && <p>{t('coManaged.proRequired')}</p>}
      <Card><CardHeader><CardTitle>{t('coManaged.seatPool')}</CardTitle></CardHeader><CardContent className="space-y-4">
        <p className="text-muted-foreground">{t('coManaged.seatDescription')}</p>
        {state.selfHosted ? <Link id="co-managed-manage-license" href="/msp/licenses" className="text-primary underline">{t('coManaged.manageLicense')}</Link> :
          state.canPurchase && state.isPro ? <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2"><Label htmlFor="co-managed-seat-quantity">{t('coManaged.quantity')}</Label>
              <Input id="co-managed-seat-quantity" type="number" min={state.allocated} max={100000} step={1}
                value={quantity} disabled={busy || Boolean(state.pending)} onChange={(event) => setQuantity(Number(event.target.value))} /></div>
            <Button id="co-managed-review-purchase" disabled={busy || !Number.isInteger(quantity) || quantity < state.allocated || quantity > 100000}
              onClick={() => void (state.pending ? purchase() : review())}>
              {t(state.pending ? 'coManaged.resumePurchase' : 'coManaged.reviewPurchase')}
            </Button>
          </div> : null}
      </CardContent></Card>
      {state.canReadRelationships && <CoManagedProvisioningPanel available={state.available} canGrow={state.isPro && state.canGrow}
        initialClientId={initialClientId} onChanged={reload} />}
    </>}
    <Dialog id="co-managed-purchase-review" isOpen={preview !== null} onClose={() => { if (!busy) setPreview(null); }} title={t('coManaged.confirmTitle')}>
      {preview && <div className="space-y-4">
        <p>{t('coManaged.monthlyTotal', { count: quantity, amount: formatCurrency(preview.monthlyTotal / 100, preview.currency) })}</p>
        <p>{t('coManaged.dueNow', { amount: formatCurrency(preview.amountDue / 100, preview.currency) })}</p>
        {quantity === 0 && <p>{t('coManaged.cancelPool')}</p>}
        <Button id="co-managed-confirm-purchase" disabled={busy} onClick={() => void purchase()}>{t('coManaged.confirmPurchase')}</Button>
      </div>}
    </Dialog>
    <Dialog id="co-managed-checkout" isOpen={checkout !== null} onClose={() => setCheckout(null)} title={t('coManaged.checkoutTitle')}>
      {checkout && <CoManagedCheckout {...checkout} onComplete={() => void purchase()} />}
    </Dialog>
  </div>;
}
