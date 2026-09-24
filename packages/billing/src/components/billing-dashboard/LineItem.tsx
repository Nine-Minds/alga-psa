'use client'

import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { DiscountType } from '@alga-psa/types';
import { formatCurrency } from '@alga-psa/core';
import { getCurrencySymbol } from '@alga-psa/core';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

// Extend SelectOption to include rate
export interface ServiceOption extends SelectOption {
  rate?: number; // default_rate in cents
  tax_rate_id?: string | null; // Add tax_rate_id
}

export interface EditableItem { // Add export
  service_id: string;
  quantity: number;
  description: string;
  rate: number; // unit_price in cents
  // tax_rate_id?: string | null; // Removed from item state
  // is_taxable removed; derived directly from selectedService.tax_rate_id
  item_id?: string;
  isExisting?: boolean;
  isRemoved?: boolean;
  is_discount?: boolean;
  /**
   * True for a quantity-derived operator credit (a negative-rate charge
   * persisted as a fixed discount-like row). Authored fixed discounts leave it
   * false and stay quantity-independent.
   */
  is_manual_credit?: boolean;
  discount_type?: DiscountType;
  discount_percentage?: number;
  applies_to_item_id?: string;
  /**
   * Chosen tax treatment. `null`/empty means non-taxable; a tax rate id taxes
   * the line in that rate's region. Persisted on the charge as
   * `tax_region`/`is_taxable` (there is no tax_rate_id column on
   * `invoice_charges`) and echoed in `manual_line_metadata.tax_rate_id`.
   */
  tax_rate_id?: string | null;
  /** Client location this one-time line is attributed to. */
  location_id?: string | null;
  /** Billing profile this one-time line is attributed to. */
  billing_profile_id?: string | null;
}

/**
 * Resolves a line's monetary amount the way the server persists it.
 *
 * An ordinary charge is `quantity × rate`. A percentage discount is priced by
 * the billing engine (0 here). A fixed discount has two persisted shapes: an
 * authored fixed discount is quantity-independent (`-abs(rate)`, matching
 * `calculateNetAmount`), while a quantity-derived operator credit (a
 * negative-rate charge reloaded as a fixed discount) is `quantity × rate`.
 * `is_manual_credit` is the flag that distinguishes them.
 */
export function resolveLineItemAmount(
  item: Pick<EditableItem, 'is_discount' | 'discount_type' | 'quantity' | 'rate' | 'is_manual_credit'>,
): number {
  if (!item.is_discount) {
    return item.quantity * item.rate;
  }
  if (item.discount_type === 'percentage') {
    return 0;
  }
  return item.is_manual_credit ? item.quantity * item.rate : -Math.abs(item.rate);
}

interface LineItemProps {
  item: EditableItem;
  index: number;
  isExpanded: boolean;
  serviceOptions: ServiceOption[];
  invoiceItems?: Array<{ item_id: string; description: string }>;
  onRemove: () => void;
  onChange: (updatedItem: EditableItem) => void;
  onToggleExpand: () => void;
  currencyCode?: string;
  /** When provided, one-time charges expose a location attribution select. */
  locationOptions?: SelectOption[];
  /** When provided, one-time charges expose a billing-profile attribution select. */
  billingProfileOptions?: SelectOption[];
  /**
   * Tenant tax rates for the per-line tax treatment. When omitted (or empty) the
   * line stays non-taxable and no control is rendered, preserving the legacy
   * manual-invoice generator.
   */
  taxRateOptions?: SelectOption[];
}

