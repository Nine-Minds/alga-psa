'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { EditableServiceTypeSelect } from '@alga-psa/ui/components/EditableServiceTypeSelect';
import {
  createService,
  updateService,
  getServiceTypesForSelection,
  setServicePrices,
  createServiceTypeInline,
  updateServiceTypeInline,
  deleteServiceTypeInline
} from '@alga-psa/billing/actions';
import { getTaxRates } from '@alga-psa/billing/actions';
import { ITaxRate } from '@alga-psa/types';
import { IService, IServiceCategory } from '@alga-psa/types';
import { CURRENCY_OPTIONS, getCurrencySymbol } from '@alga-psa/core';
import { getServiceCategories } from '@alga-psa/billing/actions';

const LICENSE_TERM_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'annual', label: 'Annual' },
  { value: 'perpetual', label: 'Perpetual' }
];

const BILLING_METHOD_OPTIONS = [
  { value: 'per_unit', label: 'Per Unit' },
];

type PriceDraft = { currency_code: string; rate: number };

interface QuickAddProductProps {
  isOpen: boolean;
  onClose: () => void;
  onProductAdded: () => void;
  /** If provided, the dialog will be in edit mode */
  product?: IService | null;
}

export function QuickAddProduct({ isOpen, onClose, onProductAdded, product }: QuickAddProductProps) {
  const isEditMode = !!product;
  const [error, setError] = useState<string | null>(null);

  const [taxRates, setTaxRates] = useState<ITaxRate[]>([]);
  const [isLoadingTaxRates, setIsLoadingTaxRates] = useState(true);

  const [categories, setCategories] = useState<IServiceCategory[]>([]);
  const [isLoadingCategories, setIsLoadingCategories] = useState(true);

  const [allServiceTypes, setAllServiceTypes] = useState<
    { id: string; name: string; billing_method: 'fixed' | 'hourly' | 'per_unit' | 'usage'; is_standard: boolean }[]
  >([]);

  const getInitialProductState = (): Partial<IService> => ({
    item_kind: 'product',
    is_active: true,
    billing_method: 'per_unit',
    unit_of_measure: '',
    cost_currency: 'USD',
    is_license: false,
    license_term: 'monthly',
    license_billing_cadence: 'monthly'
  });

  const [formProduct, setFormProduct] = useState<Partial<IService>>(getInitialProductState());
  const [formPrices, setFormPrices] = useState<PriceDraft[]>([{ currency_code: 'USD', rate: 0 }]);
  const [priceInput, setPriceInput] = useState<string>('');

  // Initialize form when product changes (edit mode) or dialog opens
  useEffect(() => {
    if (isOpen && product) {
      setFormProduct({ ...product });
      const prices = product.prices && product.prices.length > 0
        ? product.prices.map((p) => ({ currency_code: p.currency_code, rate: p.rate }))
        : [{ currency_code: 'USD', rate: product.default_rate ?? 0 }];
      setFormPrices(prices);
      const primaryRate = prices.length > 0 ? prices[0].rate : product.default_rate ?? 0;
      setPriceInput((primaryRate / 100).toFixed(2));
    } else if (isOpen && !product) {
      setFormProduct(getInitialProductState());
      setFormPrices([{ currency_code: 'USD', rate: 0 }]);
      setPriceInput('');
    }
  }, [isOpen, product]);

  const productServiceTypes = useMemo(() => {
    const perUnitTypes = allServiceTypes.filter((t) => t.billing_method === 'per_unit');
    const selectedTypeId = formProduct.custom_service_type_id || null;

    if (selectedTypeId && !perUnitTypes.some((t) => t.id === selectedTypeId)) {
      const selected = allServiceTypes.find((t) => t.id === selectedTypeId);
      if (selected) return [...perUnitTypes, selected];
    }

    return perUnitTypes;
  }, [allServiceTypes, formProduct.custom_service_type_id]);

  const fetchServiceTypes = async () => {
    const types = await getServiceTypesForSelection();
    setAllServiceTypes(types);
  };

  const fetchTaxRates = async () => {
    setIsLoadingTaxRates(true);
    try {
      const rates = await getTaxRates();
      setTaxRates(rates);
    } finally {
      setIsLoadingTaxRates(false);
    }
  };

  const fetchCategories = async () => {
    setIsLoadingCategories(true);
    try {
      const cats = await getServiceCategories();
      setCategories(Array.isArray(cats) ? cats : []);
    } finally {
      setIsLoadingCategories(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchServiceTypes().catch((e) => console.error('[QuickAddProduct] Failed to fetch service types:', e));
      fetchTaxRates().catch((e) => console.error('[QuickAddProduct] Failed to fetch tax rates:', e));
      fetchCategories().catch((e) => console.error('[QuickAddProduct] Failed to fetch categories:', e));
    }
  }, [isOpen]);

  const formatTaxRateLabel = (rate: ITaxRate) => {
    const descriptionPart = rate.description || rate.region_code || 'N/A';
    const percentageValue = typeof rate.tax_percentage === 'string' ? parseFloat(rate.tax_percentage) : Number(rate.tax_percentage);
    const percentagePart = !Number.isNaN(percentageValue) ? percentageValue.toFixed(2) : '0.00';
    return `${descriptionPart} - ${percentagePart}%`;
  };

  const validatePrices = (prices: PriceDraft[]): string | null => {
    if (prices.length === 0) return 'At least one price is required';

    const seen = new Set<string>();
    for (const price of prices) {
      const currency = (price.currency_code || '').trim().toUpperCase();
      if (!currency) return 'Currency is required for each price';
      if (seen.has(currency)) return 'Each currency can only be used once';
      seen.add(currency);

      if (!Number.isFinite(price.rate) || price.rate < 0) {
        return 'Prices must be non-negative';
      }
    }

    if (!prices.some((p) => p.rate > 0)) {
      return 'At least one non-zero price is required';
    }

    return null;
  };

  const resetForm = () => {
    setFormProduct(getInitialProductState());
    setFormPrices([{ currency_code: 'USD', rate: 0 }]);
    setPriceInput('');
    setError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async () => {
    if (!formProduct.service_name?.trim()) {
      setError('Product name is required');
      return;
    }
    if (!formProduct.custom_service_type_id) {
      setError('Service type is required');
      return;
    }
    if (!formProduct.unit_of_measure?.trim()) {
      setError('Unit of measure is required');
      return;
    }
    const priceError = validatePrices(formPrices);
    if (priceError) {
      setError(priceError);
      return;
    }

    try {
      const primary = formPrices[0];

      if (isEditMode && product) {
        // Update existing product
        await updateService(product.service_id, {
          ...formProduct,
          item_kind: 'product'
        } as any);
        await setServicePrices(product.service_id, formPrices);
      } else {
        // Create new product
        const created = await createService({
          service_name: formProduct.service_name!.trim(),
          custom_service_type_id: formProduct.custom_service_type_id!,
          billing_method: (formProduct.billing_method || 'per_unit') as any,
          default_rate: primary.rate,
          unit_of_measure: formProduct.unit_of_measure!.trim(),
          description: formProduct.description ?? null,
          category_id: formProduct.category_id ?? null,
          tax_rate_id: formProduct.tax_rate_id ?? null,
          item_kind: 'product',
          is_active: formProduct.is_active ?? true,
          sku: formProduct.sku ?? null,
          cost: formProduct.cost ?? null,
          cost_currency: formProduct.cost_currency ?? 'USD',
          vendor: formProduct.vendor ?? null,
          manufacturer: formProduct.manufacturer ?? null,
          product_category: formProduct.product_category ?? null,
          is_license: formProduct.is_license ?? false,
          license_term: formProduct.license_term ?? null,
          license_billing_cadence: formProduct.license_billing_cadence ?? null
        } as any);

        await setServicePrices(created.service_id, formPrices);
      }

      resetForm();
      onProductAdded();
    } catch (e) {
      console.error(`[QuickAddProduct] Failed to ${isEditMode ? 'update' : 'create'} product:`, e);
      setError(`Failed to ${isEditMode ? 'update' : 'create'} product`);
    }
  };

  const renderPricesEditor = (
    prices: PriceDraft[],
    setPrices: (p: PriceDraft[]) => void,
    primaryInput: string,
    setPrimaryInput: (v: string) => void
  ) => {
    return (
      <div className="border rounded-lg p-4 bg-gray-50">
        <div className="flex justify-between items-center mb-3">
          <label className="block text-sm font-medium text-gray-700">
            Pricing *
            <span className="text-xs font-normal text-gray-500 ml-2">(Rate)</span>
          </label>
          <Button
            id="quick-add-product-price-add-currency"
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const usedCurrencies = prices.map(p => p.currency_code);
              const availableCurrency = CURRENCY_OPTIONS.find(c => !usedCurrencies.includes(c.value));
              if (availableCurrency) {
                setPrices([...prices, { currency_code: availableCurrency.value, rate: 0 }]);
              }
            }}
            disabled={prices.length >= CURRENCY_OPTIONS.length}
          >
            + Add Currency
          </Button>
        </div>
        <div className="space-y-3">
          {prices.map((price, index) => (
            <div key={`${price.currency_code}-${index}`} className="flex items-center gap-3">
              <div className="w-28">
                <CustomSelect
                  id={`quick-add-product-price-currency-${index}`}
                  options={CURRENCY_OPTIONS.filter((opt) => {
                    if (opt.value === price.currency_code) return true;
                    return !prices.some((p) => p.currency_code === opt.value);
                  }).map(c => ({ value: c.value, label: c.label }))}
                  value={price.currency_code}
                  onValueChange={(value) => {
                    const next = [...prices];
                    next[index] = { ...next[index], currency_code: value };
                    setPrices(next);
                  }}
                  placeholder="Currency"
                />
              </div>
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                  {getCurrencySymbol(price.currency_code)}
                </span>
                <Input
                  id={`quick-add-product-price-rate-${index}`}
                  type="text"
                  inputMode="decimal"
                  value={index === 0 ? primaryInput : (price.rate > 0 ? (price.rate / 100).toFixed(2) : '')}
                  onChange={(e) => {
                    const value = e.target.value.replace(/[^0-9.]/g, '');
                    const decimalCount = (value.match(/\./g) || []).length;
                    if (decimalCount > 1) return;

                    if (index === 0) {
                      setPrimaryInput(value);
                      return;
                    }

                    const dollars = parseFloat(value) || 0;
                    const cents = Math.round(dollars * 100);
                    const next = [...prices];
                    next[index] = { ...next[index], rate: cents };
                    setPrices(next);
                  }}
                  onBlur={() => {
                    if (index !== 0) return;
                    // Only format if user actually entered a value
                    if (primaryInput.trim() === '') {
                      return;
                    }
                    const dollars = parseFloat(primaryInput) || 0;
                    const cents = Math.round(dollars * 100);
                    const next = [...prices];
                    next[0] = { ...next[0], rate: cents };
                    setPrices(next);
                    setPrimaryInput((cents / 100).toFixed(2));
                  }}
                  placeholder="0.00"
                  className="pl-10"
                />
              </div>
              {prices.length > 1 && (
                <Button
                  id={`quick-add-product-price-remove-${index}`}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-red-500 hover:text-red-700 hover:bg-red-50 px-2"
                  onClick={() => {
                    const next = prices.filter((_, i) => i !== index);
                    setPrices(next);
                    if (index === 0 && next.length > 0) {
                      setPrimaryInput((next[0].rate / 100).toFixed(2));
                    }
                  }}
                >
                  Remove
                </Button>
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Add prices in multiple currencies. The first currency is the primary rate.
        </p>
      </div>
    );
  };

  return (
    <Dialog isOpen={isOpen} onClose={handleClose} title={isEditMode ? 'Edit Product' : 'Add Product'}>
      <DialogContent>
        {error && <div className="text-red-500 mb-4">{error}</div>}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Product Name *</label>
            <Input
              id="quick-add-product-name"
              value={formProduct.service_name || ''}
              onChange={(e) => setFormProduct({ ...formProduct, service_name: e.target.value })}
            />
          </div>

          <div>
            <EditableServiceTypeSelect
              label="Type *"
              value={formProduct.custom_service_type_id || ''}
              onChange={(value) => setFormProduct({ ...formProduct, custom_service_type_id: value })}
              serviceTypes={productServiceTypes}
              onCreateType={async (name) => {
                await createServiceTypeInline(name, 'per_unit');
                await fetchServiceTypes();
              }}
              onUpdateType={async (id, name) => {
                await updateServiceTypeInline(id, name);
                await fetchServiceTypes();
              }}
              onDeleteType={async (id) => {
                await deleteServiceTypeInline(id);
                await fetchServiceTypes();
              }}
              placeholder="Select type..."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">SKU</label>
              <Input
                id="quick-add-product-sku"
                value={formProduct.sku || ''}
                onChange={(e) => setFormProduct({ ...formProduct, sku: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <CustomSelect
                value={formProduct.category_id || ''}
                placeholder={isLoadingCategories ? 'Loading…' : 'Uncategorized'}
                onValueChange={(v) => setFormProduct({ ...formProduct, category_id: v || null })}
                options={categories
                  .filter((c) => Boolean(c.category_id))
                  .map((c) => ({ value: c.category_id as string, label: c.category_name }))}
                disabled={isLoadingCategories}
                allowClear={true}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Label</label>
            <Input
              id="quick-add-product-label"
              value={formProduct.product_category || ''}
              onChange={(e) => setFormProduct({ ...formProduct, product_category: e.target.value })}
              placeholder="Optional freeform label"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vendor</label>
              <Input
                id="quick-add-product-vendor"
                value={formProduct.vendor || ''}
                onChange={(e) => setFormProduct({ ...formProduct, vendor: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Manufacturer</label>
              <Input
                id="quick-add-product-manufacturer"
                value={formProduct.manufacturer || ''}
                onChange={(e) => setFormProduct({ ...formProduct, manufacturer: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cost</label>
              <div className="flex gap-2">
                <div className="w-24">
                  <CustomSelect
                    id="quick-add-product-cost-currency"
                    options={CURRENCY_OPTIONS.map(c => ({ value: c.value, label: c.label }))}
                    value={formProduct.cost_currency || 'USD'}
                    onValueChange={(v) => setFormProduct({ ...formProduct, cost_currency: v })}
                  />
                </div>
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                    {getCurrencySymbol(formProduct.cost_currency || 'USD')}
                  </span>
                  <Input
                    id="quick-add-product-cost"
                    type="text"
                    inputMode="decimal"
                    value={formProduct.cost != null ? (formProduct.cost / 100).toFixed(2) : ''}
                    onChange={(e) => {
                      const value = e.target.value.replace(/[^0-9.]/g, '');
                      const decimalCount = (value.match(/\./g) || []).length;
                      if (decimalCount > 1) return;
                      const dollars = parseFloat(value) || 0;
                      const cents = Math.round(dollars * 100);
                      setFormProduct({ ...formProduct, cost: value === '' ? null : cents });
                    }}
                    placeholder="0.00"
                    className="pl-8"
                  />
                </div>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Billing Method</label>
              <CustomSelect
                options={BILLING_METHOD_OPTIONS}
                value={(formProduct.billing_method as string) || 'per_unit'}
                onValueChange={(v) => setFormProduct({ ...formProduct, billing_method: v as any })}
              />
            </div>
          </div>

          {renderPricesEditor(formPrices, setFormPrices, priceInput, setPriceInput)}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tax Rate</label>
            <CustomSelect
              value={formProduct.tax_rate_id || ''}
              placeholder={isLoadingTaxRates ? 'Loading...' : 'Non-Taxable'}
              onValueChange={(v) => setFormProduct({ ...formProduct, tax_rate_id: v || null })}
              options={taxRates.map((r) => ({ value: r.tax_rate_id, label: formatTaxRateLabel(r) }))}
              disabled={isLoadingTaxRates}
              allowClear={true}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Active</label>
              <CustomSelect
                options={[
                  { value: 'true', label: 'Active' },
                  { value: 'false', label: 'Inactive' }
                ]}
                value={(formProduct.is_active ?? true) ? 'true' : 'false'}
                onValueChange={(v) => setFormProduct({ ...formProduct, is_active: v === 'true' })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Unit of Measure *</label>
              <Input
                id="quick-add-product-unit-of-measure"
                value={formProduct.unit_of_measure || ''}
                onChange={(e) => setFormProduct({ ...formProduct, unit_of_measure: e.target.value })}
                placeholder="e.g., each, item, license"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">License?</label>
              <CustomSelect
                options={[
                  { value: 'false', label: 'No' },
                  { value: 'true', label: 'Yes' }
                ]}
                value={(formProduct.is_license ?? false) ? 'true' : 'false'}
                onValueChange={(v) => setFormProduct({ ...formProduct, is_license: v === 'true' })}
              />
            </div>
            <div>
              <CustomSelect
                label="License Term"
                options={LICENSE_TERM_OPTIONS}
                value={(formProduct.license_term as string) || 'monthly'}
                onValueChange={(v) => setFormProduct({ ...formProduct, license_term: v })}
                disabled={!(formProduct.is_license ?? false)}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <Input
              id="quick-add-product-description"
              value={formProduct.description || ''}
              onChange={(e) => setFormProduct({ ...formProduct, description: e.target.value })}
            />
          </div>
        </div>
      </DialogContent>
      <DialogFooter>
        <Button id="quick-add-product-cancel-button" variant="outline" onClick={handleClose}>Cancel</Button>
        <Button id="quick-add-product-submit-button" onClick={handleSubmit}>{isEditMode ? 'Save' : 'Create'}</Button>
      </DialogFooter>
    </Dialog>
  );
}
