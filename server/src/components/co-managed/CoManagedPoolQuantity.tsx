'use client';

import React from 'react';
import { Minus, Plus } from 'lucide-react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { currencyFractionDigits } from '@alga-psa/core/formatters';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { CoManagedUnitPrice } from './useCoManagedUnitPrice';

/**
 * The quantity row of the seat pool: label, stepper, price, what the change means, and the review
 * button. The quantity is the new pool total; `purchased` is the pool today, and everything the row
 * says about the change (adding, removing, old → new, price difference) derives from the two. With no
 * seats purchased there is no "old" to compare to, so the row prices the purchase instead.
 */
export default function CoManagedPoolQuantity({ idPrefix = 'co-managed', purchased, quantity, onQuantityChange, min, max, busy, price, onReview }: {
  idPrefix?: string;
  purchased: number;
  quantity: number;
  onQuantityChange: (quantity: number) => void;
  /** Smallest total the pool may hold (1 for a first purchase, otherwise the allocated seats). */
  min: number;
  max: number;
  busy: boolean;
  /** Per-seat price from the existing purchase preview; null when it cannot be read. */
  price: CoManagedUnitPrice | null;
  onReview: () => void;
}) {
  const { t } = useTranslation('msp/licensing');
  const { formatCurrency } = useFormatters();
  // LEVERAGE: pattern money-minor — minor units → formatCurrency written here, in CoManagedPurchaseReview and CoManagedSeatTrial; a shared `useMoney()` would remove it.
  const money = (minor: number) => price
    ? formatCurrency(minor / 10 ** currencyFractionDigits(price.currency), price.currency) : null;
  const owned = purchased > 0;
  const whole = Number.isInteger(quantity);
  const valid = whole && quantity >= min && quantity <= max;
  // A typed total under the allocated seats is refused here, with the reason, as the server refuses it.
  const belowAllocated = owned && whole && quantity < min;
  const delta = whole ? quantity - purchased : 0;
  const total = price && whole && quantity >= 0 ? money(price.unitAmount * quantity) : null;
  const difference = price && delta !== 0 ? `${delta > 0 ? '+' : ''}${money(price.unitAmount * delta)}` : null;
  const step = (by: number) => onQuantityChange(Math.min(max, Math.max(min, (whole ? quantity : purchased) + by)));
  const inputId = `${idPrefix}-seat-quantity`;
  const label = owned ? t('coManaged.quantity') : t('coManaged.howMany');

  return (
    <div className="space-y-3">
      <Label htmlFor={inputId} className={owned ? 'sr-only' : 'text-base font-semibold'}>{label}</Label>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="inline-flex items-center gap-1">
          <Button id={`${idPrefix}-seat-decrease`} type="button" variant="outline" size="sm" aria-label={t('coManaged.decreaseSeats')}
            disabled={busy || (whole && quantity <= min)} onClick={() => step(-1)}><Minus className="h-4 w-4" aria-hidden="true" /></Button>
          <Input id={inputId} type="number" min={min} max={max} step={1} className="w-20 text-center" containerClassName="mb-0"
            value={whole ? quantity : ''} disabled={busy} onChange={(event) => onQuantityChange(Number(event.target.value))} />
          <Button id={`${idPrefix}-seat-increase`} type="button" variant="outline" size="sm" aria-label={t('coManaged.increaseSeats')}
            disabled={busy || (whole && quantity >= max)} onClick={() => step(1)}><Plus className="h-4 w-4" aria-hidden="true" /></Button>
        </div>
        {owned ? (
          valid && delta !== 0 && <div id={`${idPrefix}-seat-change`} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[rgb(var(--color-text-700))]">
            <Badge variant={delta > 0 ? 'success' : 'warning'}>
              {t(delta > 0 ? 'coManaged.adding' : 'coManaged.removing', { count: Math.abs(delta) })}
            </Badge>
            <span>{t('coManaged.fromTo', { from: purchased, to: quantity })}</span>
            {total && <span>{t('coManaged.monthlyWithDifference', { total, difference })}</span>}
          </div>
        ) : (
          valid && total && <div id={`${idPrefix}-seat-price`}>
            <p className="text-sm text-[rgb(var(--color-text-600))]"><span className="text-xl font-bold text-[rgb(var(--color-text-900))]">{total}</span> {t('coManaged.perMonth')}</p>
            <p className="text-xs text-[rgb(var(--color-text-500))]">{t('coManaged.priceBreakdown', { count: quantity, unit: money(price!.unitAmount) })}</p>
          </div>
        )}
      </div>
      {belowAllocated && <p id={`${idPrefix}-seat-below-allocated`} role="alert" className="text-sm text-destructive">
        {t('coManaged.belowAllocated', { count: min })}
      </p>}
      <Button id={`${idPrefix}-review-seats`} type="button" disabled={busy || !valid || quantity === purchased} onClick={onReview}>
        {t(owned ? 'coManaged.reviewChange' : 'coManaged.reviewPurchase')}
      </Button>
      {!owned && <p className="text-sm text-[rgb(var(--color-text-500))]">{t('coManaged.reviewHint')}</p>}
    </div>
  );
}
