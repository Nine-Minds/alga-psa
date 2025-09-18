'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { LOCALE_CONFIG, type SupportedLocale } from '@/lib/i18n/config';
import { updateCompanyLocaleAction, getCompanyLocaleAction } from '@/lib/actions/company-actions/companyLocaleActions';
import { toast } from 'react-hot-toast';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';

interface CompanyLanguagePreferenceProps {
  /** Company ID */
  companyId: string;
  /** Company name for display */
  companyName?: string;
  /** Whether to show as a card with title */
  showCard?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Callback after successful save */
  onSave?: (locale: SupportedLocale) => void;
}

/**
 * Language preference component for admin pages (without i18n dependency)
 * This sets the default language for all contacts from a company
 */
export function CompanyLanguagePreference({
  companyId,
  companyName,
  showCard = false,
  className = '',
  onSave,
}: CompanyLanguagePreferenceProps) {
  const [currentLocale, setCurrentLocale] = useState<SupportedLocale | undefined>();
  const [loading, setLoading] = useState(true);
  const [isChanging, setIsChanging] = useState(false);

  // Convert locale config to SelectOption format
  const languageOptions = useMemo((): SelectOption[] => {
    return LOCALE_CONFIG.supportedLocales.map((locale) => ({
      value: locale,
      label: `${LOCALE_CONFIG.localeNames[locale]} (${locale.toUpperCase()})`,
    }));
  }, []);

  useEffect(() => {
    const loadCompanyLocale = async () => {
      try {
        const locale = await getCompanyLocaleAction(companyId);
        if (locale) {
          setCurrentLocale(locale);
        }
      } catch (error) {
        console.error('Failed to load company language preference:', error);
      } finally {
        setLoading(false);
      }
    };

    loadCompanyLocale();
  }, [companyId]);

  const handleLanguageChange = async (newLocale: string) => {
    const locale = newLocale as SupportedLocale;

    if (locale === currentLocale) return;

    setIsChanging(true);
    try {
      await updateCompanyLocaleAction(companyId, locale);
      setCurrentLocale(locale);
      toast.success(`Default language for ${companyName || 'company'} contacts updated to ${LOCALE_CONFIG.localeNames[locale]}`);
      onSave?.(locale);
    } catch (error) {
      console.error('Failed to update company language preference:', error);
      toast.error('Failed to update company language preference');
    } finally {
      setIsChanging(false);
    }
  };

  const content = (
    <div className={className}>
      <CustomSelect
        id={`company-${companyId}-language`}
        label="Default Language for Contacts"
        options={languageOptions}
        value={currentLocale || ''}
        onValueChange={handleLanguageChange}
        disabled={loading || isChanging}
        placeholder="Select a language"
        data-automation-id={`company-${companyId}-language-select`}
      />
      <p className="mt-1 text-sm text-gray-500">
        This will be the default language for all contacts from {companyName || 'this company'}.
        Individual users can override this in their personal settings.
      </p>
      {isChanging && (
        <p className="mt-2 text-sm text-gray-500">Updating language preference...</p>
      )}
    </div>
  );

  if (showCard) {
    return (
      <div className={`bg-white rounded-lg border border-gray-200 p-6 ${className}`}>
        <h3 className="text-lg font-medium text-gray-900 mb-2">
          Company Language Settings
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          Set the default language for all contacts in {companyName || 'this company'}.
        </p>
        {content}
      </div>
    );
  }

  return content;
}