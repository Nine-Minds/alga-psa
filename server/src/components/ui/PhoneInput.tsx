import React, { useEffect, useState, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { Input } from './Input';
import { Label } from './Label';

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

export const PhoneInput: React.FC<PhoneInputProps> = ({
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
}) => {
  const [displayValue, setDisplayValue] = useState('');
  const [extensionValue, setExtensionValue] = useState('');
  const [previousPhoneCode, setPreviousPhoneCode] = useState<string | undefined>();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isExternalUpdate, setIsExternalUpdate] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

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

    // If phone code has changed, we need to update the phone number
    if (phoneCode !== previousPhoneCode && previousPhoneCode && phoneCode) {
      // Remove the old phone code and add the new one
      let cleanedPhone = phone;
      if (previousPhoneCode && phone.startsWith(previousPhoneCode)) {
        cleanedPhone = phone.substring(previousPhoneCode.length).trim();
      }

      // Update with new phone code
      const newPhone = phoneCode ? `${phoneCode} ${cleanedPhone}`.trim() : cleanedPhone;
      const newFullValue = combinePhoneAndExtension(newPhone, extension);
      onChange(newFullValue);
      setDisplayValue(cleanedPhone);
    } else {
      // Normal processing - remove phone code from display value if it exists
      let cleanedPhone = phone;
      if (phoneCode && phone.startsWith(phoneCode)) {
        cleanedPhone = phone.substring(phoneCode.length).trim();
      }
      setDisplayValue(cleanedPhone);
    }

    setExtensionValue(extension);
    setPreviousPhoneCode(phoneCode);
  }, [phoneCode, value, previousPhoneCode, onChange]);

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
    const basePhone = phoneCode ? `${phoneCode} ${phoneNumber}`.trim() : phoneNumber;
    const fullValue = combinePhoneAndExtension(basePhone, extensionValue);
    onChange(fullValue);
  };

  const handleExtensionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    // Only allow numbers for extension
    const extension = inputValue.replace(/[^0-9]/g, '');
    setExtensionValue(extension);

    // Combine phone code with the number and extension for the full value
    const basePhone = phoneCode ? `${phoneCode} ${displayValue}`.trim() : displayValue;
    const fullValue = combinePhoneAndExtension(basePhone, extension);
    onChange(fullValue);
  };

  const getPlaceholderText = (): string => {
    if (placeholder) return placeholder;
    if (phoneCode) {
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
      return formatExamples[phoneCode] || `123456789`;
    }
    return 'Phone number';
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleCountrySelect = (selectedCountry: Country) => {
    setIsDropdownOpen(false);
    setSearchQuery('');

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

  const currentCountry = countries?.find(c => c.code === countryCode);
  const displayPhoneCode = phoneCode || currentCountry?.phone_code || '+1';

  // If a country doesn't have a phone code, show a placeholder
  const showPlaceholderCode = !phoneCode && !currentCountry?.phone_code;

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
      <div className="relative">
        <div className="inline-flex border border-[rgb(var(--color-border-400))] rounded-md shadow-sm focus-within:outline-none focus-within:ring-2 focus-within:ring-[rgb(var(--color-primary-500))] focus-within:border-transparent bg-white">
          {/* Country Code Dropdown - integrated within phone field */}
          {true && (
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                className="flex items-center justify-between px-2 py-2 bg-white text-sm hover:bg-gray-50 focus:outline-none h-[42px] w-[80px] border-r border-gray-300 rounded-l-md"
                onClick={() => {
                  setIsDropdownOpen(!isDropdownOpen);
                  // Focus search input when dropdown opens
                  if (!isDropdownOpen) {
                    setTimeout(() => searchInputRef.current?.focus(), 100);
                  }
                }}
                disabled={disabled}
              >
                <span className={`font-medium text-xs ${showPlaceholderCode ? 'text-gray-400' : 'text-gray-700'} truncate`}>
                  {showPlaceholderCode ? '+1' : displayPhoneCode}
                </span>
                <ChevronDown className="ml-1 h-3 w-3 text-gray-400 flex-shrink-0" />
              </button>

              {isDropdownOpen && countries && countries.length > 0 && (
                <div className="absolute top-full left-0 z-50 w-64 mt-1 bg-white border border-gray-300 rounded-md shadow-lg">
                  <div className="p-2 border-b border-gray-200">
                    <input
                      ref={searchInputRef}
                      type="text"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-primary-500))] focus:border-transparent"
                      placeholder="Search countries..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                  <div className="max-h-48 overflow-y-auto p-1">
                    {getFilteredCountries(countries || [], searchQuery).map((country, index) => {
                      const isCommon = COMMON_COUNTRIES.includes(country.code);
                      const isFirstOther = !isCommon && index > 0 && COMMON_COUNTRIES.includes(getFilteredCountries(countries || [], searchQuery)[index - 1]?.code);

                      return (
                        <div key={country.code}>
                          {isFirstOther && (
                            <div className="px-3 py-1 text-xs font-medium text-gray-500 bg-gray-50 border-t border-gray-200">
                              Other Countries
                            </div>
                          )}
                          <button
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 focus:bg-gray-100 focus:outline-none flex items-center justify-between rounded"
                            onClick={() => handleCountrySelect(country)}
                          >
                            <span className="flex-1 truncate text-gray-800">{country.name}</span>
                            <span className="text-gray-600 font-mono text-sm ml-2">{country.phone_code}</span>
                          </button>
                        </div>
                      );
                    })}
                    {getFilteredCountries(countries || [], searchQuery).length === 0 && (
                      <div className="px-3 py-4 text-sm text-gray-500 text-center">
                        No countries found
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

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
            className={`w-80 border-0 focus:ring-0 focus:border-0 ${allowExtensions ? 'rounded-none' : 'rounded-r-md'} h-[42px] bg-white px-3`}
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
              className="w-20 border-none focus:ring-0 focus:outline-none rounded-r-md h-[42px] text-center text-xs bg-white px-1"
            />
            </>
          )}
        </div>

      </div>
    </div>
  );
};