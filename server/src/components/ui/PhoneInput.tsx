import React from 'react';
import { Input } from './Input';
import { Label } from './Label';

interface PhoneInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  countryCode?: string;
  phoneCode?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  'data-automation-id'?: string;
}

export const PhoneInput: React.FC<PhoneInputProps> = ({
  label,
  value,
  onChange,
  countryCode,
  phoneCode,
  disabled = false,
  required = false,
  className = '',
  'data-automation-id': dataAutomationId
}) => {
  // Format phone display with country code if available
  const displayValue = phoneCode && value && !value.startsWith('+') 
    ? `+${phoneCode} ${value}` 
    : value;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let newValue = e.target.value;
    
    // If phoneCode exists and user is typing, remove the prefix for storage
    if (phoneCode && newValue.startsWith(`+${phoneCode} `)) {
      newValue = newValue.substring(`+${phoneCode} `.length);
    } else if (phoneCode && newValue.startsWith(`+${phoneCode}`)) {
      newValue = newValue.substring(`+${phoneCode}`.length);
    }
    
    onChange(newValue);
  };

  return (
    <div>
      <Label htmlFor={dataAutomationId || 'phone-input'} className="block text-sm font-medium text-gray-700 mb-1">
        {label} {required && '*'}
      </Label>
      <Input
        id={dataAutomationId || 'phone-input'}
        type="tel"
        value={displayValue}
        onChange={handleChange}
        disabled={disabled}
        placeholder={phoneCode ? `+${phoneCode} ` : ''}
        className={`w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 ${className}`}
        data-automation-id={dataAutomationId}
      />
    </div>
  );
};