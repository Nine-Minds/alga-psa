'use client';

import React, { useId } from 'react';
import { FieldWarnings, Input } from './Input';
import { Label } from './Label';

interface Country {
  code: string;
  name: string;
  phone_code?: string;
}

interface PhoneInputProps {
  id?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  /** Extension, kept as its own value. Never packed into the number. */
  extension?: string;
  onExtensionChange?: (extension: string) => void;
  onBlur?: () => void;
  /** Retained for caller compatibility and server-side country-aware validation. */
  countryCode?: string;
  /** Retained for caller compatibility; the dial prefix is entered in the phone field. */
  phoneCode?: string;
  countries?: Country[];
  onCountryChange?: (countryCode: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  required?: boolean;
  allowExtensions?: boolean;
  extensionPlaceholder?: string;
  extensionLabel?: string;
  error?: boolean;
  /** Plausibility warnings; rendered beneath the phone field and never gate a save. */
  warnings?: string[];
  'data-automation-id'?: string;
  externalCountryCode?: string;
}

/**
 * A phone number and extension are two independent storage fields, so they are
 * presented as two ordinary inputs. The wrapping layout gives the number all
 * available width and moves the narrow extension below it when space is tight.
 *
 * The phone value is intentionally passed through unchanged. Users may enter an
 * international prefix directly (the placeholder demonstrates that format), and
 * write boundaries remain responsible for normalization.
 */
export const PhoneInput = ({
  id,
  label = 'Phone',
  value,
  onChange,
  extension = '',
  onExtensionChange,
  onBlur,
  placeholder = '+1 (555) 123-4567',
  disabled = false,
  className = '',
  required = false,
  allowExtensions = false,
  extensionPlaceholder = '1234',
  extensionLabel = 'Extension',
  warnings,
  'data-automation-id': dataAutomationId,
}: PhoneInputProps) => {
  const generatedId = useId();
  const phoneId = id || dataAutomationId || `phone-${generatedId}`;
  const extensionId = `${phoneId}-ext`;

  return (
    <div className={`flex w-full flex-wrap items-start gap-3 ${className}`.trim()}>
      <div className="min-w-[min(100%,16rem)] flex-[1_1_16rem]">
        <Label htmlFor={phoneId} className="mb-1 block text-sm font-medium text-gray-700">
          {label}
          {required && (
            <span className="ml-1 text-[rgb(var(--color-text-500))]" aria-hidden="true">*</span>
          )}
        </Label>
        <Input
          id={phoneId}
          data-automation-id={dataAutomationId}
          type="tel"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          className="w-full"
        />
        <FieldWarnings warnings={warnings ?? []} />
      </div>

      {allowExtensions && (
        <div className="w-full sm:w-28 sm:flex-[0_0_7rem]">
          <Label htmlFor={extensionId} className="mb-1 block text-sm font-medium text-gray-700">
            {extensionLabel}
          </Label>
          <Input
            id={extensionId}
            data-automation-id={dataAutomationId ? `${dataAutomationId}-ext` : undefined}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={10}
            value={extension}
            onChange={(event) => onExtensionChange?.(event.target.value.replace(/[^0-9]/g, ''))}
            placeholder={extensionPlaceholder}
            disabled={disabled}
            className="w-full"
          />
        </div>
      )}
    </div>
  );
};
