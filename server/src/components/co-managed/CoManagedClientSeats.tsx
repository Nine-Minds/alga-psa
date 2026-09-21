'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { changeCoManagedWorkspaceSeats, getCoManagedBillingState } from '@/lib/actions/coManagedActions';
import { previewCoManagedSeatsAction, purchaseCoManagedSeatsAction } from '@enterprise/lib/actions/coManagedBillingActions';
import CoManagedCheckout from '@enterprise/components/co-managed/CoManagedCheckout';
import { readCoManagedClientDraft, writeCoManagedClientDraft, clearCoManagedClientDraft } from './coManagedClientDraft';
import { newCoManagedOperationId } from './coManagedOperationId';

type Billing = Awaited<ReturnType<typeof getCoManagedBillingState>>;
type Quote = { target: number; baseline: number; monthlyTotal: number; amountDue: number; currency: string };

/**
 * Changes a client's allocation with its current expected-seat identity. A seat
 * shortfall is reviewed as an absolute sponsor pool target (current pool plus
 * the shortfall), never as the client allocation or a delta. A successful
 * purchase is not the same as verified capacity or a completed allocation: the
 * flow waits for reconciliation, keeps the submitted operation frozen across a
 * lost response, and retries the prepared allocation without a second charge.
 */
export default function CoManagedClientSeats({ operationId, clientId, relationshipId, allocated, committed, idPrefix, onSaved }: {
  operationId: string;
  clientId: string;
  relationshipId?: string | null;
  allocated: number;
  committed: number;
  idPrefix: string;
  onSaved: () => Promise<void> | void;
}) {
  const { t } = useTranslation('msp/licensing');
  const { formatCurrency } = useFormatters();
  const [open, setOpen] = useState(false);
  const [seats, setSeats] = useState(allocated);
  const [billing, setBilling] = useState<Billing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<Quote | null>(null);
  const [pendingQuote, setPendingQuote] = useState<Quote | null>(null);
  const [checkout, setCheckout] = useState<{ clientSecret: string; publishableKey: string } | null>(null);
  const [purchaseOperationId, setPurchaseOperationId] = useState<string | null>(null);
  const minimum = Math.max(1, committed);
  // A validated relative return destination so License Management can bring the
  // operator back to this client's prepared allocation.
  const returnTo = `/msp/clients/${encodeURIComponent(clientId)}?tab=co-managed${relationshipId ? `&relationshipId=${encodeURIComponent(relationshipId)}` : ''}`;

  const loadBilling = useCallback(async () => {
    try { setBilling(await getCoManagedBillingState()); }
    catch { setBilling(null); }
  }, []);

  const openDialog = () => {
    const draft = readCoManagedClientDraft(clientId, relationshipId);
    setSeats(draft ?? allocated);
    setError(null); setReview(null); setBilling(null); setOpen(true);
    void loadBilling();
  };

  const changeSeats = (value: number) => {
    setSeats(value);
    writeCoManagedClientDraft(clientId, relationshipId, value);
  };

  const resize = async () => {
    await changeCoManagedWorkspaceSeats({ operationId, seats, expectedSeats: allocated });
    clearCoManagedClientDraft(clientId, relationshipId);
    setOpen(false);
    await onSaved();
  };

  /** Degradation outcomes must be specific; none of them silently becomes a purchase. */
  const explainShortfall = useCallback((current: Billing) => {
    switch (current.purchase?.reason) {
      case 'self_host_license': return t('coManaged.shortfall.selfHost', {
        defaultValue: 'This allocation exceeds verified self-host capacity. Update the signed license, then refresh.' });
      case 'pending': return t('coManaged.shortfall.pending', {
        defaultValue: 'A co-managed purchase is already being prepared or checked out. Resume it before changing capacity.' });
      case 'implementation_unavailable': return t('coManaged.shortfall.unavailable', {
        defaultValue: 'Hosted co-managed purchasing is not available in this deployment.' });
      case 'provider_unconfigured': return t('coManaged.shortfall.provider', {
        defaultValue: 'The payment provider is not configured. An administrator must finish billing setup.' });
      case 'ineligible': return t('coManaged.shortfall.ineligible', {
        defaultValue: 'The sponsoring workspace is not eligible for more co-managed capacity.' });
      default: return t('coManaged.shortfall.needsAdmin', {
        defaultValue: 'This allocation needs more pool capacity. An account administrator must add it.' });
    }
  }, [t]);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      let current = billing;
      if (!current) { current = await getCoManagedBillingState(); setBilling(current); }
      const additional = Math.max(0, seats - allocated);
      const shortfall = Math.max(0, additional - current.available);
      if (shortfall === 0) { await resize(); return; }
      if (current.selfHosted || current.purchase?.canPurchase !== true) { setError(explainShortfall(current)); return; }
      // Absolute pool target: the current purchased pool plus the shortfall.
      const target = current.capacity + shortfall;
      const quote = await previewCoManagedSeatsAction(target);
      setReview({ target, baseline: current.capacity, monthlyTotal: quote.monthlyTotal, amountDue: quote.amountDue, currency: quote.currency });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('coManaged.provisioning.resizeError', { defaultValue: 'Could not change the allocation. Refresh and try again.' }));
      await loadBilling();
    } finally { setBusy(false); }
  };

  const confirmPurchase = async (quote: Quote) => {
    setBusy(true); setError(null);
    try {
      // A changed pool baseline invalidates an unsubmitted quote; re-read and
      // require a fresh review rather than reusing a stale price or target.
      const before = await getCoManagedBillingState();
      if (before.capacity !== quote.baseline) {
        setReview(null); setBilling(before);
        setError(t('coManaged.shortfall.baselineChanged', {
          defaultValue: 'The pool changed since this quote. Review the shortfall again.' }));
        return;
      }
      const nextOperation = purchaseOperationId ?? newCoManagedOperationId();
      if (!purchaseOperationId) setPurchaseOperationId(nextOperation);
      const result = await purchaseCoManagedSeatsAction({ quantity: quote.target, operationId: nextOperation });
      if (result.kind === 'checkout') {
        if (!result.publishableKey) {
          setReview(null); setPendingQuote(null);
          setError(t('coManaged.checkoutUnavailable', { defaultValue: 'Embedded checkout is unavailable. Retry after the payment setup is repaired.' }));
          await loadBilling();
          return;
        }
        setPendingQuote(quote);
        setReview(null);
        setCheckout({ clientSecret: result.clientSecret, publishableKey: result.publishableKey });
        return;
      }
      setReview(null); setPendingQuote(null); setCheckout(null);
      if (result.kind === 'expired') {
        // Only an acknowledged terminal expiry permits a new operation.
        setPurchaseOperationId(null);
        setError(t('coManaged.checkoutExpired', { defaultValue: 'The checkout session expired. Review the purchase again.' }));
        await loadBilling();
        return;
      }
      setPurchaseOperationId(null);
      const after = await getCoManagedBillingState();
      setBilling(after);
      if (after.capacity >= quote.target) {
        // Entitlement is verified; complete the prepared allocation in the same
        // view. A competing allocation leaves the seats in the shared pool.
        try { await resize(); return; }
        catch { setError(t('coManaged.shortfall.raceRetry', {
          defaultValue: 'The seats are in the pool. The allocation could not be saved yet; retry it.' })); return; }
      }
      setError(t('coManaged.shortfall.confirming', {
        defaultValue: 'Purchased capacity is being verified. Refresh, then save the allocation again.' }));
    } catch (err) {
      // Ambiguous response: keep the frozen operation and quantity; recovery
      // continues on the same operation rather than starting a second charge.
      setError(err instanceof Error ? err.message : t('coManaged.purchaseError'));
      await loadBilling();
    } finally { setBusy(false); }
  };

  const shortfall = review && billing ? review.target - review.baseline : 0;
  return (
    <>
      <Button id={`${idPrefix}-seats-open`} variant="outline" size="sm" onClick={openDialog}>
        {t('coManaged.provisioning.resize', { defaultValue: 'Change seats' })}
      </Button>
      <Dialog id={`${idPrefix}-seats-dialog`} isOpen={open} onClose={() => { if (!busy) setOpen(false); }}
        title={t('coManaged.provisioning.resize', { defaultValue: 'Change seats' })}>
        <div className="space-y-4">
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          {billing?.selfHosted && <Button id={`${idPrefix}-manage-license`} variant="link" className="h-auto p-0 text-sm" asChild>
            <Link href={`/msp/licenses?returnTo=${encodeURIComponent(returnTo)}`}>{t('coManaged.manageLicense', { defaultValue: 'Manage license' })}</Link>
          </Button>}
          <p>{t('coManaged.provisioning.resizeDescription', { defaultValue: 'Set this client\'s technician allocation.' })}</p>
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-seats-input`}>{t('coManaged.provisioning.seats', { defaultValue: 'Technician seats' })}</Label>
            <Input id={`${idPrefix}-seats-input`} type="number" min={minimum} step={1} value={seats} disabled={busy || Boolean(checkout)}
              onChange={(event) => changeSeats(Number(event.target.value))} />
            {billing && <p className="text-sm text-muted-foreground">{t('coManaged.shortfall.pool', {
              defaultValue: 'Pool: {{capacity}} purchased, {{allocated}} allocated, {{available}} available',
              capacity: billing.capacity, allocated: billing.allocated, available: billing.available }) }</p>}
          </div>
          <div className="flex gap-2">
            <Button id={`${idPrefix}-seats-save`} disabled={busy || !Number.isInteger(seats) || seats < minimum}
              onClick={() => void save()}>{t('coManaged.provisioning.saveAllocation', { defaultValue: 'Save allocation' })}</Button>
            <Button id={`${idPrefix}-seats-cancel`} variant="outline" disabled={busy}
              onClick={() => setOpen(false)}>{t('common.actions.cancel', { defaultValue: 'Cancel' })}</Button>
          </div>
        </div>
      </Dialog>
      <Dialog id={`${idPrefix}-shortfall-review`} isOpen={review !== null} onClose={() => { if (!busy) setReview(null); }}
        title={t('coManaged.confirmTitle', { defaultValue: 'Review purchase' })}>
        {review && <div className="space-y-4">
          <p>{t('coManaged.shortfall.review', { defaultValue: 'Add {{additional}} seats to the sponsor pool (new total {{total}}).',
            additional: shortfall, total: review.target })}</p>
          <p>{t('coManaged.monthlyTotal', { count: review.target, amount: formatCurrency(review.monthlyTotal / 100, review.currency) })}</p>
          <p>{t('coManaged.dueNow', { amount: formatCurrency(review.amountDue / 100, review.currency) })}</p>
          <Button id={`${idPrefix}-shortfall-confirm`} disabled={busy} onClick={() => void confirmPurchase(review)}>
            {t('coManaged.confirmPurchase', { defaultValue: 'Confirm purchase' })}
          </Button>
        </div>}
      </Dialog>
      <Dialog id={`${idPrefix}-shortfall-checkout`} isOpen={checkout !== null} onClose={() => setCheckout(null)}
        title={t('coManaged.checkoutTitle', { defaultValue: 'Checkout' })}>
        {checkout && <CoManagedCheckout {...checkout} onComplete={() => { setCheckout(null); if (pendingQuote) void confirmPurchase(pendingQuote); }} />}
      </Dialog>
    </>
  );
}
