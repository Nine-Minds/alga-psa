'use client';

import React, { useState, useEffect } from 'react';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { getCurrencySymbol } from '@alga-psa/core';
import { ServiceCatalogPicker, ServiceCatalogPickerItem } from '../ServiceCatalogPicker';
import type { ContractWizardData } from '../ContractWizard';
import { Plus, X, Package } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface ProductsStepProps {
  data: ContractWizardData;
  updateData: (data: Partial<ContractWizardData>) => void;
}

export function ProductsStep({ data, updateData }: ProductsStepProps) {
  const { t } = useTranslation('msp/contracts');
  const [rateInputs, setRateInputs] = useState<Record<number, string>>({});
  // Catalog price in the contract currency (from service_prices). null when no row exists for this currency.
  const [currencyRates, setCurrencyRates] = useState<Record<number, number | null>>({});
  // Legacy default_rate (untagged). Shown as a fallback hint only when no currency-specific price exists.
  const [legacyDefaultRates, setLegacyDefaultRates] = useState<Record<number, number>>({});

  useEffect(() => {
    const next: Record<number, string> = {};
    data.product_services.forEach((line, index) => {
      if (line.custom_rate !== undefined) {
        next[index] = (line.custom_rate / 100).toFixed(2);
      }
    });
    setRateInputs(next);
  }, [data.product_services]);

  const currencySymbol = getCurrencySymbol(data.currency_code);

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
    const next = [...data.product_services];
    next[index] = {
      ...next[index],
      service_id: item.service_id,
      service_name: item.service_name,
      custom_rate: undefined,
    };
    updateData({ product_services: next });

    const currencyRate = item.currency_rate ?? null;
    setCurrencyRates((prev) => ({ ...prev, [index]: currencyRate }));
    setLegacyDefaultRates((prev) => ({ ...prev, [index]: item.default_rate }));

    setRateInputs((prev) => {
      const { [index]: _, ...rest } = prev;
      return rest;
    });
  };

  const handleQuantityChange = (index: number, quantity: number) => {
    const next = [...data.product_services];
    next[index] = { ...next[index], quantity: Math.max(1, quantity || 1) };
    updateData({ product_services: next });
  };

  const handleRateInputChange = (index: number, value: string) => {
    const sanitized = value.replace(/[^0-9.]/g, '');
    const decimalCount = (sanitized.match(/\./g) || []).length;
    if (decimalCount <= 1) {
      setRateInputs((prev) => ({ ...prev, [index]: sanitized }));
    }
  };

  const commitRate = (index: number) => {
    const input = (rateInputs[index] ?? '').trim();
    const next = [...data.product_services];

    if (!input || input === '.') {
      next[index] = { ...next[index], custom_rate: undefined };
      updateData({ product_services: next });
      setRateInputs((prev) => {
        const { [index]: _, ...rest } = prev;
        return rest;
      });
      return;
    }

    const dollars = parseFloat(input);
    const cents = Number.isFinite(dollars) ? Math.round(dollars * 100) : 0;
    next[index] = { ...next[index], custom_rate: cents };
    updateData({ product_services: next });
    setRateInputs((prev) => ({ ...prev, [index]: (cents / 100).toFixed(2) }));
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
            const currencyRate = currencyRates[index] ?? null;
            const legacyDefaultRate = legacyDefaultRates[index] ?? null;
            const isMissingPrice = Boolean(
              line.service_id && currencyRate === null && line.custom_rate == null,
            );

            return (
              <div
                key={index}
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
                      <div className="relative w-40">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[rgb(var(--color-text-400))]">
                          {currencySymbol}
                        </span>
                        <Input
                          id={`product-rate-${index}`}
                          type="text"
                          inputMode="decimal"
                          value={rateInputs[index] ?? ''}
                          onChange={(event) => handleRateInputChange(index, event.target.value)}
                          onBlur={() => commitRate(index)}
                          placeholder=""
                          className="pl-10"
                        />
                      </div>
                      {currencyRate !== null && currencyRate > 0 ? (
                        <div className="text-xs text-muted-foreground">
                          {t('wizardProducts.labels.catalogPriceInCurrency', {
                            defaultValue: 'Catalog price in {{currency}}:',
                            currency: data.currency_code,
                          })}{' '}
                          {currencySymbol}
                          {(currencyRate / 100).toFixed(2)}
                        </div>
                      ) : line.service_id ? (
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
        </div>
      </div>
    </ReflectionContainer>
  );
}
