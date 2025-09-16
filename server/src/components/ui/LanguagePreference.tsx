'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { LOCALE_CONFIG, type SupportedLocale } from '@/lib/i18n/config';
import { useI18n } from '@/lib/i18n/client';
import CustomSelect, { SelectOption } from './CustomSelect';

interface LanguagePreferenceProps {
  /** Current selected locale */
  value?: SupportedLocale;
  /** Callback when language changes */
  onChange?: (locale: SupportedLocale) => Promise<void> | void;
  /** Label for the field */
  label?: string;
  /** Helper text below the field */
  helperText?: string;
  /** Whether the field is disabled */
  disabled?: boolean;
  /** Whether to show the field as loading */
  loading?: boolean;
  /** CSS classes for the container */
  className?: string;
  /** ID for automation */
  id?: string;
}

export function LanguagePreference({
  value,
  onChange,
  label = 'Language Preference',
  helperText = 'Select your preferred language for the interface',
  disabled = false,
  loading = false,
  className = '',
  id = 'language-preference',
}: LanguagePreferenceProps) {
  const { locale: currentLocale, setLocale } = useI18n();
  const [selectedLocale, setSelectedLocale] = useState<SupportedLocale>(
    value || currentLocale || (LOCALE_CONFIG.defaultLocale as SupportedLocale)
  );
  const [isChanging, setIsChanging] = useState(false);

  // Convert locale config to SelectOption format
  const languageOptions = useMemo((): SelectOption[] => {
    return LOCALE_CONFIG.supportedLocales.map((locale) => ({
      value: locale,
      label: `${LOCALE_CONFIG.localeNames[locale]} (${locale.toUpperCase()})`,
    }));
  }, []);

  useEffect(() => {
    if (value) {
      setSelectedLocale(value);
    }
  }, [value]);

  const handleChange = async (newValue: string) => {
    const newLocale = newValue as SupportedLocale;

    if (newLocale === selectedLocale) return;

    setSelectedLocale(newLocale);
    setIsChanging(true);

    try {
      // Update the global locale
      await setLocale(newLocale);

      // Call the onChange callback if provided
      if (onChange) {
        await onChange(newLocale);
      }
    } catch (error) {
      console.error('Failed to update language preference:', error);
      // Revert on error
      setSelectedLocale(selectedLocale);
    } finally {
      setIsChanging(false);
    }
  };

  return (
    <div className={className}>
      {helperText && !label && (
        <p className="mb-1 text-sm text-gray-500">{helperText}</p>
      )}
      <CustomSelect
        id={id}
        label={label}
        options={languageOptions}
        value={selectedLocale}
        onValueChange={handleChange}
        disabled={disabled || loading || isChanging}
        placeholder="Select a language"
        data-automation-id={`${id}-select`}
      />
      {helperText && label && (
        <p className="mt-1 text-sm text-gray-500">{helperText}</p>
      )}
      {isChanging && (
        <p className="mt-2 text-sm text-gray-500">Updating language preference...</p>
      )}
    </div>
  );
}