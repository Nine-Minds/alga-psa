import React from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import CustomSelect, { SelectOption } from '../ui/CustomSelect';

interface LineItemProps {
  item: {
    service_id: string;
    quantity: number;
    description: string;
    rate: number;
    isExisting?: boolean;
    isRemoved?: boolean;
  };
  index: number;
  isExpanded: boolean;
  serviceOptions: SelectOption[];
  onRemove: () => void;
  onChange: (field: string, value: string | number) => void;
  onToggleExpand: () => void;
}

export const LineItem: React.FC<LineItemProps> = ({
  item,
  index,
  isExpanded,
  serviceOptions,
  onRemove,
  onChange,
  onToggleExpand,
}) => {
  const selectedService = serviceOptions.find(s => s.value === item.service_id);
  // Calculate subtotal in cents (rate is already in cents)
  const subtotal = item.quantity * item.rate;
  // Convert rate to dollars for display
  const rateInDollars = item.rate / 100;

  if (!isExpanded) {
    return (
      <div
        onClick={onToggleExpand}
        className={`p-3 border rounded-lg mb-2 cursor-pointer hover:bg-gray-50 flex justify-between items-center ${
          item.isRemoved ? 'opacity-50 bg-gray-50' : ''
        }`}
      >
        <div className="flex-1">
          <span className="font-medium">{selectedService?.label || 'Select Service'}</span>
          <span className="mx-2 text-gray-400">|</span>
          <span className="text-gray-600">{item.description}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-gray-600">{item.quantity} × ${rateInDollars.toFixed(2)}</span>
          <span className="font-medium">${(subtotal / 100).toFixed(2)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`p-4 border rounded-lg space-y-3 mb-2 ${
      item.isRemoved ? 'opacity-50 bg-gray-50' : ''
    }`}>
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">Item {index + 1}</h3>
          {item.isRemoved && (
            <span className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded">
              Marked for removal
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            id='collapse-button'
            type="button"
            onClick={onToggleExpand}
            variant="secondary"
            size="sm"
          >
            Collapse
          </Button>
          <Button
            id={item.isRemoved ? 'restore-button' : 'remove-button'}
            type="button"
            onClick={onRemove}
            variant={item.isRemoved ? "default" : "secondary"}
            size="sm"
          >
            {item.isRemoved ? 'Restore' : 'Remove'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Service
          </label>
          <CustomSelect
            value={item.service_id}
            onValueChange={(value: string) => onChange('service_id', value)}
            options={serviceOptions}
            className="w-full"
            disabled={item.isRemoved}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Quantity
          </label>
          <Input
            type="number"
            min="0.01"
            step="0.01"
            value={item.quantity}
            onChange={(e) => onChange('quantity', parseFloat(e.target.value) || 0)}
            className="w-full"
            disabled={item.isRemoved}
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Rate ($) {/* Rate is in dollars in UI, converted to cents when saving */}
          </label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={rateInDollars}
            onChange={(e) => {
              const value = e.target.value;
              // Handle rate input in dollars:
              // - If value has decimal (e.g. "50.50"), multiply by 100 (becomes 5050 cents)
              // - If value is whole number (e.g. "50"), multiply by 100 (becomes 5000 cents)
              // This allows users to enter either format while storing everything in cents
              const rateInCents = value.includes('.')
                ? Math.round(parseFloat(value) * 100)
                : parseInt(value, 10) * 100;
              onChange('rate', rateInCents || 0);
            }}
            className="w-full"
            disabled={item.isRemoved}
          />
        </div>
      </div>

      <div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Description
          </label>
          <Input
            type="text"
            value={item.description}
            onChange={(e) => onChange('description', e.target.value)}
            className="w-full"
            disabled={item.isRemoved}
          />
          {item.isRemoved && (
            <p className="mt-1 text-xs text-gray-500">
              This item will be removed when you save changes
            </p>
          )}
        </div>
      </div>

      <div className="text-right text-sm text-gray-600">
        Subtotal: ${(subtotal / 100).toFixed(2)}
      </div>
    </div>
  );
};
