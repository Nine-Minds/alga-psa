import React, { useState, useEffect } from 'react';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Input } from 'server/src/components/ui/Input';
import { updateService } from 'server/src/lib/actions/serviceActions';
import { IService } from 'server/src/interfaces/billing.interfaces';

interface UnitOfMeasureInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  required?: boolean;
  disabled?: boolean;
  serviceId?: string;
  onSaveComplete?: () => void;
  serviceType?: string;
}

// Define unit presets based on service type
const getUnitPresets = (serviceType?: string) => {
  const commonUnits = [
    { value: 'Unit', label: 'Unit' },
    { value: 'Item', label: 'Item' },
  ];

  const typeSpecificUnits: Record<string, Array<{ value: string; label: string }>> = {
    'Time': [
      { value: 'Hour', label: 'Hour' },
      { value: 'Day', label: 'Day' },
      { value: 'Week', label: 'Week' },
    ],
    'Usage': [
      { value: 'GB', label: 'GB' },
      { value: 'TB', label: 'TB' },
      { value: 'API Call', label: 'API Call' },
      { value: 'User', label: 'User' },
      { value: 'Device', label: 'Device' },
      { value: 'License', label: 'License' },
    ],
    'Fixed': [
      { value: 'Month', label: 'Month' },
      { value: 'Quarter', label: 'Quarter' },
      { value: 'Year', label: 'Year' },
      { value: 'Project', label: 'Project' },
    ],
    'Product': [
      { value: 'Piece', label: 'Piece' },
      { value: 'Box', label: 'Box' },
      { value: 'Package', label: 'Package' },
    ],
    'License': [
      { value: 'Seat', label: 'Seat' },
      { value: 'Instance', label: 'Instance' },
      { value: 'Installation', label: 'Installation' },
    ],
  };

  // Get type-specific units or empty array if type doesn't exist
  const specificUnits = serviceType ? (typeSpecificUnits[serviceType] || []) : [];
  
  // Combine common units with type-specific units
  const standardUnits = [...specificUnits, ...commonUnits];
  
  // Always add custom option at the end
  return [...standardUnits, { value: 'custom', label: 'Custom...' }];
};

export function UnitOfMeasureInput({
  value,
  onChange,
  placeholder = "Unit of Measure (e.g., hours, items, GB)",
  className = "",
  required = false,
  disabled = false,
  serviceId,
  onSaveComplete,
  serviceType
}: UnitOfMeasureInputProps) {
  const [selectedUnit, setSelectedUnit] = useState('');
  const [customUnit, setCustomUnit] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const standardUnits = getUnitPresets(serviceType);

  useEffect(() => {
    if (standardUnits.some(unit => unit.value === value)) {
      setSelectedUnit(value);
      setCustomUnit('');
    } else if (value) {
      setSelectedUnit('custom');
      setCustomUnit(value);
    } else {
      setSelectedUnit('');
      setCustomUnit('');
    }
  }, [value, standardUnits]);

  const handleUnitChange = async (newValue: string) => {
    setSelectedUnit(newValue);
    
    if (newValue !== 'custom') {
      onChange(newValue);
      setCustomUnit('');
      
      // If serviceId is provided, persist the change
      if (serviceId) {
        await persistUnitChange(newValue);
      }
    }
  };

  const handleCustomUnitChange = (newValue: string) => {
    setCustomUnit(newValue);
    onChange(newValue);
  };

  const handleCustomUnitBlur = async () => {
    if (serviceId && customUnit) {
      await persistUnitChange(customUnit);
    }
  };

  const persistUnitChange = async (unitValue: string) => {
    if (!serviceId) return;
    
    try {
      setIsSaving(true);
      setError(null);
      
      await updateService(serviceId, {
        unit_of_measure: unitValue
      } as Partial<IService>);
      
      if (onSaveComplete) {
        onSaveComplete();
      }
    } catch (err) {
      console.error('Error updating unit of measure:', err);
      setError('Failed to save unit of measure');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={`flex flex-col space-y-2 ${className}`}>
      <CustomSelect
        id="unit-of-measure-select"
        options={standardUnits}
        onValueChange={handleUnitChange}
        value={selectedUnit}
        placeholder={placeholder}
        className="w-full"
        disabled={disabled || isSaving}
        label="Unit of Measure"
        required={required}
      />
      {selectedUnit === 'custom' && (
        <Input
          id="custom-unit-input"
          type="text"
          value={customUnit}
          onChange={(e) => handleCustomUnitChange(e.target.value)}
          onBlur={handleCustomUnitBlur}
          placeholder="Enter custom unit"
          required={required}
          disabled={disabled || isSaving}
        />
      )}
      {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
      {isSaving && <p className="text-gray-500 text-sm mt-1">Saving...</p>}
    </div>
  );
}
