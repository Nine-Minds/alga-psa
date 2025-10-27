import React, { useState, useEffect } from 'react';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Input } from 'server/src/components/ui/Input';
import { updateService } from '@product/actions/serviceActions';
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
    { value: 'Hour', label: 'Hour' },
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
    'Hourly': [
      { value: 'Hour', label: 'Hour' },
    ],
  };

  // Get type-specific units or empty array if type doesn't exist
  const specificUnits = serviceType ? (typeSpecificUnits[serviceType] || []) : [];
  
  // Combine common units with type-specific units, removing duplicates
  const uniqueUnits = [...specificUnits];
  
  // Add common units only if they don't already exist in specificUnits
  commonUnits.forEach(unit => {
    if (!uniqueUnits.some(u => u.value === unit.value)) {
      uniqueUnits.push(unit);
    }
  });
  
  // Always add custom option at the end with a unique value
  return [...uniqueUnits, { value: 'custom', label: 'Custom...' }];
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
  // Add a ref to track if we're in custom mode to prevent useEffect from overriding it
  const isInCustomMode = React.useRef(false);
  
  const standardUnits = getUnitPresets(serviceType);

  useEffect(() => {
    console.log('useEffect triggered with value:', value);
    
    // Skip this effect if we're in custom mode and just selected it
    if (isInCustomMode.current) {
      console.log('In custom mode, skipping useEffect');
      return;
    }
    
    // If the current value matches a standard unit, select that unit
    if (standardUnits.some(unit => unit.value === value)) {
      console.log('Value matches standard unit:', value);
      setSelectedUnit(value);
      setCustomUnit('');
    }
    // If we have a value but it's not in standard units, it's a custom value
    else if (value) {
      console.log('Value is custom:', value);
      setSelectedUnit('custom');
      setCustomUnit(value);
    }
    // If no value is provided, reset both states
    else {
      console.log('No value provided');
      setSelectedUnit('');
      setCustomUnit('');
    }
  }, [value, standardUnits]);

  const handleUnitChange = async (newValue: string) => {
    console.log('handleUnitChange called with:', newValue);
    
    // When "Custom..." is selected
    if (newValue === 'custom') {
      // Set the flag to prevent useEffect from changing the selection
      isInCustomMode.current = true;
      setSelectedUnit('custom'); // Set the dropdown to show "Custom..."
      
      // Don't call onChange yet - we'll wait for the user to input a custom value
      // Don't reset customUnit if it already has a value (in case user is switching back to custom)
      if (!customUnit) {
        setCustomUnit('');
      }
    } else {
      // For standard units
      isInCustomMode.current = false;
      setSelectedUnit(newValue);
      onChange(newValue);
      setCustomUnit('');
      
      // If serviceId is provided, persist the change
      if (serviceId) {
        await persistUnitChange(newValue);
      }
    }
  };

  const handleCustomUnitChange = (newValue: string) => {
    console.log('handleCustomUnitChange called with:', newValue);
    setCustomUnit(newValue);
    
    // Reset the custom mode flag when the user types something
    isInCustomMode.current = false;
    
    // Always call onChange with the new value
    // This ensures the parent component always has the current value
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
        required={required}
      />
      
      {/* Show the custom input field when selectedUnit is 'custom' */}
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
