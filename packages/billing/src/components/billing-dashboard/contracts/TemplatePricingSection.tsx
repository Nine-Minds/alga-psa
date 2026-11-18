'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import CurrencyPicker from '@alga-psa/ui/components/CurrencyPicker';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { isActionMessageError, isActionPermissionError, getErrorMessage } from '@alga-psa/ui/lib/errorHandling';
import {
  getContractTemplatePricing,
  saveContractTemplatePriceSet,
  deleteContractTemplatePriceSet,
  type ContractTemplatePricing,
} from '@alga-psa/billing/actions/contractTemplatePriceSetActions';
import { TemplateAmountInput } from './TemplateAmountInput';
import { useTemplateMoney } from './useTemplateMoney';

interface TemplatePricingSectionProps {
  templateId: string;
  /** Bumped by the parent after structure changes so the grid reloads. */
  reloadToken?: number;
}

type Drafts = Record<string, Record<string, number | undefined>>;

/**
 * Slots x currencies grid: the base currency is read-only (it lives in the
 * template's own columns), every other currency is a price set that is saved or
 * removed as a whole. Amounts are never converted between currencies.
 */
// LEVERAGE: pattern currency-price-grid — same slots-by-currency grid shape as ServiceCatalogManager's per-currency prices
export function TemplatePricingSection({ templateId, reloadToken }: TemplatePricingSectionProps) {
  const { t } = useTranslation('msp/contracts');
  const [pricing, setPricing] = useState<ContractTemplatePricing | null>(null);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [newCurrency, setNewCurrency] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const baseMoney = useTemplateMoney(pricing?.base_currency ?? 'USD');

  const load = useCallback(async () => {
    const result = await getContractTemplatePricing(templateId);
    if (isActionMessageError(result) || isActionPermissionError(result)) {
      setError(getErrorMessage(result));
      return;
    }
    setError(null);
    setPricing(result);
    const next: Drafts = {};
    for (const set of result.sets) next[set.currency_code] = { ...set.amounts };
    setDrafts(next);
  }, [templateId]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  if (!pricing) {
    return error ? (
      <Alert variant="destructive">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    ) : null;
  }

  const rows = pricing.slots.filter((slot) => slot.required);
  const currencies = Object.keys(drafts);
  const canEdit = pricing.can_edit;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      const result = await action();
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        setError(getErrorMessage(result));
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const addCurrency = () => {
    const code = newCurrency.trim().toUpperCase();
    if (!code || code === pricing.base_currency || drafts[code]) return;
    setDrafts((prev) => ({ ...prev, [code]: {} }));
    setNewCurrency('');
  };

  const setAmount = (currency: string, slotKey: string, cents: number | undefined) =>
    setDrafts((prev) => ({ ...prev, [currency]: { ...prev[currency], [slotKey]: cents } }));

  const save = (currency: string) =>
    run(() => {
      const amounts: Record<string, number> = {};
      for (const [key, value] of Object.entries(drafts[currency] ?? {})) {
        if (value !== undefined) amounts[key] = value;
      }
      return saveContractTemplatePriceSet(templateId, currency, amounts);
    });

  const remove = (currency: string) => {
    const persisted = pricing.sets.some((set) => set.currency_code === currency);
    if (!persisted) {
      setDrafts((prev) => {
        const { [currency]: _removed, ...rest } = prev;
        return rest;
      });
      return Promise.resolve();
    }
    return run(() => deleteContractTemplatePriceSet(templateId, currency));
  };

  return (
    <Card id="template-pricing-section">
      <CardHeader>
        <CardTitle>{t('templateDetail.pricing.title', { defaultValue: 'Pricing by currency' })}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('templateDetail.pricing.noSlots', { defaultValue: 'This template has no amounts to price yet.' })}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  <th className="pr-4 py-2 font-medium">&nbsp;</th>
                  <th className="px-2 py-2 font-medium">
                    {pricing.base_currency}{' '}
                    <span className="text-xs text-muted-foreground">
                      {t('templateDetail.pricing.baseCurrency', { defaultValue: '(base)' })}
                    </span>
                  </th>
                  {currencies.map((currency) => {
                    const set = pricing.sets.find((s) => s.currency_code === currency);
                    return (
                      <th key={currency} className="px-2 py-2 font-medium">
                        <div className="flex items-center gap-2">
                          <span>{currency}</span>
                          {canEdit && (
                            <>
                              <Button
                                id={`template-pricing-save-${currency}`}
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                onClick={() => void save(currency)}
                              >
                                {t('common.actions.save', { defaultValue: 'Save' })}
                              </Button>
                              <Button
                                id={`template-pricing-remove-${currency}`}
                                size="sm"
                                variant="ghost"
                                disabled={busy}
                                onClick={() => void remove(currency)}
                              >
                                {t('templateDetail.pricing.removeCurrency', { defaultValue: 'Remove' })}
                              </Button>
                            </>
                          )}
                        </div>
                        {set && set.missing_slot_keys.length > 0 && (
                          <p className="text-xs font-normal text-amber-700">
                            {t('templateDetail.pricing.missing', {
                              defaultValue: '{{count}} amount(s) missing',
                              count: set.missing_slot_keys.length,
                            })}
                          </p>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((slot) => (
                  <tr key={slot.slot_key} className="border-t">
                    <td className="pr-4 py-2">{slot.label}</td>
                    <td className="px-2 py-2 text-muted-foreground">{baseMoney(slot.base_amount)}</td>
                    {currencies.map((currency) => (
                      <td key={currency} className="px-2 py-2">
                        <TemplateAmountInput
                          id={`template-pricing-${currency}-${slot.slot_key}`}
                          currency={currency}
                          valueCents={drafts[currency]?.[slot.slot_key]}
                          disabled={!canEdit || busy}
                          aria-label={`${slot.label} ${currency}`}
                          onCommit={(cents) => setAmount(currency, slot.slot_key, cents)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canEdit && (
          <div className="flex items-end gap-2">
            <div className="w-48">
              <CurrencyPicker
                id="template-pricing-add-currency"
                value={newCurrency}
                onValueChange={setNewCurrency}
                placeholder={t('templateDetail.pricing.addCurrency', { defaultValue: 'Add currency' })}
              />
            </div>
            <Button id="template-pricing-add-btn" variant="outline" disabled={!newCurrency || busy} onClick={addCurrency}>
              {t('templateDetail.pricing.addCurrency', { defaultValue: 'Add currency' })}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
