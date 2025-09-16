'use client';

import React, { useState, useEffect } from 'react';
import { LanguagePreference } from './LanguagePreference';
import { SupportedLocale, LOCALE_CONFIG } from '@/lib/i18n/config';
import { updateTenantDefaultLocaleAction, getTenantLocaleSettingsAction } from '@/lib/actions/tenant-actions/tenantLocaleActions';
import { toast } from 'react-hot-toast';
import CustomSelect, { SelectOption } from './CustomSelect';

interface TenantLanguagePreferenceProps {
  /** Whether to show as a card with title */
  showCard?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Callback after successful save */
  onSave?: (locale: SupportedLocale) => void;
  /** Whether to show enabled languages selector */
  showEnabledLanguages?: boolean;
}

export function TenantLanguagePreference({
  showCard = true,
  className = '',
  onSave,
  showEnabledLanguages = true,
}: TenantLanguagePreferenceProps) {
  const [defaultLocale, setDefaultLocale] = useState<SupportedLocale>(LOCALE_CONFIG.defaultLocale as SupportedLocale);
  const [enabledLocales, setEnabledLocales] = useState<SupportedLocale[]>([...LOCALE_CONFIG.supportedLocales]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadTenantSettings = async () => {
      try {
        const settings = await getTenantLocaleSettingsAction();
        if (settings) {
          setDefaultLocale(settings.defaultLocale);
          setEnabledLocales(settings.enabledLocales);
        }
      } catch (error) {
        console.error('Failed to load tenant language settings:', error);
      } finally {
        setLoading(false);
      }
    };

    loadTenantSettings();
  }, []);

  const handleDefaultLanguageChange = async (locale: SupportedLocale) => {
    setSaving(true);
    try {
      // Ensure the default locale is in the enabled list
      const updatedEnabledLocales = enabledLocales.includes(locale)
        ? enabledLocales
        : [...enabledLocales, locale];

      await updateTenantDefaultLocaleAction(locale, updatedEnabledLocales);
      setDefaultLocale(locale);
      setEnabledLocales(updatedEnabledLocales);
      toast.success(`Tenant default language updated to ${LOCALE_CONFIG.localeNames[locale]}`);
      onSave?.(locale);
    } catch (error) {
      console.error('Failed to update tenant language settings:', error);
      toast.error('Failed to update tenant language settings');
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const handleEnabledLanguagesChange = async (selectedLocales: SupportedLocale[]) => {
    // Ensure default locale is always included
    if (!selectedLocales.includes(defaultLocale)) {
      selectedLocales.push(defaultLocale);
    }

    setSaving(true);
    try {
      await updateTenantDefaultLocaleAction(defaultLocale, selectedLocales);
      setEnabledLocales(selectedLocales);
      toast.success('Available languages updated');
    } catch (error) {
      console.error('Failed to update enabled languages:', error);
      toast.error('Failed to update available languages');
    } finally {
      setSaving(false);
    }
  };

  const content = (
    <>
      <LanguagePreference
        value={defaultLocale}
        onChange={handleDefaultLanguageChange}
        label="Tenant Default Language"
        helperText="This will be the default language for all users and companies unless overridden"
        loading={loading || saving}
        id="tenant-default-language"
      />

      {showEnabledLanguages && (
        <div className="mt-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Available Languages
          </label>
          <p className="text-sm text-gray-500 mb-2">
            Select which languages are available for users to choose from
          </p>
          <div className="space-y-2">
            {LOCALE_CONFIG.supportedLocales.map((locale) => (
              <label
                key={locale}
                className="flex items-center space-x-3 cursor-pointer"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                  checked={enabledLocales.includes(locale)}
                  disabled={locale === defaultLocale || loading || saving}
                  onChange={(e) => {
                    if (e.target.checked) {
                      handleEnabledLanguagesChange([...enabledLocales, locale]);
                    } else {
                      handleEnabledLanguagesChange(enabledLocales.filter(l => l !== locale));
                    }
                  }}
                />
                <span className={`text-sm ${locale === defaultLocale ? 'font-medium' : ''}`}>
                  {LOCALE_CONFIG.localeNames[locale]} ({locale.toUpperCase()})
                  {locale === defaultLocale && (
                    <span className="ml-2 text-xs text-gray-500">(default)</span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 p-4 bg-blue-50 rounded-lg">
        <h4 className="text-sm font-medium text-blue-900 mb-2">Language Preference Hierarchy</h4>
        <ol className="text-sm text-blue-700 space-y-1 list-decimal list-inside">
          <li>Individual user preference (highest priority)</li>
          <li>Company default language</li>
          <li>Tenant default language (configured here)</li>
          <li>Browser language preference</li>
          <li>System default (English)</li>
        </ol>
      </div>
    </>
  );

  if (showCard) {
    return (
      <div className={`bg-white rounded-lg border border-gray-200 p-6 ${className}`}>
        <h3 className="text-lg font-medium text-gray-900 mb-2">
          Tenant Language Settings
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          Configure the default language settings for your entire tenant.
          These settings apply to all users and companies unless overridden.
        </p>
        {content}
      </div>
    );
  }

  return <div className={className}>{content}</div>;
}