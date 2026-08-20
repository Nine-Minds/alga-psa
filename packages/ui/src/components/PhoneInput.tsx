'use client';

import React, { useId, useRef } from 'react';
import PhoneNumberInput, {
  getCountryCallingCode,
  isSupportedCountry,
  parsePhoneNumber,
  type Country,
  type Value,
} from 'react-phone-number-input/input';
import { Input } from './Input';
import { Label } from './Label';

const MAX_E164_DIGITS = 15;

interface DigitLimitedInputProps extends React.ComponentProps<typeof Input> {
  maxNationalDigits?: number;
}

/** Keep the formatter from receiving values longer than E.164 can represent. */
const DigitLimitedInput = React.forwardRef<HTMLInputElement, DigitLimitedInputProps>(
  ({ maxNationalDigits = MAX_E164_DIGITS, onChange, ...props }, ref) => (
    <Input
      {...props}
      ref={ref}
      onChange={(event) => {
        const input = event.target.value.trimStart();
        const digitLimit = input.startsWith('+') ? MAX_E164_DIGITS : maxNationalDigits;
        if (input.replace(/\D/g, '').length <= digitLimit) {
          onChange?.(event);
        }
      }}
    />
  )
);

DigitLimitedInput.displayName = 'DigitLimitedInput';

interface PhoneInputProps {
  id?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  extension?: string;
  onExtensionChange?: (extension: string) => void;
  onBlur?: () => void;
  countryCode?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  required?: boolean;
  allowExtensions?: boolean;
  extensionPlaceholder?: string;
  extensionLabel?: string;
  error?: boolean;
  'data-automation-id'?: string;
}

function supportedCountry(countryCode?: string): Country | undefined {
  const country = countryCode?.trim().toUpperCase() as Country | undefined;
  return country && isSupportedCountry(country) ? country : undefined;
}

function fitsE164(value: string): value is Value {
  return /^\+\d+$/.test(value) && value.slice(1).length <= MAX_E164_DIGITS;
}

/** Convert ordinary stored formatting to the E.164 value expected by the formatter. */
function formatterValue(value: string, country: Country | undefined, extension: string): Value | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\+\d+$/.test(trimmed)) return fitsE164(trimmed) ? trimmed : undefined;
  if (!/^[+\d\s().-]+$/.test(trimmed)) return undefined;

  try {
    const parsed = parsePhoneNumber(trimmed, country);
    return parsed && (!parsed.ext || extension) && fitsE164(parsed.number)
      ? parsed.number
      : undefined;
  } catch {
    return undefined;
  }
}

/** A formatted phone number and separately stored extension in one compact group. */
export const PhoneInput = ({
  id,
  label = 'Phone',
  value,
  onChange,
  extension = '',
  onExtensionChange,
  onBlur,
  countryCode,
  placeholder = '+1 (555) 123-4567',
  disabled = false,
  className = '',
  required = false,
  allowExtensions = false,
  extensionPlaceholder = 'ext. 1234',
  extensionLabel = 'Extension',
  error = false,
  'data-automation-id': dataAutomationId,
}: PhoneInputProps) => {
  const generatedId = useId();
  const phoneId = id || dataAutomationId || `phone-${generatedId}`;
  const extensionId = `${phoneId}-ext`;
  const extensionRef = useRef<HTMLInputElement>(null);
  const country = supportedCountry(countryCode);
  const maxNationalDigits = country
    ? MAX_E164_DIGITS - getCountryCallingCode(country).length
    : MAX_E164_DIGITS;
  const formattedValue = formatterValue(value, country, extension);

  const focusExtension = () => {
    if (allowExtensions && onExtensionChange && !disabled) extensionRef.current?.focus();
  };

  const handlePhoneKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && allowExtensions && onExtensionChange) {
      event.preventDefault();
      focusExtension();
    }
  };

  const fieldsClassName = allowExtensions
    ? 'grid w-full grid-cols-[minmax(0,1fr)_5.5rem] items-start gap-2'
    : 'w-full';

  return (
    <div className={`w-full space-y-1 ${className}`.trim()} data-automation-type="phone-input-group">
      <Label htmlFor={phoneId} className="block">
        {label}
        {required && <span className="ml-1 text-[rgb(var(--color-text-500))]" aria-hidden="true">*</span>}
      </Label>

      <div className={fieldsClassName} data-automation-type="phone-input-fields">
        <div className="min-w-0">
          {value.trim() && !formattedValue ? (
            <Input
              id={phoneId}
              data-automation-id={dataAutomationId}
              type="tel"
              autoComplete="tel"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onBlur={onBlur}
              onKeyDown={handlePhoneKeyDown}
              placeholder={placeholder}
              disabled={disabled}
              required={required}
              hasError={error}
              className="w-full"
            />
          ) : (
            <PhoneNumberInput
              id={phoneId}
              inputComponent={DigitLimitedInput}
              maxNationalDigits={maxNationalDigits}
              data-automation-id={dataAutomationId}
              defaultCountry={country}
              value={formattedValue}
              onChange={(nextValue) => onChange(nextValue ?? '')}
              onBlur={onBlur}
              onKeyDown={handlePhoneKeyDown}
              placeholder={placeholder}
              disabled={disabled}
              required={required}
              hasError={error}
              preserveCursor={false}
              className="w-full"
            />
          )}
        </div>

        {allowExtensions && (
          <Input
            id={extensionId}
            ref={extensionRef}
            aria-label={extensionLabel}
            data-automation-id={dataAutomationId ? `${dataAutomationId}-ext` : undefined}
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={10}
            value={extension}
            onChange={(event) => onExtensionChange?.(event.target.value.replace(/\D/g, ''))}
            placeholder={extensionPlaceholder}
            disabled={disabled}
            className="w-full"
          />
        )}
      </div>
    </div>
  );
};
