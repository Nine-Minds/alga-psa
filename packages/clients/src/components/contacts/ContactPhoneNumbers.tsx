'use client';

import React, { useState, useCallback } from 'react';
import { PhoneInput } from '@alga-psa/ui/components/PhoneInput';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Button } from '@alga-psa/ui/components/Button';
import { Plus, Star, Trash2 } from 'lucide-react';
import type { IContactPhoneNumber, PhoneNumberType } from '@alga-psa/types';
import type { ICountry } from '@alga-psa/clients/actions';

const PHONE_TYPES: PhoneNumberType[] = ['Office', 'Mobile', 'Home', 'Fax', 'Other'];

/**
 * Builds the initial phone numbers array for a contact.
 * If phone_numbers records exist, use them. Otherwise, fall back to the
 * legacy contacts.phone_number field so the existing number is displayed.
 */
export function buildInitialPhoneNumbers(
  contact: { contact_name_id?: string; phone_number?: string | null; phone_numbers?: IContactPhoneNumber[] }
): IContactPhoneNumber[] {
  // If we have phone_numbers records, use them
  if (contact.phone_numbers && contact.phone_numbers.length > 0) {
    return contact.phone_numbers;
  }

  // Fall back to legacy phone_number field
  const legacyPhone = contact.phone_number?.trim();
  if (legacyPhone) {
    return [{
      phone_number_id: `legacy-${contact.contact_name_id || Date.now()}`,
      contact_id: contact.contact_name_id || '',
      phone_type: 'Office',
      phone_number: legacyPhone,
      extension: null,
      country_code: null,
      is_primary: true,
      created_at: '',
      updated_at: ''
    }];
  }

  return [];
}

const PHONE_TYPE_OPTIONS = PHONE_TYPES.map(type => ({
  value: type,
  label: type
}));

interface ContactPhoneNumbersProps {
  contactId: string;
  phoneNumbers: IContactPhoneNumber[];
  countries: ICountry[];
  onChange: (phoneNumbers: IContactPhoneNumber[]) => void;
  disabled?: boolean;
  compact?: boolean;
}

/**
 * Controlled component for managing multiple phone numbers per contact.
 * Renders stacked phone entries under the existing "Phone Number" label.
 */
