'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { LOCALE_CONFIG, type SupportedLocale } from '@alga-psa/ui/lib/i18n/config';
import { updateClientLocaleAction, getClientLocaleAction } from '@alga-psa/clients/actions';
import { toast } from 'react-hot-toast';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';

interface ClientLanguagePreferenceProps {
  /** Client ID */
  clientId: string;
  /** Client name for display */
  clientName?: string;
  /** Whether to show as a card with title */
  showCard?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Callback after successful save */
  onSave?: (locale: SupportedLocale) => void;
}

/**
 * Language preference component for admin pages (without i18n dependency)
 * This sets the default language for all contacts from a client
 */
export function ClientLanguagePreference({
  clientId,
  clientName,
  showCard = false,
  className = '',
  onSave,
}: ClientLanguagePreferenceProps) {
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
    const loadClientLocale = async () => {
      try {
        const locale = await getClientLocaleAction(clientId);
        if (locale) {
          setCurrentLocale(locale);
        }
      } catch (error) {
        console.error('Failed to load client language preference:', error);
      } finally {
        setLoading(false);
      }
    };

    loadClientLocale();
  }, [clientId]);

  const handleLanguageChange = async (newLocale: string) => {
    const locale = newLocale as SupportedLocale;

    if (locale === currentLocale) return;

    setIsChanging(true);
    try {
      await updateClientLocaleAction(clientId, locale);
      setCurrentLocale(locale);
      toast.success(`Default language for ${clientName || 'client'} contacts updated to ${LOCALE_CONFIG.localeNames[locale]}`);
      onSave?.(locale);
    } catch (error) {
      console.error('Failed to update client language preference:', error);
      toast.error('Failed to update client language preference');
    } finally {
      setIsChanging(false);
    }
  };

  const content = (
    <div className={className}>
      <CustomSelect
        id={`client-${clientId}-language`}
        label="Default Language for Contacts"
        options={languageOptions}
        value={currentLocale || ''}
        onValueChange={handleLanguageChange}
        disabled={loading || isChanging}
        placeholder="Select a language"
        data-automation-id={`client-${clientId}-language-select`}
      />
      <p className="mt-1 text-sm text-gray-500">
        This will be the default language for all contacts from {clientName || 'this client'}.
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
          Client Language Settings
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          Set the default language for all contacts in {clientName || 'this client'}.
        </p>
        {content}
      </div>
    );
  }

  return content;
}
