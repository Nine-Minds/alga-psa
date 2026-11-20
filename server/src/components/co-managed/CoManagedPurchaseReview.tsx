'use client';

import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { currencyFractionDigits } from '@alga-psa/core/formatters';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import CoManagedCheckout from '@enterprise/components/co-managed/CoManagedCheckout';
import type { useCoManagedPurchaseController } from './useCoManagedPurchaseController';

type Controller = ReturnType<typeof useCoManagedPurchaseController>;
type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The words for a controller error code; unknown values are already text. */
export function coManagedPurchaseErrorMessage(error: string | null, t: Translate): string | null {
  const blockedMessages: Record<string, { key: string; fallback: string }> = {
    customer_unverified: { key: 'billingCustomerUnlinked', fallback: 'We could not verify a Stripe billing account for this workspace. Contact support to have it linked.' },
    no_current_pro: { key: 'proSubscriptionRequired', fallback: 'Co-managed seats require a current Pro subscription. Check your subscription in Account Management.' },
    offer_paused: { key: 'offerPaused', fallback: 'New seat purchases are paused. Contact your account manager for an update.' },
    offer_changed: { key: 'termsChanged', fallback: 'The price changed after you reviewed it. Review the updated terms before confirming.' },
    misconfigured: { key: 'offerMisconfigured', fallback: 'The co-managed seat offer is not configured correctly. Contact support for help.' },
  };
  if (error && blockedMessages[error]) {
    const { key, fallback } = blockedMessages[error];
    return t(`coManaged.${key}`, { defaultValue: fallback });
  }
  return error === 'expired' ? t('coManaged.checkoutExpired', { defaultValue: 'The checkout session expired. Review the purchase again.' })
    : error === 'checkoutUnavailable' ? t('coManaged.checkoutUnavailable', { defaultValue: 'Embedded checkout is unavailable. Retry after the payment setup is repaired.' })
      : error === 'termsChanged' ? t('coManaged.termsChanged', { defaultValue: 'The price changed after you reviewed it. Review the updated terms before confirming.' })
      : error === 'offerUnavailable' ? t('coManaged.offerUnavailable', { defaultValue: 'New seat purchases are temporarily unavailable. Nothing was charged.' })
      : error === 'preview' ? t('coManaged.previewError', { defaultValue: 'Could not price this change. Refresh and try again.' })
        : error === 'purchase' ? t('coManaged.purchaseError', { defaultValue: 'The purchase could not be completed. Recover the same operation.' })
          : error;
}

/**
 * The pool purchase review and its embedded checkout, driven by `useCoManagedPurchaseController`. One
 * component for the account pool editor and the seat setup, so a quote reads the same wherever it is
 * offered. Amounts arrive in the configured Stripe price's minor units and currency; neither is assumed.
 */
export default function CoManagedPurchaseReview({ controller, idPrefix = 'co-managed', onConfirmed }: {
  controller: Controller;
  idPrefix?: string;
  /** Receives the controller's outcome for a confirmed purchase or a completed checkout. */
  onConfirmed: (outcome: Awaited<ReturnType<Controller['purchase']>>) => Promise<void> | void;
}) {
  const { t } = useTranslation('msp/licensing');
  const { formatCurrency } = useFormatters();
  const { preview, setPreview, checkout, setCheckout, busy, purchase } = controller;
  const money = (minor: number, currency: string) => formatCurrency(minor / 10 ** currencyFractionDigits(currency), currency);
  const confirm = async () => { await onConfirmed(await purchase()); };

  return (
    <>
      <Dialog id={`${idPrefix}-purchase-review`} isOpen={preview !== null} onClose={() => { if (!busy) setPreview(null); }} title={t('coManaged.confirmTitle')}>
        {preview && <div className="space-y-4">
          <p>{t('coManaged.monthlyTotal', { count: preview.quantity, amount: money(preview.monthlyTotal, preview.currency) })}</p>
          <p>{t('coManaged.dueNow', { amount: money(preview.amountDue, preview.currency) })}</p>
          <Button id={`${idPrefix}-confirm-purchase`} disabled={busy} onClick={() => void confirm()}>{t('coManaged.confirmPurchase')}</Button>
        </div>}
      </Dialog>
      <Dialog id={`${idPrefix}-checkout`} isOpen={checkout !== null} onClose={() => setCheckout(null)} title={t('coManaged.checkoutTitle')}>
        {checkout && <CoManagedCheckout {...checkout} onComplete={() => { setCheckout(null); void confirm(); }} />}
      </Dialog>
    </>
  );
}