const ContactPhoneNumbers: React.FC<ContactPhoneNumbersProps> = ({
  contactId,
  phoneNumbers,
  countries,
  onChange,
  disabled = false,
  compact = false
}) => {
  // Track country codes per phone number (keyed by index since temp IDs may change)
  const [countryCodes, setCountryCodes] = useState<Record<string, string>>(() => {
    const codes: Record<string, string> = {};
    phoneNumbers.forEach(pn => {
      codes[pn.phone_number_id] = pn.country_code || getDefaultCountry();
    });
    return codes;
  });

  function getDefaultCountry(): string {
    try {
      const locale = Intl.DateTimeFormat().resolvedOptions().locale;
      const parts = locale.split('-');
      const detectedCountry = parts[parts.length - 1]?.toUpperCase();
      if (detectedCountry && detectedCountry.length === 2 && /^[A-Z]{2}$/.test(detectedCountry)) {
        return detectedCountry;
      }
    } catch {
      // fallback
    }
    return 'US';
  }

  const getNextAvailableType = useCallback((): PhoneNumberType => {
    const usedTypes = new Set(phoneNumbers.map(pn => pn.phone_type));
    for (const type of PHONE_TYPES) {
      if (!usedTypes.has(type)) return type;
    }
    return 'Other';
  }, [phoneNumbers]);

  const getAvailableTypeOptions = useCallback((currentType: PhoneNumberType) => {
    const usedTypes = new Set(phoneNumbers.map(pn => pn.phone_type));
    return PHONE_TYPE_OPTIONS.filter(
      opt => opt.value === currentType || !usedTypes.has(opt.value as PhoneNumberType)
    );
  }, [phoneNumbers]);

  const handlePhoneChange = (index: number, field: keyof IContactPhoneNumber, value: any) => {
    const updated = phoneNumbers.map((pn, i) => {
      if (i !== index) return pn;
      return { ...pn, [field]: value };
    });
    onChange(updated);
  };

  const handleSetPrimary = (index: number) => {
    if (phoneNumbers.length <= 1) return; // Already primary if only one
    const updated = phoneNumbers.map((pn, i) => ({
      ...pn,
      is_primary: i === index
    }));
    onChange(updated);
  };

  const handleDelete = (index: number) => {
    if (phoneNumbers.length <= 1) return; // Cannot delete last number
    const deleted = phoneNumbers[index];
    let updated = phoneNumbers.filter((_, i) => i !== index);

    // If we deleted the primary, make the first remaining one primary
    if (deleted.is_primary && updated.length > 0) {
      updated = updated.map((pn, i) => ({
        ...pn,
        is_primary: i === 0
      }));
    }

    onChange(updated);
  };

  const handleAdd = () => {
    if (phoneNumbers.length >= PHONE_TYPES.length) return; // Max reached

    const newPhone: IContactPhoneNumber = {
      phone_number_id: `temp-${Date.now()}`,
      contact_id: contactId,
      phone_type: getNextAvailableType(),
      phone_number: '',
      extension: null,
      country_code: getDefaultCountry(),
      is_primary: phoneNumbers.length === 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    setCountryCodes(prev => ({
      ...prev,
      [newPhone.phone_number_id]: newPhone.country_code || getDefaultCountry()
    }));

    onChange([...phoneNumbers, newPhone]);
  };

  const handleCountryChange = (phoneNumberId: string, countryCode: string) => {
    setCountryCodes(prev => ({ ...prev, [phoneNumberId]: countryCode }));
    // Update the country_code on the phone number record
    const updated = phoneNumbers.map(pn => {
      if (pn.phone_number_id !== phoneNumberId) return pn;
      return { ...pn, country_code: countryCode };
    });
    onChange(updated);
  };

  return (
    <div className="space-y-2">
      {phoneNumbers.map((pn, index) => {
        const countryCode = countryCodes[pn.phone_number_id] || pn.country_code || getDefaultCountry();
        const phoneCode = countries.find(c => c.code === countryCode)?.phone_code;

        return (
          <div
            key={pn.phone_number_id}
            className="space-y-1"
          >
            {/* Type selector row - only show when multiple numbers */}
            {phoneNumbers.length > 1 && (
              <div className="flex items-center gap-1">
                <div className={compact ? 'w-[80px]' : 'w-[100px]'}>
                  <CustomSelect
                    id={`phone-type-${contactId}-${index}`}
                    value={pn.phone_type}
                    onValueChange={(value) => handlePhoneChange(index, 'phone_type', value)}
                    options={getAvailableTypeOptions(pn.phone_type)}
                    disabled={disabled}
                  />
                </div>
                {/* Primary Star Toggle */}
                {!compact && (
                  <button
                    id={`phone-primary-${contactId}-${index}`}
                    type="button"
                    onClick={() => handleSetPrimary(index)}
                    disabled={disabled}
                    className={`p-1 rounded-md transition-colors ${
                      pn.is_primary
                        ? 'text-yellow-500'
                        : 'text-gray-300 hover:text-yellow-400'
                    } ${disabled ? 'cursor-default' : 'cursor-pointer'}`}
                    title={pn.is_primary ? 'Primary number' : 'Set as primary'}
                  >
                    <Star
                      className="h-3.5 w-3.5"
                      fill={pn.is_primary ? 'currentColor' : 'none'}
                    />
                  </button>
                )}
                {/* Delete Button */}
                <button
                  id={`phone-delete-${contactId}-${index}`}
                  type="button"
                  onClick={() => handleDelete(index)}
                  disabled={disabled}
                  className="p-1 rounded-md transition-colors text-gray-400 hover:text-red-500 cursor-pointer"
                  title="Remove phone number"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Phone Number Input - always same width */}
            <PhoneInput
              id={`phone-${pn.phone_number_id}`}
              value={pn.phone_number}
              onChange={(value) => handlePhoneChange(index, 'phone_number', value)}
              countryCode={countryCode}
              phoneCode={phoneCode}
              countries={countries}
              onCountryChange={(code) => handleCountryChange(pn.phone_number_id, code)}
              allowExtensions={!compact}
              disabled={disabled}
              data-automation-id={`contact-phone-${index}`}
            />
          </div>
        );
      })}

      {/* Add Number Button */}
      {phoneNumbers.length < PHONE_TYPES.length && (
        <Button
          id={`add-phone-${contactId}`}
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleAdd}
          disabled={disabled}
          className="text-sm text-gray-500 hover:text-gray-700 pl-0"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Number
        </Button>
      )}
    </div>
  );
};

export default ContactPhoneNumbers;
