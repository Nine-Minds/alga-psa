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

interface ProductsStepProps {
  data: ContractWizardData;
  updateData: (data: Partial<ContractWizardData>) => void;
}

export function ProductsStep({ data, updateData }: ProductsStepProps) {
  const [rateInputs, setRateInputs] = useState<Record<number, string>>({});
  // Track default rates from catalog for display
  const [catalogRates, setCatalogRates] = useState<Record<number, number>>({});

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

    // Store the catalog rate for display
    setCatalogRates((prev) => ({
      ...prev,
      [index]: item.default_rate,
    }));

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
          <h3 className="text-lg font-semibold mb-2">Products</h3>
          <p className="text-sm text-gray-600">
            Attach products that will be billed each cycle. Products use the catalog price for the
            contract currency unless you enter an override.
          </p>
        </div>

        {data.product_services.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No products attached yet. Add a product if you want it to bill every cycle.
          </div>
        ) : null}

        <div className="space-y-4">
          <Label className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            Products
          </Label>

          {data.product_services.map((line, index) => {
            const catalogRate = catalogRates[index] ?? null;
            const isMissingPrice = Boolean(line.service_id && catalogRate === null && line.custom_rate == null);

            return (
              <div
                key={index}
                className="flex items-start gap-3 p-4 border border-gray-200 rounded-md bg-gray-50"
              >
                <div className="flex-1 space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor={`product-${index}`} className="text-sm">
                      Product {index + 1}
                    </Label>
                    <ServiceCatalogPicker
                      id={`product-select-${index}`}
                      value={line.service_id}
                      selectedLabel={line.service_name}
                      onSelect={(item) => handleProductChange(index, item)}
                      itemKinds={['product']}
                      placeholder="Select a product"
                    />
                  </div>

                  <div className="flex items-end gap-4 flex-wrap">
                    <div className="space-y-2">
                      <Label htmlFor={`product-quantity-${index}`} className="text-sm">
                        Quantity
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
                        Override unit price (optional)
                      </Label>
                      <div className="relative w-40">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
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
                      {catalogRate !== null && catalogRate > 0 ? (
                        <div className="text-xs text-muted-foreground">
                          Default catalog price: {currencySymbol}
                          {(catalogRate / 100).toFixed(2)}
                        </div>
                      ) : line.service_id ? (
                        <div className="text-xs text-amber-700">
                          No default price set. Enter a unit price.
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {isMissingPrice ? (
                    <Alert variant="destructive">
                      <AlertDescription>
                        This product has no default price and no override. It cannot be
                        billed until you enter a unit price.
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
                  className="mt-8 text-red-600 hover:text-red-700 hover:bg-red-50"
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
            Add Product
          </Button>
        </div>
      </div>
    </ReflectionContainer>
  );
}

