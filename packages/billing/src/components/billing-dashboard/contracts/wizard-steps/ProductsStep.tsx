'use client';

import React, { useMemo } from 'react';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { CurrencyInput } from '@alga-psa/ui/components/CurrencyInput';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import { primeProductCatalogRates, useProductCatalogRates } from '../../../../hooks/useProductCatalogRates';
import { productUnitMarginCents } from '../../../../lib/productUnitMargin';
import { ServiceCatalogPicker, ServiceCatalogPickerItem } from '../ServiceCatalogPicker';
import type { ContractWizardData } from '../ContractWizard';
import { BillingTimingField } from '../BillingTimingField';
import { Plus, X, Package } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface ProductsStepProps {
  data: ContractWizardData;
  updateData: (data: Partial<ContractWizardData>) => void;
}

export function ProductsStep({ data, updateData }: ProductsStepProps) {
  const { t } = useTranslation('msp/contracts');
  const { money } = useCurrencyFormat();

  // Stable per-row key: the product id (plus an occurrence count when the same product is
  // attached twice); rows that have no product yet fall back to their position.
  const rowKeys = useMemo(() => {
    const seen = new Map<string, number>();
    return data.product_services.map((line, index) => {
      if (!line.service_id) return `new-${index}`;
      const occurrence = seen.get(line.service_id) ?? 0;
      seen.set(line.service_id, occurrence + 1);
      return `${line.service_id}:${occurrence}`;
    });
  }, [data.product_services]);

  // The draft holds only what the user chose (product, quantity, override). Catalog price and
  // cost always come from the shared lookup keyed by (contract currency, service id) — the same
  // one the Review step and Contract Lines use — so nothing here can go stale or drift by row.
  const { rates: catalogRates, canViewCost } = useProductCatalogRates(
    data.currency_code,
    data.product_services.map((line) => line.service_id),
  );

  const handleAddProduct = () => {
    updateData({
      product_services: [
        ...data.product_services,
        { service_id: '', service_name: '', quantity: 1, custom_rate: undefined },
      ],
    });
  };

  const handleRemoveProduct = (index: number) => {
    const next = data.product_services.filter((_, i) => i !== index);
    updateData({ product_services: next });
  };

  const handleProductChange = (index: number, item: ServiceCatalogPickerItem) => {
    // The picker row was fetched in the contract currency: hand its price to the shared lookup
    // so the row is priced at once (the lookup still fetches cost).
    primeProductCatalogRates(data.currency_code, item.service_id, {
      currency_rate: item.currency_rate ?? null,
      default_rate: item.default_rate ?? null,
    });
    const next = [...data.product_services];
    next[index] = {
      ...next[index],
      service_id: item.service_id,
      service_name: item.service_name,
      custom_rate: undefined,
    };
    updateData({ product_services: next });
  };

  // LEVERAGE: pattern clamped-number-input — the input's onChange clamps to min, so the field can't be cleared while typing; use QuantityInput
  const handleQuantityChange = (index: number, quantity: number) => {
    const next = [...data.product_services];
    next[index] = { ...next[index], quantity: Math.max(1, quantity || 1) };
    updateData({ product_services: next });
  };

  // The override is held in the draft only (minor units); CurrencyInput owns the text being typed.
  const handleOverrideChange = (index: number, amount: number | undefined) => {
    const next = [...data.product_services];
    next[index] = {
      ...next[index],
      custom_rate: amount === undefined ? undefined : Math.max(0, Math.round(amount * 100)),
    };
    updateData({ product_services: next });
  };

  return (
    <ReflectionContainer id="products-step">
      <div className="space-y-6">
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-2">{t('wizardProducts.heading', { defaultValue: 'Products' })}</h3>
          <p className="text-sm text-[rgb(var(--color-text-500))]">
            {t('wizardProducts.description', {
              defaultValue: 'Attach products that will be billed each cycle. Products use the catalog price for the contract currency unless you enter an override.',
            })}
          </p>
        </div>

        {data.product_services.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {t('wizardProducts.emptyState', {
              defaultValue: 'No products attached yet. Add a product if you want it to bill every cycle.',
            })}
          </div>
        ) : null}

        <div className="space-y-4">
          <Label className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            {t('wizardProducts.labels.products', { defaultValue: 'Products' })}
          </Label>

          {data.product_services.map((line, index) => {
            const lookup = line.service_id ? catalogRates[line.service_id] : undefined;
            // undefined = not known yet (lookup in flight): claim nothing about the price meanwhile.
            const currencyRate: number | null | undefined = lookup?.currency_rate;
            const legacyDefaultRate = lookup?.default_rate ?? null;
            const isMissingPrice = Boolean(
              line.service_id && currencyRate === null && line.custom_rate == null,
            );
            const effectiveUnitPrice =
              line.custom_rate ?? (currencyRate != null && currencyRate > 0 ? currencyRate : null);
            const showCost = canViewCost && lookup?.cost != null;
            const costCurrency = lookup?.cost_currency ?? null;
            const costInOtherCurrency = Boolean(costCurrency && costCurrency !== data.currency_code);
            const margin = showCost
              ? productUnitMarginCents(effectiveUnitPrice, lookup?.cost, costCurrency, data.currency_code)
              : null;

            return (
              <div
                key={rowKeys[index]}
                className="flex items-start gap-3 p-4 border border-[rgb(var(--color-border-200))] rounded-md bg-[rgb(var(--color-border-50))]"
              >
                <div className="flex-1 space-y-3">
                <div className="space-y-2">
                  <Label htmlFor={`product-${index}`} className="text-sm">
                    {t('wizardProducts.labels.productItem', {
                      defaultValue: 'Product {{index}}',
                      index: index + 1,
                    })}
                  </Label>
                  <ServiceCatalogPicker
                      id={`product-select-${index}`}
                      value={line.service_id}
                      selectedLabel={line.service_name}
                      onSelect={(item) => handleProductChange(index, item)}
                      itemKinds={['product']}
                      currencyCode={data.currency_code}
                      placeholder={t('wizardProducts.labels.selectProductPlaceholder', {
                        defaultValue: 'Select a product',
                      })}
                    />
                  </div>

                  <div className="flex items-start gap-4 flex-wrap">
                    <div className="space-y-2">
                      <Label htmlFor={`product-quantity-${index}`} className="text-sm">
                        {t('wizardProducts.labels.quantity', { defaultValue: 'Quantity' })}
                      </Label>
                      <Input
                        id={`product-quantity-${index}`}
                        type="number"
                        value={line.quantity}
                        onChange={(event) =>
                          handleQuantityChange(index, Math.max(1, Number(event.target.value) || 1))
                        }
                        min="1"
                        className="w-24"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor={`product-rate-${index}`} className="text-sm">
                        {t('wizardProducts.labels.overrideUnitPriceOptional', {
                          defaultValue: 'Override unit price (optional)',
                        })}
                      </Label>
                      <CurrencyInput
                        id={`product-rate-${index}`}
                        currencyCode={data.currency_code}
                        value={line.custom_rate !== undefined ? line.custom_rate / 100 : undefined}
                        onChange={(amount) => handleOverrideChange(index, amount)}
                        placeholder=""
                        containerClassName="w-40"
                      />
                      {currencyRate != null && currencyRate > 0 ? (
                        <div className="text-xs text-muted-foreground" data-testid={`product-catalog-price-${index}`}>
                          {t('wizardProducts.labels.catalogPriceInCurrency', {
                            defaultValue: 'Catalog price in {{currency}}:',
                            currency: data.currency_code,
                          })}{' '}
                          {money(currencyRate, data.currency_code)}
                        </div>
                      ) : currencyRate === null && line.service_id ? (
                        <div className="text-xs text-amber-700">
                          {legacyDefaultRate !== null && legacyDefaultRate > 0
                            ? t('wizardProducts.validation.noCurrencyPriceWithLegacyHint', {
                                defaultValue:
                                  'No {{currency}} price in the catalog. Legacy default rate: {{rate}}. Enter a unit price in {{currency}}.',
                                currency: data.currency_code,
                                rate: (legacyDefaultRate / 100).toFixed(2),
                              })
                            : t('wizardProducts.validation.noCurrencyPriceEnterUnitPrice', {
                                defaultValue:
                                  'No {{currency}} price in the catalog. Enter a unit price.',
                                currency: data.currency_code,
                              })}
                        </div>
                      ) : null}
                      {showCost ? (
                        <div className="text-xs text-muted-foreground" data-testid={`product-cost-${index}`}>
                          {costInOtherCurrency
                            ? t('wizardReview.products.costInCurrency', {
                                defaultValue: 'Cost in {{currency}}: {{cost}}',
                                currency: costCurrency,
                                cost: money(lookup?.cost ?? 0, costCurrency ?? data.currency_code),
                              })
                            : t('wizardReview.products.cost', {
                                defaultValue: 'Cost: {{cost}}',
                                cost: money(lookup?.cost ?? 0, data.currency_code),
                              })}
                          {margin !== null ? (
                            <>
                              {' · '}
                              {t('wizardReview.products.margin', {
                                defaultValue: 'Margin: {{margin}} per unit',
                                margin: money(margin, data.currency_code),
                              })}
                            </>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {isMissingPrice ? (
                    <Alert variant="destructive">
                      <AlertDescription>
                        {t('wizardProducts.validation.productMissingPrice', {
                          defaultValue: 'This product has no default price and no override. It cannot be billed until you enter a unit price.',
                        })}
                      </AlertDescription>
                    </Alert>
                  ) : null}
                </div>

                <Button
                  id={`remove-product-${index}`}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemoveProduct(index)}
                  className="mt-8 text-[rgb(var(--color-destructive))] hover:text-[rgb(var(--color-destructive))] hover:bg-[rgb(var(--color-destructive)/0.1)]"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            );
          })}

          <Button
            id="add-product"
            type="button"
            variant="outline"
            onClick={handleAddProduct}
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            {t('wizardProducts.actions.addProduct', { defaultValue: 'Add Product' })}
          </Button>

          {data.product_services.length > 0 ? (
            <div className="space-y-2">
              <Label htmlFor="products-billing-timing" className="text-sm">
                {t('wizardProducts.billingTimingLabel', { defaultValue: 'Billing Timing' })}
              </Label>
              <BillingTimingField
                id="products-billing-timing"
                lineType="Product"
                value={data.product_billing_timing}
                allowInherit
                inheritedValue={data.billing_timing ?? 'arrears'}
                onChange={(value) => updateData({ product_billing_timing: value })}
                onInherit={() => updateData({ product_billing_timing: undefined })}
                hideHelp
              />
            </div>
          ) : null}
        </div>
      </div>
    </ReflectionContainer>
  );
}
