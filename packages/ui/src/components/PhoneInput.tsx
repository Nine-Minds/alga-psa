'use client';

import React, { useEffect, useMemo, useState, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { Input } from './Input';
import { Label } from './Label';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';

interface Country {
  code: string;
  name: string;
  phone_code?: string;
}

// Common countries pinned at top (enterprise standard)
const COMMON_COUNTRIES = ['US', 'GB', 'CA', 'AU', 'IN', 'DE', 'FR', 'BR', 'JP', 'CN'];

// Country code to flag emoji mapping
const getCountryFlag = (countryCode: string): string => {
  const codePoints = countryCode
    .toUpperCase()
    .split('')
    .map(char => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
};

// Enterprise locale detection for default country
const getDefaultCountryFromLocale = (): string => {
  try {
    // Try to get country from browser locale
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    const parts = locale.split('-');
    const countryCode = parts[parts.length - 1]?.toUpperCase();

    // Validate it's a reasonable country code (2 letters)
    if (countryCode && countryCode.length === 2 && /^[A-Z]{2}$/.test(countryCode)) {
      return countryCode;
    }
  } catch (e) {
    // Fallback to US if detection fails
  }

  return 'US'; // Enterprise default
};

const normalizePhoneCode = (value?: string): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
};

const stripLeadingPhoneCode = (phone: string, phoneCode?: string): string => {
  const normalizedCode = normalizePhoneCode(phoneCode);
  if (!normalizedCode) {
    return phone.trim();
  }

  const trimmedPhone = phone.trim();
  if (!trimmedPhone.startsWith(normalizedCode)) {
    return trimmedPhone;
  }

  return trimmedPhone.slice(normalizedCode.length).trimStart();
};

const detectPhoneCodeFromValue = (phone: string, countries?: Country[]): string | undefined => {
  const trimmedPhone = phone.trim();
  if (!trimmedPhone.startsWith('+') || !countries?.length) {
    return undefined;
  }

  return countries
    .map((country) => normalizePhoneCode(country.phone_code))
    .filter((phoneCode): phoneCode is string => {
      if (!phoneCode) {
        return false;
      }

      return trimmedPhone.startsWith(phoneCode);
    })
    .sort((left, right) => right.length - left.length)[0];
};

interface PhoneInputProps {
  id?: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  countryCode?: string; // ISO country code (e.g., 'US', 'GB')
  phoneCode?: string; // Phone code (e.g., '+1', '+44')
  countries?: Country[]; // List of countries for dropdown
  onCountryChange?: (countryCode: string) => void; // Callback when country changes
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  required?: boolean;
  allowExtensions?: boolean; // Allow phone extensions (ext. 1234)
  extensionPlaceholder?: string; // Placeholder for extension field
  error?: boolean; // Whether to show error styling
  'data-automation-id'?: string;
  externalCountryCode?: string; // For one-way sync from address country
}

export const PhoneInput = ({
  id,
  label,
  value,
  onChange,
  onBlur,
  countryCode,
  phoneCode,
  countries,
  onCountryChange,
  placeholder,
  disabled = false,
  className = '',
  required = false,
  allowExtensions = false,
  extensionPlaceholder = "ext. 1234",
  'data-automation-id': dataAutomationId,
  externalCountryCode
}: PhoneInputProps) => {
  const [displayValue, setDisplayValue] = useState('');
  const [extensionValue, setExtensionValue] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isExternalUpdate, setIsExternalUpdate] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const resolvedCountryCode = countryCode || getDefaultCountryFromLocale();
  const currentCountry = countries?.find(c => c.code === resolvedCountryCode);
  const resolvedPhoneCode = normalizePhoneCode(phoneCode || currentCountry?.phone_code);

  // Parse phone number and extension from value
  const parsePhoneAndExtension = (fullValue: string): { phone: string; extension: string } => {
    if (!fullValue) return { phone: '', extension: '' };

    // Look for extension patterns: "ext 123", "ext. 123", "x123", "extension 123"
    const extPatterns = [
      /\s+ext\.?\s*(\d+)$/i,
      /\s+x\s*(\d+)$/i,
      /\s+extension\s*(\d+)$/i,
      /\s+e\s*(\d+)$/i
    ];

    for (const pattern of extPatterns) {
      const match = fullValue.match(pattern);
      if (match) {
        const phone = fullValue.replace(pattern, '').trim();
        const extension = match[1];
        return { phone, extension };
      }
    }

    return { phone: fullValue, extension: '' };
  };

  // Combine phone and extension into full value
  const combinePhoneAndExtension = (phone: string, extension: string): string => {
    if (!extension.trim()) return phone;
    return `${phone} ext. ${extension.trim()}`;
  };

  // Clean phone number display - remove country code from input and parse extensions
  useEffect(() => {
    const { phone, extension } = parsePhoneAndExtension(value);
    const detectedPhoneCode = detectPhoneCodeFromValue(phone, countries);
    const cleanedPhone = stripLeadingPhoneCode(
      phone,
      resolvedPhoneCode && phone.startsWith(resolvedPhoneCode)
        ? resolvedPhoneCode
        : detectedPhoneCode
    );

    setDisplayValue(cleanedPhone);
    setExtensionValue(extension);
  }, [countries, resolvedPhoneCode, value]);

  // Handle external country code sync (one-way from address country to phone)
  useEffect(() => {
    if (externalCountryCode && countries && countries.length > 0) {
      const matchingCountry = countries.find(country => country.code === externalCountryCode);
      if (matchingCountry && onCountryChange) {
        setIsExternalUpdate(true);
        onCountryChange(matchingCountry.code);
        // Reset flag after a brief delay to allow the change to propagate
        setTimeout(() => setIsExternalUpdate(false), 100);
      }
    }
  }, [externalCountryCode, countries, onCountryChange]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const phoneNumber = e.target.value;
    setDisplayValue(phoneNumber);

    // Combine phone code with the number for the full value
    const basePhone = resolvedPhoneCode ? `${resolvedPhoneCode} ${phoneNumber}`.trim() : phoneNumber;
    const fullValue = combinePhoneAndExtension(basePhone, extensionValue);
    onChange(fullValue);
  };

  const handleExtensionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    // Only allow numbers for extension
    const extension = inputValue.replace(/[^0-9]/g, '');
    setExtensionValue(extension);

    // Combine phone code with the number and extension for the full value
    const basePhone = resolvedPhoneCode ? `${resolvedPhoneCode} ${displayValue}`.trim() : displayValue;
    const fullValue = combinePhoneAndExtension(basePhone, extension);
    onChange(fullValue);
  };

  const getPlaceholderText = (): string => {
    if (placeholder) return placeholder;
    if (resolvedPhoneCode) {
      // Provide country-specific format examples WITHOUT phone code
      const formatExamples: Record<string, string> = {
        '+1': `(555) 123-4567`,
        '+44': `20 7123 4567`,
        '+49': `30 12345678`,
        '+33': `1 23 45 67 89`,
        '+61': `2 1234 5678`,
        '+81': `3-1234-5678`,
        '+86': `138 0013 8000`,
        '+91': `98765 43210`,
      };
      return formatExamples[resolvedPhoneCode] || `123456789`;
    }
    return 'Phone number';
  };

  const handleCountrySelect = (selectedCountry: Country) => {
    setIsDropdownOpen(false);
    setSearchQuery('');

    const selectedPhoneCode = normalizePhoneCode(selectedCountry.phone_code);
    const { phone, extension } = parsePhoneAndExtension(value);
    const strippedPhone = stripLeadingPhoneCode(
      phone,
      resolvedPhoneCode && phone.startsWith(resolvedPhoneCode)
        ? resolvedPhoneCode
        : detectPhoneCodeFromValue(phone, countries)
    );

    if (onChange) {
      const updatedPhone = strippedPhone
        ? combinePhoneAndExtension(
            selectedPhoneCode ? `${selectedPhoneCode} ${strippedPhone}`.trim() : strippedPhone,
            extension
          )
        : '';
      onChange(updatedPhone);
    }

    // Always trigger onCountryChange to update the phone code display
    // This is needed for the phone input to show the correct country code
    if (onCountryChange) {
      onCountryChange(selectedCountry.code);
    }
  };

  // Enterprise-grade country sorting: Common countries first, then alphabetical
  const getSortedCountries = (countries: Country[]): Country[] => {
    if (!countries) return [];

    const commonCountries = countries.filter(c => COMMON_COUNTRIES.includes(c.code));
    const otherCountries = countries.filter(c => !COMMON_COUNTRIES.includes(c.code));

    // Sort common countries by the order defined in COMMON_COUNTRIES
    const sortedCommon = commonCountries.sort((a, b) => {
      const aIndex = COMMON_COUNTRIES.indexOf(a.code);
      const bIndex = COMMON_COUNTRIES.indexOf(b.code);
      return aIndex - bIndex;
    });

    // Sort other countries alphabetically
    const sortedOthers = otherCountries.sort((a, b) => a.name.localeCompare(b.name));

    return [...sortedCommon, ...sortedOthers];
  };

  // Enterprise-grade search: by country name or dial code
  const getFilteredCountries = (countries: Country[], query: string): Country[] => {
    if (!query.trim()) return getSortedCountries(countries);

    const lowerQuery = query.toLowerCase();
    const filtered = countries.filter(country =>
      country.name.toLowerCase().includes(lowerQuery) ||
      country.code.toLowerCase().includes(lowerQuery) ||
      country.phone_code?.includes(lowerQuery)
    );

    return getSortedCountries(filtered);
  };
  const filteredCountries = useMemo(
    () => getFilteredCountries(countries || [], searchQuery),
    [countries, searchQuery]
  );

  useEffect(() => {
    if (!isDropdownOpen) {
      setSearchQuery('');
      return;
    }

    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 10);

    return () => window.clearTimeout(timer);
  }, [isDropdownOpen]);

  const displayPhoneCode = resolvedPhoneCode || '+1';

  return (
    <div className={`w-full ${className}`.trim()}>
      {label && (
        <Label
          htmlFor={id || dataAutomationId}
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </Label>
      )}
      <div className="relative">
        <div className="flex w-full items-stretch overflow-hidden rounded-md border border-[rgb(var(--color-border-400))] bg-white shadow-sm focus-within:border-transparent focus-within:outline-none focus-within:ring-2 focus-within:ring-[rgb(var(--color-primary-500))]">
          {/* Country Code Dropdown - integrated within phone field */}
          <Popover open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex h-[42px] w-[84px] items-center justify-between border-r border-gray-300 bg-white px-2 py-2 text-sm hover:bg-gray-50 focus:outline-none"
                disabled={disabled}
                aria-haspopup="listbox"
                aria-expanded={isDropdownOpen}
              >
                <span className="truncate text-xs font-medium text-gray-700">
                  {displayPhoneCode}
                </span>
                <ChevronDown className="ml-1 h-3 w-3 text-gray-400 flex-shrink-0" />
              </button>
            </PopoverTrigger>
            {countries && countries.length > 0 && (
              <PopoverContent
                side="bottom"
                align="start"
                sideOffset={6}
                className="w-64 p-0"
              >
                <div className="border-b border-gray-200 p-2">
                  <input
                    ref={searchInputRef}
                    type="text"
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-primary-500))]"
                    placeholder="Search countries..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div className="max-h-48 overflow-y-auto p-1">
                  {filteredCountries.map((country, index) => {
                    const isCommon = COMMON_COUNTRIES.includes(country.code);
                    const previousCountry = filteredCountries[index - 1];
                    const isFirstOther = !isCommon && index > 0 && previousCountry && COMMON_COUNTRIES.includes(previousCountry.code);

                    return (
                      <div key={country.code}>
                        {isFirstOther && (
                          <div className="border-t border-gray-200 bg-gray-50 px-3 py-1 text-xs font-medium text-gray-500">
                            Other Countries
                          </div>
                        )}
                        <button
                          type="button"
                          className="flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                          onClick={() => handleCountrySelect(country)}
                        >
                          <span className="flex-1 truncate text-gray-800">{country.name}</span>
                          <span className="ml-2 font-mono text-sm text-gray-600">{country.phone_code}</span>
                        </button>
                      </div>
                    );
                  })}
                  {filteredCountries.length === 0 && (
                    <div className="px-3 py-4 text-center text-sm text-gray-500">
                      No countries found
                    </div>
                  )}
                </div>
              </PopoverContent>
            )}
          </Popover>

          {/* Phone Number Input */}
          <Input
            id={id || dataAutomationId}
            data-automation-id={dataAutomationId}
            type="tel"
            value={displayValue}
            onChange={handleInputChange}
            onBlur={onBlur}
            placeholder={getPlaceholderText()}
            disabled={disabled}
            required={required}
            className={`min-w-0 flex-1 border-0 bg-white px-3 h-[42px] focus:border-0 focus:ring-0 ${allowExtensions ? 'rounded-none' : 'rounded-r-md'}`}
          />

          {/* Extension Input */}
          {allowExtensions && (
            <>
              <div className="w-px bg-gray-300 h-6 self-center"></div>
              <Input
                id={`${id || dataAutomationId}-ext`}
                data-automation-id={`${dataAutomationId}-ext`}
                type="text"
                value={extensionValue}
                onChange={handleExtensionChange}
                placeholder={extensionPlaceholder || "optional ext."}
                disabled={disabled}
                className="h-[42px] w-24 shrink-0 rounded-r-md border-none bg-white px-2 text-center text-xs focus:outline-none focus:ring-0"
              />
            </>
          )}
        </div>

      </div>
    </div>
  );
};
