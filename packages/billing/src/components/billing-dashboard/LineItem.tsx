'use client'

import React, { useState, useEffect } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { DiscountType } from '@alga-psa/types';
import { formatCurrency } from '@alga-psa/core';
import { getCurrencySymbol } from '@alga-psa/core';

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
  discount_type?: DiscountType;
  discount_percentage?: number;
  applies_to_item_id?: string;
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
}

const discountTypeOptions: SelectOption[] = [
  { value: 'percentage', label: 'Percentage' },
  { value: 'fixed', label: 'Fixed Amount' }
];

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
}) => {
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

  // Reset edit state when item changes
  useEffect(() => {
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
  }, [item]);

  const selectedService = serviceOptions.find(s => s.value === editState.service_id) as ServiceOption | undefined;
  
  // Calculate subtotal
  let subtotal = editState.quantity * editState.rate;
  
  // For percentage discounts, we don't calculate a monetary value here
  // since it will be calculated by the billing engine based on the total
  if (editState.is_discount && editState.discount_type === 'percentage') {
    subtotal = 0; // The actual amount will be calculated server-side
  }

  // Convert rate to dollars for display (only for non-percentage discounts)
  const rateInDollars = editState.rate / 100;

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
            // is_taxable removed; derived from selectedService.tax_rate_id
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
        onClick={onToggleExpand}
        className={`p-3 border rounded-lg mb-2 cursor-pointer hover:bg-gray-50 flex justify-between items-center ${
          editState.isRemoved ? 'opacity-50 bg-gray-50' : ''
        } ${editState.is_discount ? 'border-blue-200 bg-blue-50' : ''}`}
      >
        <div className="flex-1">
          {editState.is_discount ? (
            <>
              <span className="font-medium text-blue-600">
                {editState.applies_to_item_id ? 'Item Discount' : 'Invoice Discount'}
              </span>
              <span className="mx-2 text-gray-400">|</span>
              <span className="text-gray-600">
                {editState.discount_type === 'percentage'
                  ? `${editState.discount_percentage}%`
                  : `${currencySymbol}${(Math.abs(editState.rate) / 100).toFixed(2)}`}
                {editState.applies_to_item_id && (
                  <>
                    <span className="mx-2 text-gray-400">|</span>
                    <span>Applied to: {invoiceItems?.find(i => i.item_id === editState.applies_to_item_id)?.description}</span>
                  </>
                )}
              </span>
            </>
          ) : (
            <>
              <span className="font-medium">{selectedService?.label || 'Select Service'}</span>
              {/* Derive taxable status directly from tax_rate_id */}
              <span className="text-xs text-gray-500 ml-1">
                {!!selectedService?.tax_rate_id ? '(Taxable)' : '(Non-Taxable)'}
              </span>
              <span className="mx-2 text-gray-400">|</span>
              <span className="text-gray-600">{editState.description}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-4">
          {!editState.is_discount && (
            <span className="text-gray-600">{editState.quantity} × {currencySymbol}{rateInDollars.toFixed(2)}</span>
          )}
          <span className="font-medium">
            {editState.discount_type === 'percentage'
              ? `${editState.discount_percentage || 0}%`
              : `${currencySymbol}${Math.abs(subtotal / 100).toFixed(2)}`}
          </span>
          {editState.discount_type === 'percentage' && (
            <span className="text-sm text-gray-500 ml-1">
              (calculated on save)
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`p-4 border rounded-lg space-y-3 mb-2 ${
      editState.isRemoved ? 'opacity-50 bg-gray-50' : ''
    } ${editState.is_discount ? 'border-blue-200 bg-blue-50' : ''}`}>
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">
            {editState.is_discount ? 'Discount' : `Item ${index + 1}`}
          </h3>
          {editState.isRemoved && (
            <span className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded">
              Marked for removal
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
            Add
          </Button>
          <Button
            id={editState.isRemoved ? 'restore-line-item-button' : 'remove-line-item-button'}
            type="button"
            onClick={onRemove}
            variant={editState.isRemoved ? "default" : "secondary"}
            size="sm"
          >
            {editState.isRemoved ? 'Restore' : 'Remove'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {!editState.is_discount ? (
          // Regular line item fields
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Service
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Quantity
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
        ) : (
          // Discount fields
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Discount Type
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {editState.discount_type === 'percentage' ? 'Percentage' : `Amount (${currencySymbol})`}
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Discount Description
              </label>
              <Input
                id='discount-description-input'
                type="text"
                value={editState.description}
                onChange={(e) => handleLocalChange('description', e.target.value)}
                className="w-full"
                disabled={editState.isRemoved}
                placeholder="e.g., Early Payment Discount"
              />
            </div>

            {invoiceItems && invoiceItems.length > 0 && (
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Apply Discount To
                </label>
                <CustomSelect
                  id='applies-to-item-select'
                  value={editState.applies_to_item_id || 'INVOICE'}
                  onValueChange={(value) => {
                    const applies_to_item_id = value === 'INVOICE' ? undefined : value;
                    handleLocalChange('applies_to_item_id', applies_to_item_id || '');
                  }}
                  options={[
                    { value: 'INVOICE', label: 'Entire Invoice' },
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
          <div className="col-span-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Rate ({currencySymbol})
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
        )}
      </div>

      {!editState.is_discount && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Description
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
            <p className="mt-1 text-xs text-gray-500">
              This item will be removed when you save changes
            </p>
          )}
        </div>
      )}

      <div className="text-right text-sm text-gray-600">
        {editState.is_discount ? (
          <>
            <span className="text-blue-600 font-medium">
              {editState.discount_type === 'percentage' ? 'Percentage Discount' : 'Fixed Discount'}
            </span>
            <span className="mx-2">|</span>
            <span>
              {editState.discount_type === 'percentage'
                ? `${editState.discount_percentage || 0}% of ${editState.applies_to_item_id ? 'item' : 'invoice'} total`
                : `Amount: -${currencySymbol}${(Math.abs(subtotal) / 100).toFixed(2)}`}
              {editState.applies_to_item_id && (
                <>
                  <span className="mx-2">|</span>
                  <span className="text-gray-500">
                    Applied to: {invoiceItems?.find(i => i.item_id === editState.applies_to_item_id)?.description}
                  </span>
                </>
              )}
            </span>
          </>
        ) : (
          <>Subtotal: {currencySymbol}{(subtotal / 100).toFixed(2)}</>
        )}
      </div>
    </div>
  );
};
