import React, { useState, useEffect } from 'react';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Input } from 'server/src/components/ui/Input';

interface UnitOfMeasureInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  required?: boolean;
}

const standardUnits = [
  { value: 'Hour', label: 'Hour' },
  { value: 'Unit', label: 'Unit' },
  { value: 'GB', label: 'GB' },
  { value: 'User', label: 'User' },
  { value: 'Device', label: 'Device' },
  { value: 'custom', label: 'Custom...' },
];

export function UnitOfMeasureInput({
  value,
  onChange,
  placeholder = "Unit of Measure (e.g., hours, items, GB)",
  className = "",
  required = false
}: UnitOfMeasureInputProps) {
  const [selectedUnit, setSelectedUnit] = useState('');
  const [customUnit, setCustomUnit] = useState('');

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
  }, [value]);

  const handleUnitChange = (newValue: string) => {
    setSelectedUnit(newValue);
    if (newValue !== 'custom') {
      onChange(newValue);
      setCustomUnit('');
    }
  };

  const handleCustomUnitChange = (newValue: string) => {
    setCustomUnit(newValue);
    onChange(newValue);
  };

  return (
    <div className={`flex flex-col space-y-2 ${className}`}>
      <CustomSelect
        options={standardUnits}
        onValueChange={handleUnitChange}
        value={selectedUnit}
        placeholder={placeholder}
        className="w-full"
      />
      {selectedUnit === 'custom' && (
        <Input
          type="text"
          value={customUnit}
          onChange={(e) => handleCustomUnitChange(e.target.value)}
          placeholder="Enter custom unit"
          required={required}
        />
      )}
    </div>
  );
}
