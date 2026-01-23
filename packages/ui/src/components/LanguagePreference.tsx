'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { LOCALE_CONFIG, type SupportedLocale } from '../lib/i18n/config';
import { useI18n, useTranslation } from '../lib/i18n/client';
import CustomSelect, { SelectOption } from './CustomSelect';
import { toast } from 'react-hot-toast';

interface LanguagePreferenceProps {
  /** Current selected locale */
  value?: SupportedLocale | null;
  /** Callback when language changes */
  onChange?: (locale: SupportedLocale | null) => Promise<void> | void;
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
  /** Whether to show "None" option for unsetting preference */
  showNoneOption?: boolean;
  /** Current effective locale (what's actually being used) */
  currentEffectiveLocale?: SupportedLocale;
  /** Where the inherited locale comes from */
  inheritedSource?: 'client' | 'tenant' | 'system';
}

export function LanguagePreference({
  value,
  onChange,
  label,
  helperText,
  disabled = false,
  loading = false,
  className = '',
  id = 'language-preference',
  showNoneOption = true,
  currentEffectiveLocale,
  inheritedSource = 'system',
}: LanguagePreferenceProps) {
  const { locale: currentLocale, setLocale } = useI18n();
  const { t } = useTranslation('common');
  const fieldLabel = label ?? t('language.preference.label', 'Language Preference');
  const fieldHelperText = helperText ?? t('language.preference.helper', 'Select your preferred language for the interface and email notifications');
  const effectiveLocale = currentEffectiveLocale || currentLocale;
  const [selectedLocale, setSelectedLocale] = useState<SupportedLocale | 'none'>(
    value === null || value === undefined ? 'none' : value
  );
  const [isChanging, setIsChanging] = useState(false);

  // Convert locale config to SelectOption format
  const languageOptions = useMemo((): SelectOption[] => {
    const options: SelectOption[] = [];

    // Add "None" option if enabled
    if (showNoneOption) {
      let inheritedLabel = t('language.preference.notSet', 'Not set');
      if (currentEffectiveLocale) {
        const sourceKey =
          inheritedSource === 'client'
            ? 'language.preference.source.client'
            : inheritedSource === 'tenant'
            ? 'language.preference.source.tenant'
            : 'language.preference.source.system';
        const sourceText = t(sourceKey, inheritedSource === 'client' ? 'client default' : inheritedSource === 'tenant' ? 'tenant default' : 'system default');
        inheritedLabel = t(
          'language.preference.notSetWithSource',
          'Not set (Uses {{source}}: {{languageName}} - {{locale}})',
          {
            source: sourceText,
            languageName: LOCALE_CONFIG.localeNames[currentEffectiveLocale],
            locale: currentEffectiveLocale.toUpperCase(),
          }
        );
      }
      options.push({
        value: 'none',
        label: inheritedLabel,
      });
    }

    // Add supported locales
    LOCALE_CONFIG.supportedLocales.forEach((locale) => {
      options.push({
        value: locale,
        label: `${LOCALE_CONFIG.localeNames[locale]} (${locale.toUpperCase()})`,
      });
    });

    return options;
  }, [showNoneOption, currentEffectiveLocale, inheritedSource, t]);

  useEffect(() => {
    if (value !== undefined) {
      setSelectedLocale(value === null ? 'none' : value);
    }
  }, [value]);

  const handleChange = async (newValue: string) => {
    if (newValue === selectedLocale) return;

    const previousValue = selectedLocale;
    setSelectedLocale(newValue as SupportedLocale | 'none');
    setIsChanging(true);

    try {
      if (newValue === 'none') {
        // User is unsetting their preference
        // Clear the preference first
        if (onChange) {
          await onChange(null);
        }
        // Show a message and reload to get the inherited locale
        toast.success(t('language.preference.cleared', 'Language preference cleared. Using default language...'));
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      } else {
        // User is setting a specific locale
        const newLocale = newValue as SupportedLocale;

        // Update the global locale
        await setLocale(newLocale);

        // Call the onChange callback if provided
        if (onChange) {
          await onChange(newLocale);
        }
      }
    } catch (error) {
      console.error('Failed to update language preference:', error);
      // Revert on error
      setSelectedLocale(previousValue);
    } finally {
      setIsChanging(false);
    }
  };

  return (
    <div className={className}>
      {fieldHelperText && !fieldLabel && (
        <p className="mb-1 text-sm text-gray-500">{fieldHelperText}</p>
      )}
      <CustomSelect
        id={id}
        label={fieldLabel}
        options={languageOptions}
        value={selectedLocale}
        onValueChange={handleChange}
        disabled={disabled || loading || isChanging}
        placeholder={t('language.preference.placeholder', 'Select a language')}
        data-automation-id={`${id}-select`}
      />
      {fieldHelperText && fieldLabel && (
        <p className="mt-1 text-sm text-gray-500">{fieldHelperText}</p>
      )}
      {isChanging && (
        <p className="mt-2 text-sm text-gray-500">{t('language.preference.updating', 'Updating language preference...')}</p>
      )}
    </div>
  );
}
