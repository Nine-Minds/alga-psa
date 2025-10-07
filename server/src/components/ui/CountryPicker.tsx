import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { AutomationProps, FormFieldComponent } from '../../types/ui-reflection/types';
import { Input } from './Input';
import { Button } from './Button';
import { useAutomationIdAndRegister } from '../../types/ui-reflection/useAutomationIdAndRegister';

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
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    const parts = locale.split('-');
    const countryCode = parts[parts.length - 1]?.toUpperCase();

    if (countryCode && countryCode.length === 2 && /^[A-Z]{2}$/.test(countryCode)) {
      return countryCode;
    }
  } catch (e) {
    // Fallback to US if detection fails
  }
  return 'US';
};

interface CountryPickerProps {
  id?: string;
  label?: string;
  value: string;
  onValueChange: (countryCode: string, countryName: string) => void;
  countries: Country[];
  disabled?: boolean;
  className?: string; 
  labelStyle?: 'bold' | 'medium' | 'normal' | 'none'; 
  buttonWidth?: 'fit' | 'full'; 
  placeholder?: string;
}

const CountryPicker: React.FC<CountryPickerProps & AutomationProps> = ({ 
  id,
  label, 
  value, 
  onValueChange, 
  countries,
  disabled, 
  className,
  labelStyle = 'bold',
  buttonWidth = 'fit',
  placeholder = 'Select Country',
  'data-automation-id': dataAutomationId
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dropdownPosition, setDropdownPosition] = useState<'bottom' | 'top'>('bottom');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  
  // Register with UI reflection system
  const { automationIdProps: pickerProps, updateMetadata } = useAutomationIdAndRegister<FormFieldComponent>({
    type: 'formField',
    fieldType: 'select',
    label,
    value,
    disabled,
  }, true, dataAutomationId);
  
  const currentCountry = countries.find(country => country.code === value);
  
  // Enterprise-grade country sorting: Common countries first, then alphabetical
  const getSortedCountries = (countries: Country[]): Country[] => {
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

  const getFilteredCountries = (countries: Country[], query: string): Country[] => {
    if (!query.trim()) return getSortedCountries(countries);

    const filtered = countries.filter(country => {
      return country.name.toLowerCase().includes(query.toLowerCase()) ||
             country.code.toLowerCase().includes(query.toLowerCase());
    });

    return getSortedCountries(filtered);
  };

  const filteredCountries = getFilteredCountries(countries, searchQuery);

  // Update metadata when value changes
  useEffect(() => {
    if (updateMetadata) {
      updateMetadata({
        value,
        label,
        disabled,
      });
    }
  }, [updateMetadata, value, label, disabled]);

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 10);
    }
  }, [isOpen]);

  // Function to update dropdown position
  const updateDropdownPosition = () => {
    if (!buttonRef.current) return;
    
    const buttonRect = buttonRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - buttonRect.bottom;
    const spaceAbove = buttonRect.top;
    
    // Estimate dropdown height
    const baseHeight = 40 + 20; // search input + padding
    const itemsHeight = Math.min(filteredCountries.length, 5) * 36;
    const estimatedDropdownHeight = baseHeight + itemsHeight + 10;
    
    if (spaceBelow < 250 || spaceBelow < estimatedDropdownHeight) {
      if (spaceAbove > 150) {
        setDropdownPosition('top');
      } else {
        setDropdownPosition('bottom');
      }
    } else {
      setDropdownPosition('bottom');
    }
  };

  // Calculate dropdown position when it opens
  useEffect(() => {
    if (isOpen) {
      updateDropdownPosition();
      
      window.addEventListener('scroll', updateDropdownPosition, true);
      window.addEventListener('resize', updateDropdownPosition);
      
      return () => {
        window.removeEventListener('scroll', updateDropdownPosition, true);
        window.removeEventListener('resize', updateDropdownPosition);
      };
    }
  }, [isOpen, filteredCountries.length]);

  const toggleDropdown = (e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!disabled) {
      setIsOpen(!isOpen);
      if (!isOpen) {
        setSearchQuery('');
      }
    }
  };

  const handleSelectCountry = (country: Country, e: React.MouseEvent) => {
    e.stopPropagation();
    onValueChange(country.code, country.name);
    setIsOpen(false);
  };

  const selectedCountryName = currentCountry 
    ? `${currentCountry.name} (${currentCountry.code})`
    : placeholder;

  return (
    <div className={`relative inline-block ${buttonWidth === 'full' ? 'w-full' : ''} ${className || ''}`} ref={dropdownRef} onClick={(e) => e.stopPropagation()}>
      {label && labelStyle !== 'none' && (
        <h5 className={`mb-1 ${
          labelStyle === 'bold' ? 'font-bold' : 
          labelStyle === 'medium' ? 'font-medium' : 
          'font-normal'
        }`}>{label}</h5>
      )}
      
      {/* Trigger Button */}
      <Button
        {...pickerProps}
        ref={buttonRef}
        id={id || pickerProps['data-automation-id'] || 'country-picker-button'}
        type="button"
        onClick={toggleDropdown}
        disabled={disabled}
        variant="outline"
        className={`inline-flex items-center justify-between rounded-lg p-2 h-10 text-sm font-medium ${
          buttonWidth === 'full' ? 'w-full' : 'w-fit min-w-[200px]'
        }`}
      >
        <div className="flex items-center gap-2 flex-1">
          {currentCountry && (
            <span className="text-sm font-mono bg-gray-100 px-1 rounded">
              {currentCountry.code}
            </span>
          )}
          <span className="truncate">{selectedCountryName}</span>
        </div>
        <ChevronDown className="w-4 h-4 text-gray-500" />
      </Button>
      
      {/* Dropdown */}
      {isOpen && (
        <div 
          className="absolute z-[9999]"
          style={{
            width: buttonRef.current ? Math.max(buttonRef.current.offsetWidth, 250) + 'px' : '250px',
            ...(dropdownPosition === 'top' 
              ? { bottom: '100%', marginBottom: '2px' }
              : { top: '100%', marginTop: '2px' })
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-white rounded-md shadow-lg border border-gray-200 overflow-hidden w-full">
            {/* Search Input */}
            <div className="p-2 border-b border-gray-200">
              <div className="relative">
                <Input
                  ref={searchInputRef}
                  data-automation-id={dataAutomationId ? `${dataAutomationId}-search` : undefined}
                  type="text"
                  placeholder="Search countries..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full px-3 py-2 pl-9 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-primary-500))] focus:border-transparent"
                  autoComplete="off"
                />
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-gray-400" />
              </div>
            </div>
            
            {/* Country List */}
            <div className="overflow-y-auto p-1" style={{
              maxHeight: dropdownPosition === 'bottom' ? '200px' : '250px'
            }}>
              {filteredCountries.map((country, index) => {
                const isCommon = COMMON_COUNTRIES.includes(country.code);
                const isFirstOther = !isCommon && index > 0 && COMMON_COUNTRIES.includes(filteredCountries[index - 1]?.code);

                return (
                  <div key={country.code}>
                    {isFirstOther && (
                      <div className="px-3 py-1 text-xs font-medium text-gray-500 bg-gray-50 border-t border-gray-200">
                        Other Countries
                      </div>
                    )}
                    <div
                      className="relative flex items-center gap-2 px-3 py-2 text-sm rounded cursor-pointer hover:bg-gray-100 focus:bg-gray-100 text-gray-900"
                      onClick={(e) => handleSelectCountry(country, e)}
                    >
                      <span className="text-base">{getCountryFlag(country.code)}</span>
                      <span className="flex-1 truncate">{country.name}</span>
                      <span className="text-xs font-mono bg-gray-100 px-1 rounded ml-2">
                        {country.code}
                      </span>
                    </div>
                  </div>
                );
              })}

              {filteredCountries.length === 0 && searchQuery && (
                <div className="px-3 py-2 text-sm text-gray-500">No countries found</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CountryPicker;