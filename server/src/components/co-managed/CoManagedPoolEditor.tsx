'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { BentoStat, BentoTile } from '@alga-psa/ui/components/bento';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { currencyFractionDigits } from '@alga-psa/core/formatters';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import CoManagedCheckout from '@enterprise/components/co-managed/CoManagedCheckout';
import { useCoManagedPurchaseController } from './useCoManagedPurchaseController';

const GHOST_ACTION = 'inline-flex items-center gap-0.5 text-xs font-semibold text-primary-600 hover:text-primary-800 whitespace-nowrap';

/**
 * Hosted sponsor pool editor. Increases the absolute purchased pool, permits reductions and
 * pending-operation recovery, and keeps financial confirmation explicit. Self-host capacity changes
 * route to License Management instead. Renders nothing while the server reports the purchase surface
 * closed (kill switch, release flag, price id unset, or not a PSA workspace).
 */
export default function CoManagedPoolEditor({ showTotals = false, className, refreshVersion = 0, onChanged }: { showTotals?: boolean; className?: string; refreshVersion?: number; onChanged?: () => Promise<void> }) {
  const { t } = useTranslation('msp/licensing');
  const { formatCurrency, formatDate } = useFormatters();
  const { state, closed, quantity, setQuantity, preview, setPreview, checkout, setCheckout, busy, error, setError, reload, review, purchase } =
    useCoManagedPurchaseController();

  useEffect(() => {
    void reload().catch(() => setError(t('coManaged.loadError')));
  }, [reload, setError, t, refreshVersion]);

  // Amounts arrive in the configured price's minor units and currency; never assume either.
  const money = (minor: number, currency: string) => formatCurrency(minor / 10 ** currencyFractionDigits(currency), currency);
  const message = error === 'expired' ? t('coManaged.checkoutExpired', { defaultValue: 'The checkout session expired. Review the purchase again.' })
    : error === 'checkoutUnavailable' ? t('coManaged.checkoutUnavailable', { defaultValue: 'Embedded checkout is unavailable. Retry after the payment setup is repaired.' })
      : error === 'preview' ? t('coManaged.previewError', { defaultValue: 'Could not price this change. Refresh and try again.' })
        : error === 'purchase' ? t('coManaged.purchaseError', { defaultValue: 'The purchase could not be completed. Recover the same operation.' })
          : error;
  const reason = state?.purchase.reason;
  const confirmPurchase = async (nextQuantity?: number) => {
    const outcome = await purchase(nextQuantity);
    if (outcome === 'updated') {
      await reload();
      await onChanged?.();
    }
  };

  if (closed) return null;

  return (
    <>
      <BentoTile
        id="co-managed-pool-editor"
        className={className}
        title={t('coManaged.seatPool')}
        subtitle={t('coManaged.seatDescription')}
        action={state?.selfHosted ? (
          <Link id="co-managed-manage-license" href="/msp/licenses" className={GHOST_ACTION}>
            {t('coManaged.manageLicense')}
            <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        ) : state?.purchase.canPurchase ? (
          <button id="co-managed-review-purchase" type="button"
            disabled={busy || !Number.isInteger(quantity) || quantity < state.allocated || quantity > 100000}
            onClick={() => void review(quantity)} className={`${GHOST_ACTION} disabled:opacity-50`}>
            {t('coManaged.reviewPurchase')}
            <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
          </button>
        ) : undefined}
      >
        {showTotals && state && (
          <div className="mb-4 flex flex-wrap gap-x-8 gap-y-3">
            {(['capacity', 'allocated', 'available'] as const).map((key) => (
              <BentoStat key={key} value={state[key]} label={t(`coManaged.${key}`)} />
            ))}
          </div>
        )}
        <div className="space-y-4">
          {message && <Alert variant="destructive"><AlertDescription>{message}</AlertDescription></Alert>}
          {!state && !message && <p role="status">{t('coManaged.loading')}</p>}
          {state && <>
            {state.graceEndsAt && <p role="status">{t(state.isReadOnly ? 'coManaged.readOnly' : 'coManaged.grace', { date: formatDate(new Date(state.graceEndsAt)) })}</p>}
            {!state.selfHosted && (state.purchase.canResume ? <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-muted-foreground">{t('coManaged.pendingCapacity', { defaultValue: 'A purchase of {{count}} seats is pending.', count: state.purchase.pending?.quantity ?? quantity })}</p>
              <Button id="co-managed-resume-purchase" disabled={busy} onClick={() => void confirmPurchase(state.purchase.pending?.quantity)}>
                {t('coManaged.resumePurchase')}
              </Button>
            </div> : state.purchase.canPurchase ? <div className="space-y-2">
              <Label htmlFor="co-managed-seat-quantity">{t('coManaged.quantity')}</Label>
              <Input id="co-managed-seat-quantity" type="number" min={state.allocated} max={100000} step={1}
                value={quantity} disabled={busy} onChange={(event) => setQuantity(Number(event.target.value))} />
            </div> : reason === 'no_permission' ? <p className="text-sm italic text-muted-foreground">{t('coManaged.purchaseNeedsAdmin', { defaultValue: 'An account administrator must add co-managed capacity.' })}</p>
              : reason === 'ineligible' ? <p className="text-sm italic text-muted-foreground">{t('coManaged.proRequired')}</p>
                : reason === 'implementation_unavailable' ? <p className="text-sm italic text-muted-foreground">{t('coManaged.purchaseUnavailable', { defaultValue: 'Hosted co-managed purchasing is not available in this deployment.' })}</p>
                  : null)}
          </>}
        </div>
      </BentoTile>
      <Dialog id="co-managed-purchase-review" isOpen={preview !== null} onClose={() => { if (!busy) setPreview(null); }} title={t('coManaged.confirmTitle')}>
        {preview && <div className="space-y-4">
          <p>{t('coManaged.monthlyTotal', { count: preview.quantity, amount: money(preview.monthlyTotal, preview.currency) })}</p>
          <p>{t('coManaged.dueNow', { amount: money(preview.amountDue, preview.currency) })}</p>
          <Button id="co-managed-confirm-purchase" disabled={busy} onClick={() => void confirmPurchase()}>{t('coManaged.confirmPurchase')}</Button>
        </div>}
      </Dialog>
      <Dialog id="co-managed-checkout" isOpen={checkout !== null} onClose={() => setCheckout(null)} title={t('coManaged.checkoutTitle')}>
        {checkout && <CoManagedCheckout {...checkout} onComplete={() => { setCheckout(null); void confirmPurchase(); }} />}
      </Dialog>
    </>
  );
}