export const LineItem: React.FC<LineItemProps> = ({
  item,
  index,
  isExpanded,
  serviceOptions,
  invoiceItems,
  onRemove,
  onChange,
  onToggleExpand,
  currencyCode = 'USD',
  locationOptions,
  billingProfileOptions,
  taxRateOptions,
}) => {
  const { t } = useTranslation('msp/billing');
  const currencySymbol = getCurrencySymbol(currencyCode);
  // Internal state for editing
  const [editState, setEditState] = useState<EditableItem>(() => ({
    ...item,
    // For discounts, ensure we have valid initial state
    discount_type: item.is_discount ? (item.discount_type || 'fixed') : undefined,
    discount_percentage: item.discount_percentage
    // is_taxable removed; derived from selectedService.tax_rate_id
  }));
  
  // Track raw discount amount input for display purposes
  const [discountAmountInput, setDiscountAmountInput] = useState<string>(
    item.is_discount && item.discount_type === 'fixed'
      ? (Math.abs(item.rate) / 100).toFixed(2)
      : "0.00"
  );
  const [isSearchHighlighted, setIsSearchHighlighted] = useState(false);
  const itemDomId = item.item_id ? `item-${item.item_id}` : `item-${index}`;

  // The parent maps the item into a fresh object on every render, so keying this
  // sync on the object reference reset local edits whenever an unrelated parent
  // state change happened mid-edit (for example the async client billing-email
  // lookup), silently discarding the user's in-progress line item. Key on the
  // item's data instead: re-sync only when the item actually changes.
  const itemSyncKey = JSON.stringify({
    item_id: item.item_id,
    service_id: item.service_id,
    quantity: item.quantity,
    description: item.description,
    rate: item.rate,
    is_discount: item.is_discount,
    is_manual_credit: item.is_manual_credit,
    discount_type: item.discount_type,
    discount_percentage: item.discount_percentage,
    applies_to_item_id: item.applies_to_item_id,
    tax_rate_id: item.tax_rate_id,
    location_id: item.location_id,
    billing_profile_id: item.billing_profile_id,
    isRemoved: item.isRemoved,
  });
  const lastSyncedItemKey = useRef(itemSyncKey);

  // Reset edit state when the item's data changes
  useEffect(() => {
    if (lastSyncedItemKey.current === itemSyncKey) {
      return;
    }
    lastSyncedItemKey.current = itemSyncKey;

    setEditState({
      ...item,
      discount_type: item.is_discount ? (item.discount_type || 'fixed') : undefined,
      discount_percentage: item.discount_percentage
      // is_taxable removed; derived from selectedService.tax_rate_id
    });
    
    // Reset discount amount input
    if (item.is_discount && item.discount_type === 'fixed') {
      setDiscountAmountInput((Math.abs(item.rate) / 100).toFixed(2));
    }
  }, [itemSyncKey, item]);

  useEffect(() => {
    if (!item.item_id || typeof window === 'undefined') {
      return;
    }

    const expectedHash = `#item-${item.item_id}`;
    if (window.location.hash !== expectedHash) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(itemDomId);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setIsSearchHighlighted(true);
    });
    const timeout = window.setTimeout(() => setIsSearchHighlighted(false), 2000);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [item.item_id, itemDomId]);

  const selectedService = serviceOptions.find(s => s.value === editState.service_id) as ServiceOption | undefined;
  
  // Calculate subtotal (percentage discounts are priced server-side as 0 here)
  const subtotal = resolveLineItemAmount(editState);

  // A manual credit is a negative-rate charge persisted as a fixed
  // discount-like row. It keeps its quantity semantics, so it renders with a
  // quantity and a unit-credit amount rather than the authored-discount shape.
  const isQuantityCredit = Boolean(editState.is_discount && editState.is_manual_credit);
  const creditUnitInDollars = Math.abs(editState.rate) / 100;

  // Convert rate to dollars for display (only for non-percentage discounts)
  const rateInDollars = editState.rate / 100;
  const discountTypeOptions: SelectOption[] = [
    {
      value: 'percentage',
      label: t('lineItem.options.percentage', { defaultValue: 'Percentage' }),
    },
    {
      value: 'fixed',
      label: t('lineItem.options.fixedAmount', { defaultValue: 'Fixed Amount' }),
    },
  ];

  // Handle local state changes
  const handleLocalChange = (field: keyof EditableItem, value: string | number | boolean | undefined) => {
    setEditState(prev => {
      const newState = { ...prev } as EditableItem;
      
      switch (field) {
        case 'discount_type':
          newState.discount_type = value as DiscountType;
          // Reset values when switching discount types
          if (value === 'percentage') {
            // When switching to percentage, calculate based on the item it applies to
            if (prev.applies_to_item_id) {
              // This will be handled by the parent component which has access to all items
              newState.discount_percentage = prev.discount_percentage || 10; // Default to 10%
            } else {
              // For invoice-level discounts, use a reasonable default or convert from fixed
              const currentRate = Math.abs(prev.rate);
              newState.discount_percentage = currentRate > 0 && currentRate <= 100 ? currentRate : 10;
            }
            // Keep rate at 0 for percentage discounts - actual calculation happens on save
            newState.rate = 0;
          } else {
            // When switching to fixed, convert percentage to monetary value if possible
            if (prev.discount_percentage) {
              // For item-specific discounts, this will be handled by parent component
              // For invoice-level discounts, use a nominal value
              newState.rate = -Math.abs(prev.discount_percentage * 100); // Convert percentage to cents
              // Update display value
              setDiscountAmountInput((Math.abs(prev.discount_percentage)).toFixed(2));
            } else {
              newState.rate = -1000; // Default to $10.00
              setDiscountAmountInput("10.00");
            }
            // Clear the percentage for fixed discounts
            newState.discount_percentage = undefined;
          }
          break;
        case 'service_id': {
          newState.service_id = value as string;
          const service = serviceOptions.find(s => s.value === value) as ServiceOption;
          if (service) {
            newState.rate = service.rate ?? 0; // Use service rate, default 0
            newState.description = service.label.toString();
            // Seed the tax treatment from the service default; the operator can
            // still override it below.
            newState.tax_rate_id = service.tax_rate_id ?? null;
          } else {
            newState.tax_rate_id = null;
          }
        }
          break;
        case 'quantity':
          newState.quantity = value as number;
          break;
        case 'rate': {
          const numericValue = value as number;
          newState.rate = newState.is_discount ? -Math.abs(numericValue) : numericValue;
          break;
        }
        case 'discount_percentage':
          newState.discount_percentage = value as number;
          break;
        case 'description':
        case 'applies_to_item_id':
          newState[field] = value as string;
          break;
        case 'location_id':
        case 'billing_profile_id':
          newState[field] = (value as string) || null;
          break;
        case 'tax_rate_id':
          newState.tax_rate_id = (value as string) || null;
          break;
        case 'is_discount':
          newState.is_discount = value as boolean;
          if (value) {
            newState.discount_type = 'fixed';
            newState.rate = 0;
            // is_taxable removed; derived from selectedService.tax_rate_id
          } else {
            newState.discount_type = undefined;
            newState.discount_percentage = undefined;
            newState.rate = Math.abs(newState.rate);
            // is_taxable removed; derived from selectedService.tax_rate_id
          }
          break;
        // Removed manual is_taxable case; derived from service tax_rate_id
      }

      return newState;
    });
  };

  // Save changes when collapsing
  const handleCollapse = () => {
    onChange(editState);
    onToggleExpand();
  };

  if (!isExpanded) {
    return (
      <div
        id={itemDomId}
        onClick={onToggleExpand}
        className={`p-3 border rounded-lg mb-2 cursor-pointer hover:bg-muted flex justify-between items-center ${
          editState.isRemoved ? 'opacity-50 bg-muted' : ''
        } ${editState.is_discount ? 'border-primary/30 bg-primary/10' : ''} ${
          isSearchHighlighted ? 'search-highlight ring-2 ring-yellow-400 bg-yellow-50' : ''
        }`}
      >
        <div className="flex-1">
          {editState.is_discount ? (
            <>
              <span className="font-medium text-blue-600">
                {isQuantityCredit
                  ? t('lineItem.collapsed.credit', { defaultValue: 'Credit' })
                  : editState.applies_to_item_id
                    ? t('lineItem.collapsed.itemDiscount', { defaultValue: 'Item Discount' })
                    : t('lineItem.collapsed.invoiceDiscount', { defaultValue: 'Invoice Discount' })}
              </span>
              <span className="mx-2 text-muted-foreground">|</span>
              <span className="text-muted-foreground">
                {editState.discount_type === 'percentage'
                  ? `${editState.discount_percentage}%`
                  : `${currencySymbol}${(Math.abs(subtotal) / 100).toFixed(2)}`}
                {editState.applies_to_item_id && (
                  <>
                    <span className="mx-2 text-muted-foreground">|</span>
                    <span>
                      {t('lineItem.collapsed.appliedTo', {
                        defaultValue: 'Applied to: {{description}}',
                        description: invoiceItems?.find(i => i.item_id === editState.applies_to_item_id)?.description ?? '',
                      })}
                    </span>
                  </>
                )}
              </span>
            </>
          ) : (
            <>
              <span className="font-medium">
                {selectedService?.label || t('lineItem.collapsed.selectService', { defaultValue: 'Select Service' })}
              </span>
              {/* Reflect the effective per-line tax treatment, which can differ
                  from the selected service's default (an explicit override or a
                  freeform line with its own chosen rate). */}
              <span className="text-xs text-muted-foreground ml-1">
                {!!editState.tax_rate_id
                  ? t('lineItem.collapsed.taxable', { defaultValue: '(Taxable)' })
                  : t('lineItem.collapsed.nonTaxable', { defaultValue: '(Non-Taxable)' })}
              </span>
              <span className="mx-2 text-muted-foreground">|</span>
              <span className="text-muted-foreground">{editState.description}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-4">
          {!editState.is_discount && (
            <span className="text-muted-foreground">{editState.quantity} × {currencySymbol}{rateInDollars.toFixed(2)}</span>
          )}
          <span className="font-medium">
            {editState.discount_type === 'percentage'
              ? `${editState.discount_percentage || 0}%`
              : `${currencySymbol}${Math.abs(subtotal / 100).toFixed(2)}`}
          </span>
          {editState.discount_type === 'percentage' && (
            <span className="text-sm text-muted-foreground ml-1">
              {t('lineItem.collapsed.calculatedOnSave', { defaultValue: '(calculated on save)' })}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div id={itemDomId} className={`p-4 border rounded-lg space-y-3 mb-2 ${
      editState.isRemoved ? 'opacity-50 bg-muted' : ''
    } ${editState.is_discount ? 'border-blue-200 bg-blue-50' : ''} ${
      isSearchHighlighted ? 'search-highlight ring-2 ring-yellow-400 bg-yellow-50' : ''
    }`}>
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">
            {isQuantityCredit
              ? t('lineItem.expanded.credit', { defaultValue: 'Credit' })
              : editState.is_discount
                ? t('lineItem.expanded.discount', { defaultValue: 'Discount' })
                : t('lineItem.expanded.item', {
                    defaultValue: 'Item {{number}}',
                    number: index + 1,
                  })}
          </h3>
          {editState.isRemoved && (
            <span className="text-xs text-destructive bg-destructive/10 px-2 py-1 rounded">
              {t('lineItem.expanded.markedForRemoval', { defaultValue: 'Marked for removal' })}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            id='collapse-line-item-button'
            type="button"
            onClick={handleCollapse}
            variant="secondary"
            size="sm"
          >
            {t('lineItem.actions.add', { defaultValue: 'Add' })}
          </Button>
          <Button
            id={editState.isRemoved ? 'restore-line-item-button' : 'remove-line-item-button'}
            type="button"
            onClick={onRemove}
            variant={editState.isRemoved ? "default" : "secondary"}
            size="sm"
          >
            {editState.isRemoved
              ? t('lineItem.actions.restore', { defaultValue: 'Restore' })
              : t('lineItem.actions.remove', { defaultValue: 'Remove' })}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {!editState.is_discount ? (
          // Regular line item fields
          <>
            <div>
              <label className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
                {t('lineItem.fields.service', { defaultValue: 'Service' })}
              </label>
              <CustomSelect
                id='service-select'
                value={editState.service_id}
                onValueChange={(value) => handleLocalChange('service_id', value)}
                options={serviceOptions}
                className="w-full"
                disabled={editState.isRemoved}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
                {t('lineItem.fields.quantity', { defaultValue: 'Quantity' })}
              </label>
              <Input
                id='quantity-input'
                type="number"
                min="0.01"
                step="0.01"
                value={editState.quantity}
                onChange={(e) => handleLocalChange('quantity', parseFloat(e.target.value) || 0)}
                className="w-full"
                disabled={editState.isRemoved}
              />
            </div>
          </>
        ) : isQuantityCredit ? (
          // Quantity-derived credit: quantity x unit credit. It persists as a
          // fixed discount-like row, but stays quantity-editable.
          <>
            <div>
              <label className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
                {t('lineItem.fields.quantity', { defaultValue: 'Quantity' })}
              </label>
              <Input
                id='quantity-input'
                type="number"
                min="0.01"
                step="0.01"
                value={editState.quantity}
                onChange={(e) => handleLocalChange('quantity', parseFloat(e.target.value) || 0)}
                className="w-full"
                disabled={editState.isRemoved}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
                {t('lineItem.fields.creditUnit', {
                  defaultValue: 'Unit credit ({{currencySymbol}})',
                  currencySymbol,
                })}
              </label>
              <Input
                id='credit-unit-input'
                type="number"
                min="0"
                step="0.01"
                value={creditUnitInDollars}
                onChange={(e) => {
                  const raw = e.target.value;
                  const cents = raw.includes('.')
                    ? Math.round(parseFloat(raw) * 100)
                    : parseInt(raw, 10) * 100;
                  handleLocalChange('rate', cents || 0);
                }}
                className="w-full"
                disabled={editState.isRemoved}
              />
            </div>
          </>
        ) : (
          // Discount fields
          <>
            <div>
              <label className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
                {t('lineItem.fields.discountType', { defaultValue: 'Discount Type' })}
              </label>
              <CustomSelect
                id='discount-type-select'
                value={editState.discount_type || 'fixed'}
                onValueChange={(value) => handleLocalChange('discount_type', value)}
                options={discountTypeOptions}
                className="w-full"
                disabled={editState.isRemoved}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
                {editState.discount_type === 'percentage'
                  ? t('lineItem.fields.percentage', { defaultValue: 'Percentage' })
                  : t('lineItem.fields.amount', {
                      defaultValue: 'Amount ({{currencySymbol}})',
                      currencySymbol,
                    })}
              </label>
              <Input
                id='discount-value-input'
                type={editState.discount_type === 'percentage' ? 'number' : 'text'} // Change to text for fixed amount
                inputMode={editState.discount_type === 'percentage' ? undefined : 'decimal'} // Hint for mobile keyboards
                min={editState.discount_type === 'percentage' ? "0" : undefined} // Keep min for percentage
                step={editState.discount_type === 'percentage' ? '1' : undefined} // Remove step for text input
                max={editState.discount_type === 'percentage' ? '100' : undefined} // Keep max for percentage
                value={editState.discount_type === 'percentage'
                  ? editState.discount_percentage || 0
                  : discountAmountInput} // Use raw input value for display
                onChange={(e) => {
                  const rawValue = e.target.value;
                  if (editState.discount_type === 'percentage') {
                    // Keep existing percentage logic
                    const percentage = parseFloat(rawValue) || 0;
                    handleLocalChange('discount_percentage', Math.min(Math.max(percentage, 0), 100));
                    handleLocalChange('rate', 0); // Rate is 0 for percentage
                  } else {
                    // Handle fixed amount as text input
                    // Allow only numbers and a single decimal point
                    const sanitizedValue = rawValue.replace(/[^0-9.]/g, '');
                    
                    // Handle multiple decimal points by keeping only the first one
                    const parts = sanitizedValue.split('.');
                    let validValue = sanitizedValue;
                    if (parts.length > 2) {
                      validValue = parts[0] + '.' + parts.slice(1).join('');
                    }
                    
                    // Store the sanitized value for display
                    setDiscountAmountInput(validValue);
                    
                    // Update the rate value (stored as negative cents)
                    if (validValue === '' || validValue === '.') {
                      handleLocalChange('rate', 0);
                    } else {
                      const dollarValue = parseFloat(validValue);
                      if (!isNaN(dollarValue)) {
                        const rateInCents = Math.round(dollarValue * 100);
                        handleLocalChange('rate', -Math.abs(rateInCents));
                      }
                    }
                    
                    // Clear discount_percentage when using fixed amount
                    handleLocalChange('discount_percentage', undefined);
                  }
                }}
                className="w-full"
                disabled={editState.isRemoved}
              />
            </div>
          </>
        )}
        
        {editState.is_discount ? (
          <>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
                {isQuantityCredit
                  ? t('lineItem.fields.description', { defaultValue: 'Description' })
                  : t('lineItem.fields.discountDescription', { defaultValue: 'Discount Description' })}
              </label>
              <Input
                id='discount-description-input'
                type="text"
                value={editState.description}
                onChange={(e) => handleLocalChange('description', e.target.value)}
                className="w-full"
                disabled={editState.isRemoved}
                placeholder={isQuantityCredit
                  ? t('lineItem.placeholders.creditDescription', { defaultValue: 'e.g., Goodwill credit' })
                  : t('lineItem.placeholders.discountDescription', {
                      defaultValue: 'e.g., Early Payment Discount',
                    })}
              />
            </div>

            {!isQuantityCredit && invoiceItems && invoiceItems.length > 0 && (
              <div className="col-span-2">
                <label className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
                  {t('lineItem.fields.applyDiscountTo', { defaultValue: 'Apply Discount To' })}
                </label>
                <CustomSelect
                  id='applies-to-item-select'
                  value={editState.applies_to_item_id || 'INVOICE'}
                  onValueChange={(value) => {
                    const applies_to_item_id = value === 'INVOICE' ? undefined : value;
                    handleLocalChange('applies_to_item_id', applies_to_item_id || '');
                  }}
                  options={[
                    {
                      value: 'INVOICE',
                      label: t('lineItem.fields.entireInvoice', { defaultValue: 'Entire Invoice' }),
                    },
                    ...invoiceItems.map(item => ({
                      value: item.item_id,
                      label: item.description
                    }))
                  ]}
                  className="w-full"
                  disabled={editState.isRemoved}
                />
              </div>
            )}
          </>
        ) : (
          <>
            <div className="col-span-1">
              <label className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
                {t('lineItem.fields.rate', {
                  defaultValue: 'Rate ({{currencySymbol}})',
                  currencySymbol,
                })}
              </label>
              <Input
                id='rate-input'
                type="number"
                min="0"
                step="0.01"
                value={rateInDollars}
                onChange={(e) => {
                  const value = e.target.value;
                  const rateInCents = value.includes('.')
                    ? Math.round(parseFloat(value) * 100)
                    : parseInt(value, 10) * 100;
                  handleLocalChange('rate', rateInCents || 0);
                }}
                 className="w-full"
                 disabled={editState.isRemoved}
               />
             </div>

             {taxRateOptions && taxRateOptions.length > 0 && (
               <div className="col-span-1">
                 <label className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
                   {t('lineItem.fields.taxTreatment', { defaultValue: 'Tax treatment' })}
                 </label>
                 <CustomSelect
                   id='line-item-tax-treatment-select'
                   value={editState.tax_rate_id || ''}
                   onValueChange={(value) => handleLocalChange('tax_rate_id', value)}
                   options={[
                     {
                       value: '',
                       label: t('lineItem.fields.nonTaxable', { defaultValue: 'Non-taxable' }),
                     },
                     ...taxRateOptions,
                   ]}
                   className="w-full"
                   disabled={editState.isRemoved}
                 />
               </div>
             )}

             {locationOptions && locationOptions.length > 0 && (
              <div className="col-span-1">
                <label className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
                  {t('lineItem.fields.location', { defaultValue: 'Location' })}
                </label>
                <CustomSelect
                  id='line-item-location-select'
                  value={editState.location_id || ''}
                  onValueChange={(value) => handleLocalChange('location_id', value)}
                  options={[
                    {
                      value: '',
                      label: t('lineItem.fields.clientDefaultLocation', { defaultValue: 'Client default' }),
                    },
                    ...locationOptions,
                  ]}
                  className="w-full"
                  disabled={editState.isRemoved}
                />
              </div>
            )}

            {billingProfileOptions && billingProfileOptions.length > 0 && (
              <div className="col-span-2">
                <label className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
                  {t('lineItem.fields.billingProfile', { defaultValue: 'Billing profile' })}
                </label>
                <CustomSelect
                  id='line-item-billing-profile-select'
                  value={editState.billing_profile_id || ''}
                  onValueChange={(value) => handleLocalChange('billing_profile_id', value)}
                  options={[
                    {
                      value: '',
                      label: t('lineItem.fields.clientDefaultProfile', { defaultValue: 'Client default' }),
                    },
                    ...billingProfileOptions,
                  ]}
                  className="w-full"
                  disabled={editState.isRemoved}
                />
              </div>
            )}
          </>
        )}
      </div>

      {!editState.is_discount && (
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-1">
            {t('lineItem.fields.description', { defaultValue: 'Description' })}
          </label>
          <Input
            id='description-input'
            type="text"
            value={editState.description}
            onChange={(e) => handleLocalChange('description', e.target.value)}
            className="w-full"
            disabled={editState.isRemoved}
          />
          {editState.isRemoved && (
            <p className="mt-1 text-xs text-muted-foreground">
              This item will be removed when you save changes
            </p>
          )}
        </div>
      )}

      <div className="text-right text-sm text-muted-foreground">
        {editState.is_discount ? (
          <>
            <span className="text-blue-600 font-medium">
              {isQuantityCredit
                ? t('lineItem.summary.credit', { defaultValue: 'Credit' })
                : editState.discount_type === 'percentage'
                  ? t('lineItem.summary.percentageDiscount', { defaultValue: 'Percentage Discount' })
                  : t('lineItem.summary.fixedDiscount', { defaultValue: 'Fixed Discount' })}
            </span>
            <span className="mx-2">|</span>
            <span>
              {editState.discount_type === 'percentage'
                ? editState.applies_to_item_id
                  ? t('lineItem.summary.itemTotal', {
                      defaultValue: '{{percentage}}% of item total',
                      percentage: editState.discount_percentage || 0,
                    })
                  : t('lineItem.summary.invoiceTotal', {
                      defaultValue: '{{percentage}}% of invoice total',
                      percentage: editState.discount_percentage || 0,
                    })
                : t('lineItem.summary.amount', {
                    defaultValue: 'Amount: -{{currencySymbol}}{{amount}}',
                    currencySymbol,
                    amount: (Math.abs(subtotal) / 100).toFixed(2),
                  })}
              {editState.applies_to_item_id && (
                <>
                  <span className="mx-2">|</span>
                  <span className="text-muted-foreground">
                    {t('lineItem.summary.appliedTo', {
                      defaultValue: 'Applied to: {{description}}',
                      description: invoiceItems?.find(i => i.item_id === editState.applies_to_item_id)?.description ?? '',
                    })}
                  </span>
                </>
              )}
            </span>
          </>
        ) : (
          <>
            {t('lineItem.summary.subtotal', {
              defaultValue: 'Subtotal: {{currencySymbol}}{{amount}}',
              currencySymbol,
              amount: (subtotal / 100).toFixed(2),
            })}
          </>
        )}
      </div>
    </div>
  );
};
