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
  const subtotal = item.quantity * item.rate;

  if (!isExpanded) {
    return (
      <div 
        onClick={onToggleExpand}
        className="p-3 border rounded-lg mb-2 cursor-pointer hover:bg-gray-50 flex justify-between items-center"
      >
        <div className="flex-1">
          <span className="font-medium">{selectedService?.label || 'Select Service'}</span>
          <span className="mx-2 text-gray-400">|</span>
          <span className="text-gray-600">{item.description}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-gray-600">{item.quantity} × ${item.rate.toFixed(2)}</span>
          <span className="font-medium">${subtotal.toFixed(2)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 border rounded-lg space-y-3 mb-2">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-medium">Item {index + 1}</h3>
        <div className="flex gap-2">
          <Button
            id='add-button'
            type="button"
            onClick={onToggleExpand}
            variant="secondary"
            size="sm"
          >
            Add
          </Button>
          <Button
            id='remove-button'
            type="button"
            onClick={onRemove}
            variant="secondary"
            size="sm"
          >
            Remove
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
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Rate ($)
          </label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={item.rate}
            onChange={(e) => onChange('rate', parseFloat(e.target.value) || 0)}
            className="w-full"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Description
        </label>
        <Input
          type="text"
          value={item.description}
          onChange={(e) => onChange('description', e.target.value)}
          className="w-full"
        />
      </div>

      <div className="text-right text-sm text-gray-600">
        Subtotal: ${subtotal.toFixed(2)}
      </div>
    </div>
  );
};
