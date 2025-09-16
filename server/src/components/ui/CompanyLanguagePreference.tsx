'use client';

import React, { useState, useEffect } from 'react';
import { LanguagePreference } from './LanguagePreference';
import { SupportedLocale } from '@/lib/i18n/config';
import { updateCompanyLocaleAction, getCompanyLocaleAction } from '@/lib/actions/company-actions/companyLocaleActions';
import { toast } from 'react-hot-toast';

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

export function CompanyLanguagePreference({
  companyId,
  companyName,
  showCard = true,
  className = '',
  onSave,
}: CompanyLanguagePreferenceProps) {
  const [currentLocale, setCurrentLocale] = useState<SupportedLocale | undefined>();
  const [loading, setLoading] = useState(true);

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

  const handleLanguageChange = async (locale: SupportedLocale) => {
    try {
      await updateCompanyLocaleAction(companyId, locale);
      setCurrentLocale(locale);
      toast.success(`Default language for ${companyName || 'company'} updated to ${locale.toUpperCase()}`);
      onSave?.(locale);
    } catch (error) {
      console.error('Failed to update company language preference:', error);
      toast.error('Failed to update company language preference');
      throw error; // Re-throw to let LanguagePreference handle reverting
    }
  };

  if (showCard) {
    return (
      <div className={`bg-white rounded-lg border border-gray-200 p-6 ${className}`}>
        <h3 className="text-lg font-medium text-gray-900 mb-2">
          Company Language Settings
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          Set the default language for all contacts in {companyName || 'this company'}.
          Individual users can override this in their personal settings.
        </p>
        <LanguagePreference
          value={currentLocale}
          onChange={handleLanguageChange}
          label="Default Language for All Contacts"
          helperText="This will be the default language for new contacts and those without a personal preference"
          loading={loading}
          id={`company-${companyId}-language`}
        />
      </div>
    );
  }

  return (
    <LanguagePreference
      value={currentLocale}
      onChange={handleLanguageChange}
      label="Company Default Language"
      helperText={`Default language for all contacts in ${companyName || 'this company'}`}
      loading={loading}
      className={className}
      id={`company-${companyId}-language`}
    />
  );
}