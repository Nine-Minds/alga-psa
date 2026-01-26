/**
 * MSP Admin Component for Configuring Client Portal Language Settings
 * This component allows MSP admins to configure the default language for their client portal
 */

'use client';

import React, { useState, useEffect } from 'react';
import { LOCALE_CONFIG, type SupportedLocale } from './config';
import { Checkbox } from '../../components/Checkbox';

interface ClientPortalLanguageConfigProps {
  /** Current tenant ID */
  tenantId: string;
  /** Current default locale for the client portal */
  currentDefaultLocale?: SupportedLocale;
  /** Callback when settings are saved */
  onSave?: (locale: SupportedLocale) => void;
  /** Additional CSS classes */
  className?: string;
}

export function ClientPortalLanguageConfig({
  tenantId,
  currentDefaultLocale = LOCALE_CONFIG.defaultLocale as SupportedLocale,
  onSave,
  className = '',
}: ClientPortalLanguageConfigProps) {
  const [selectedLocale, setSelectedLocale] = useState<SupportedLocale>(currentDefaultLocale);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [enabledLocales, setEnabledLocales] = useState<Set<SupportedLocale>>(
    new Set(LOCALE_CONFIG.supportedLocales)
  );

  useEffect(() => {
    setSelectedLocale(currentDefaultLocale);
  }, [currentDefaultLocale]);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveStatus('idle');

    try {
      const response = await fetch('/api/tenant/settings', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_portal_settings: {
            defaultLocale: selectedLocale,
            enabledLocales: Array.from(enabledLocales),
          },
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save settings');
      }

      setSaveStatus('success');
      onSave?.(selectedLocale);

      // Clear success message after 3 seconds
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (error) {
      console.error('Error saving language settings:', error);
      setSaveStatus('error');

      // Clear error message after 5 seconds
      setTimeout(() => setSaveStatus('idle'), 5000);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleLocale = (locale: SupportedLocale) => {
    // Don't allow disabling the default locale
    if (locale === selectedLocale) return;

    const newEnabledLocales = new Set(enabledLocales);
    if (newEnabledLocales.has(locale)) {
      newEnabledLocales.delete(locale);
    } else {
      newEnabledLocales.add(locale);
    }
    setEnabledLocales(newEnabledLocales);
  };

  const hasChanges =
    selectedLocale !== currentDefaultLocale ||
    enabledLocales.size !== LOCALE_CONFIG.supportedLocales.length ||
    !LOCALE_CONFIG.supportedLocales.every((loc) => enabledLocales.has(loc));

  return (
    <div className={`space-y-6 ${className}`}>
      <div>
        <h3 className="text-lg font-medium text-gray-900">
          Client Portal Language Settings
        </h3>
        <p className="mt-1 text-sm text-gray-600">
          Configure the language options available to your clients
        </p>
      </div>

      <div className="space-y-4">
        {/* Default Language Selection */}
        <div>
          <label
            htmlFor="default-locale"
            className="block text-sm font-medium text-gray-700"
          >
            Default Language
          </label>
          <p className="mt-1 text-sm text-gray-500">
            This language will be used for new clients and when no preference is set
          </p>
          <select
            id="default-locale"
            className="mt-2 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            value={selectedLocale}
            onChange={(e) => {
              const newLocale = e.target.value as SupportedLocale;
              setSelectedLocale(newLocale);
              // Ensure the default locale is always enabled
              if (!enabledLocales.has(newLocale)) {
                const newEnabledLocales = new Set(enabledLocales);
                newEnabledLocales.add(newLocale);
                setEnabledLocales(newEnabledLocales);
              }
            }}
            disabled={isSaving}
          >
            {LOCALE_CONFIG.supportedLocales.map((locale) => (
              <option key={locale} value={locale}>
                {LOCALE_CONFIG.localeNames[locale]} ({locale})
              </option>
            ))}
          </select>
        </div>

        {/* Available Languages */}
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Available Languages
          </label>
          <p className="mt-1 text-sm text-gray-500">
            Select which languages clients can choose from
          </p>
          <div className="mt-2 space-y-2">
            {LOCALE_CONFIG.supportedLocales.map((locale) => (
              <div
                key={locale}
                className="flex items-center space-x-3"
              >
                <div className="[&>div]:mb-0">
                  <Checkbox
                    id={`locale-${locale}`}
                    label={
                      <span className="text-sm text-gray-700">
                        {LOCALE_CONFIG.localeNames[locale]} ({locale})
                        {locale === selectedLocale && (
                          <span className="ml-2 text-xs text-gray-500">(default)</span>
                        )}
                      </span>
                    }
                    checked={enabledLocales.has(locale)}
                    onChange={() => toggleLocale(locale)}
                    disabled={isSaving || locale === selectedLocale}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Preview */}
        <div className="p-4 bg-gray-50 rounded-lg">
          <h4 className="text-sm font-medium text-gray-700 mb-2">Preview</h4>
          <div className="text-sm text-gray-600">
            <p>Default language: <strong>{LOCALE_CONFIG.localeNames[selectedLocale]}</strong></p>
            <p>Available languages: <strong>{Array.from(enabledLocales).map(loc => LOCALE_CONFIG.localeNames[loc]).join(', ')}</strong></p>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {saveStatus === 'success' && (
              <span className="text-sm text-green-600 flex items-center">
                <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                Settings saved successfully
              </span>
            )}
            {saveStatus === 'error' && (
              <span className="text-sm text-red-600 flex items-center">
                <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
                Failed to save settings
              </span>
            )}
          </div>
          <button
            type="button"
            className={`px-4 py-2 text-sm font-medium text-white rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 ${
              hasChanges && !isSaving
                ? 'bg-indigo-600 hover:bg-indigo-700'
                : 'bg-gray-400 cursor-not-allowed'
            }`}
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
          >
            {isSaving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}