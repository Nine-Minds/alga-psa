'use client';

import React, { useEffect, useRef } from 'react';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { BentoStat, BentoTile } from '@alga-psa/ui/components/bento';
import { Progress } from '@alga-psa/ui/components/Progress';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import CoManagedPurchaseReview, { coManagedPurchaseErrorMessage } from './CoManagedPurchaseReview';
import { useCoManagedPurchaseController } from './useCoManagedPurchaseController';
import { announceCoManagedAccessChanged } from './accessRefresh';
import CoManagedPoolQuantity from './CoManagedPoolQuantity';
import { useCoManagedUnitPrice } from './useCoManagedUnitPrice';

const GHOST_ACTION = 'inline-flex items-center gap-0.5 text-xs font-semibold text-primary-600 hover:text-primary-800 whitespace-nowrap';

/**
 * Hosted sponsor pool editor. Increases the absolute purchased pool, permits reductions and
 * pending-operation recovery, and keeps financial confirmation explicit. Self-host capacity changes
 * route to License Management instead. Renders nothing while the server reports the purchase surface
 * closed (kill switch, release flag, price id unset, or not a PSA workspace).
 */
export default function CoManagedPoolEditor({ showTotals = false, className, refreshVersion = 0, onChanged, explainer, clientsHref }: {
  showTotals?: boolean; className?: string; refreshVersion?: number; onChanged?: () => Promise<void>;
  /** Shown beside the purchase box before the first purchase (what co-managed IT is, how it works). Account Management omits it. */
  explainer?: React.ReactNode;
  /** Where "free to allocate" seats are assigned. Supplied only to actors who may open clients; without it there is no link. */
  clientsHref?: string;
}) {
  const { t } = useTranslation('msp/licensing');
  const { formatDate } = useFormatters();
  const controller = useCoManagedPurchaseController();
  const { state, closed, quantity, setQuantity, busy, error, setError, reload, review, purchase } = controller;

  useEffect(() => {
    void reload().catch(() => setError(t('coManaged.loadError')));
  }, [reload, setError, t, refreshVersion]);

  // Verified capacity moved (reconciliation completed, in this session or while away): server-derived
  // access and permission state is stale wherever it is cached, so ask for a fresh read.
  const lastCapacity = useRef<number | null>(null);
  const verifiedCapacity = state?.capacity ?? null;
  useEffect(() => {
    if (verifiedCapacity === null) return;
    if (lastCapacity.current !== null && lastCapacity.current !== verifiedCapacity) announceCoManagedAccessChanged();
    lastCapacity.current = verifiedCapacity;
  }, [verifiedCapacity]);

  const message = coManagedPurchaseErrorMessage(error, t);
  const reason = state?.purchase.reason;
  const confirmPurchase = async (nextQuantity?: number) => {
    const outcome = await purchase(nextQuantity);
    if (outcome === 'updated') {
      await reload();
      await onChanged?.();
    }
  };
  // The unit price is read only where the quantity control is offered; it never gates the control.
  const price = useCoManagedUnitPrice(Boolean(state?.purchase.canPurchase) && !state?.selfHosted, state?.capacity ?? 0);

  if (closed) return null;

  const owned = (state?.capacity ?? 0) > 0;
  const quantityValid = Boolean(state) && Number.isInteger(quantity) && quantity >= (state?.purchase.minimumQuantity ?? 1) && quantity <= 100000;

  // What the pool offers right now: the quantity control, or the existing state that replaces it.
  // Each of these has a place in both layouts (the purchase box before seats, the change section after).
  const action = !state || state.selfHosted ? null
    : state.purchase.canResume ? <div className="flex flex-wrap items-center gap-3">
      <p className="text-sm text-muted-foreground">{t('coManaged.pendingCapacity', { defaultValue: 'A purchase of {{count}} seats is pending.', count: state.purchase.pending?.quantity ?? quantity })}</p>
      <Button id="co-managed-resume-purchase" disabled={busy} onClick={() => void confirmPurchase(state.purchase.pending?.quantity)}>
        {t('coManaged.resumePurchase')}
      </Button>
    </div> : state.purchase.canPurchase ? <CoManagedPoolQuantity purchased={state.capacity} quantity={quantity} onQuantityChange={setQuantity}
      min={state.purchase.minimumQuantity} max={100000} busy={busy} price={price} onReview={() => void review(quantity)} />
      : reason === 'awaiting_verification' && state.purchase.awaitingVerification ? <div id="co-managed-awaiting-verification" role="status" className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">{t('coManaged.awaitingVerification', { count: state.purchase.awaitingVerification.quantity,
          defaultValue: 'Your purchase of {{count}} seats is awaiting payment verification. The seats appear here once the payment is confirmed.' })}</p>
        <Button id="co-managed-refresh-purchase" variant="outline" disabled={busy}
          onClick={() => void reload().catch(() => setError(t('coManaged.loadError')))}>
          {t('coManaged.refreshStatus', { defaultValue: 'Refresh status' })}
        </Button>
      </div> : reason === 'no_permission' ? <p className="text-sm italic text-muted-foreground">{t('coManaged.purchaseNeedsAdmin', { defaultValue: 'An account administrator must add co-managed capacity.' })}</p>
        : reason === 'ineligible' ? <p className="text-sm italic text-muted-foreground">{t('coManaged.proRequired')}</p>
          : reason === 'implementation_unavailable' ? <p className="text-sm italic text-muted-foreground">{t('coManaged.purchaseUnavailable', { defaultValue: 'Hosted co-managed purchasing is not available in this deployment.' })}</p>
            : null;

  return (
    <>
      <BentoTile
        id="co-managed-pool-editor"
        className={className}
        title={explainer && !owned ? undefined : t('coManaged.seatPool')}
        subtitle={explainer && !owned ? undefined : t('coManaged.seatDescription')}
        action={state?.selfHosted ? (
          <Link id="co-managed-manage-license" href="/msp/licenses" className={GHOST_ACTION}>
            {t('coManaged.manageLicense')}
            <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        ) : state?.purchase.canPurchase && owned ? (
          // Same control and destination as the corner action had; only its words changed.
          <button id="co-managed-review-purchase" type="button" disabled={busy || !quantityValid}
            onClick={() => void review(quantity)} className={`${GHOST_ACTION} disabled:opacity-50`}>
            {t('coManaged.manageBilling')}
            <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
          </button>
        ) : undefined}
      >
        <div className="space-y-4">
          {message && <Alert variant="destructive"><AlertDescription>{message}</AlertDescription></Alert>}
          {!state && !message && <p role="status">{t('coManaged.loading')}</p>}
          {state?.graceEndsAt && <p role="status">{t(state.isReadOnly ? 'coManaged.readOnly' : 'coManaged.grace', { date: formatDate(new Date(state.graceEndsAt)) })}</p>}
          {state && owned && <>
            {showTotals && <div className="space-y-3">
              <div className="flex flex-wrap gap-x-10 gap-y-3">
                {(['capacity', 'allocated', 'available'] as const).map((key) => (
                  <BentoStat key={key} value={state[key]} label={t(`coManaged.${key}`)} />
                ))}
              </div>
              <Progress value={state.allocated} max={state.capacity} size="md"
                aria-label={t('coManaged.usage', { allocated: state.allocated, purchased: state.capacity })} />
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm text-[rgb(var(--color-text-600))]">
                <p id="co-managed-free-seats">{state.available > 0 ? t('coManaged.freeToAllocate', { count: state.available }) : t('coManaged.noneFree')}</p>
                {clientsHref && <Link id="co-managed-clients-link" href={clientsHref} className={GHOST_ACTION}>
                  {t('coManaged.goToClients')}
                  <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                </Link>}
              </div>
            </div>}
            {action && <section id="co-managed-change-seats" className="space-y-3 border-t border-[rgb(var(--color-border-100))] pt-4">
              <h3 className="text-base font-semibold text-[rgb(var(--color-text-900))]">{t('coManaged.changeTitle')}</h3>
              {action}
            </section>}
          </>}
          {state && !owned && (
            <div className={explainer ? 'grid gap-6 md:grid-cols-[3fr_2fr]' : undefined}>
              {explainer}
              <section id="co-managed-buy-seats" className="space-y-3 rounded-lg border border-[rgb(var(--color-border-200))] p-5">
                <h3 className="text-lg font-semibold text-[rgb(var(--color-text-900))]">{t('coManaged.buySeats', { defaultValue: 'Buy co-managed seats' })}</h3>
                <p className="text-sm text-[rgb(var(--color-text-600))]">{t('coManaged.noSeatsYet')}</p>
                {action}
              </section>
            </div>
          )}
        </div>
      </BentoTile>
      <CoManagedPurchaseReview controller={controller} onConfirmed={async (outcome) => {
        if (outcome === 'updated') {
          await reload();
          await onChanged?.();
        }
      }} />
    </>
  );
}
