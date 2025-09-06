import React, { useEffect, useState } from 'react';
import { Input } from './Input';
import { Label } from './Label';

interface PhoneInputProps {
  id?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  countryCode?: string; // ISO country code (e.g., 'US', 'GB')
  phoneCode?: string; // Phone code (e.g., '+1', '+44')
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  required?: boolean;
  'data-automation-id'?: string;
}

export const PhoneInput: React.FC<PhoneInputProps> = ({
  id,
  label,
  value,
  onChange,
  countryCode,
  phoneCode,
  placeholder,
  disabled = false,
  className = '',
  required = false,
  'data-automation-id': dataAutomationId
}) => {
  const [displayValue, setDisplayValue] = useState(value);
  const [previousPhoneCode, setPreviousPhoneCode] = useState<string | undefined>();

  // Auto-suggest phone code when country changes
  useEffect(() => {
    if (phoneCode && phoneCode !== previousPhoneCode) {
      // Only auto-suggest if the current value doesn't already start with a phone code
      if (!value || (!value.startsWith('+') && !value.match(/^\d{1,4}\s/))) {
        const newValue = phoneCode + (value ? ` ${value}` : '');
        setDisplayValue(newValue);
        onChange(newValue);
      } else if (previousPhoneCode && value.startsWith(previousPhoneCode)) {
        // Replace the old phone code with the new one
        const phoneNumber = value.replace(previousPhoneCode, '').trim();
        const newValue = phoneCode + (phoneNumber ? ` ${phoneNumber}` : '');
        setDisplayValue(newValue);
        onChange(newValue);
      }
      setPreviousPhoneCode(phoneCode);
    }
  }, [phoneCode, value, onChange, previousPhoneCode]);

  // Update display value when external value changes
  useEffect(() => {
    setDisplayValue(value);
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setDisplayValue(newValue);
    onChange(newValue);
  };

  const getPlaceholderText = (): string => {
    if (placeholder) return placeholder;
    if (phoneCode) {
      // Provide country-specific format examples
      const formatExamples: Record<string, string> = {
        '+1': `${phoneCode} (555) 123-4567`,
        '+44': `${phoneCode} 20 7123 4567`,
        '+49': `${phoneCode} 30 12345678`,
        '+33': `${phoneCode} 1 23 45 67 89`,
        '+61': `${phoneCode} 2 1234 5678`,
        '+81': `${phoneCode} 3-1234-5678`,
        '+86': `${phoneCode} 138 0013 8000`,
        '+91': `${phoneCode} 98765 43210`,
      };
      return formatExamples[phoneCode] || `${phoneCode} 123456789`;
    }
    return 'Enter phone number';
  };

  return (
    <div className={className}>
      {label && (
        <Label 
          htmlFor={id || dataAutomationId} 
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </Label>
      )}
      <Input
        id={id || dataAutomationId}
        data-automation-id={dataAutomationId}
        type="tel"
        value={displayValue}
        onChange={handleInputChange}
        placeholder={getPlaceholderText()}
        disabled={disabled}
        className="w-full p-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500"
      />
      {phoneCode && (
        <p className="text-xs text-gray-500 mt-1">
          Phone code for {countryCode}: {phoneCode}
        </p>
      )}
    </div>
  );
};