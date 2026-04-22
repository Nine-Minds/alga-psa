'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { LanguageHierarchyTable } from '@alga-psa/ui/components/LanguageHierarchyTable';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { Globe } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { LOCALE_CONFIG, filterPseudoLocales, type SupportedLocale } from '@alga-psa/core/i18n/config';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import {
  getTenantLocaleSettingsAction,
  updateTenantDefaultLocaleAction,
} from '@alga-psa/tenancy/actions';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

const MspLanguageSettings = () => {
  const { t } = useTranslation('msp/settings');
  const { enabled: isMspI18nEnabled } = useFeatureFlag('msp-i18n-enabled', { defaultValue: false });
  const visibleLocales = useMemo(
    () => filterPseudoLocales(LOCALE_CONFIG.supportedLocales, !!isMspI18nEnabled),
    [isMspI18nEnabled],
  );
  const [defaultLocale, setDefaultLocale] = useState<SupportedLocale>(
    LOCALE_CONFIG.defaultLocale as SupportedLocale
  );
  const [enabledLocales, setEnabledLocales] = useState<SupportedLocale[]>([
    ...LOCALE_CONFIG.supportedLocales,
  ]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const languageOptions = useMemo((): SelectOption[] => {
    return visibleLocales.map((locale) => ({
      value: locale,
      label: `${LOCALE_CONFIG.localeNames[locale]} (${locale.toUpperCase()})`,
    }));
  }, [visibleLocales]);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const localeSettings = await getTenantLocaleSettingsAction();
        if (localeSettings) {
          setDefaultLocale(localeSettings.defaultLocale);
          setEnabledLocales(localeSettings.enabledLocales);
        }
      } catch (error) {
        console.error('Failed to load organization language settings:', error);
      } finally {
        setLoading(false);
      }
    };

    loadSettings();
  }, []);

  const handleDefaultLanguageChange = async (newLocale: string) => {
    const locale = newLocale as SupportedLocale;
    if (locale === defaultLocale) return;

    setSaving(true);
    try {
      const updatedEnabledLocales = enabledLocales.includes(locale)
        ? enabledLocales
        : [...enabledLocales, locale];

      await updateTenantDefaultLocaleAction(locale, updatedEnabledLocales);
      setDefaultLocale(locale);
      setEnabledLocales(updatedEnabledLocales);
      toast.success(`Organization default language updated to ${LOCALE_CONFIG.localeNames[locale]}`);
    } catch (error) {
      handleError(error, 'Failed to update organization language settings');
    } finally {
      setSaving(false);
    }
  };

  const handleEnabledLanguagesChange = async (selectedLocales: SupportedLocale[]) => {
    if (!selectedLocales.includes(defaultLocale)) {
      selectedLocales.push(defaultLocale);
    }

    setSaving(true);
    try {
      await updateTenantDefaultLocaleAction(defaultLocale, selectedLocales);
      setEnabledLocales(selectedLocales);
      toast.success('Available languages updated');
    } catch (error) {
      handleError(error, 'Failed to update available languages');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            {t('mspLanguage.title')}
          </div>
        </CardTitle>
        <CardDescription>
          {t('mspLanguage.description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          <div className="space-y-2">
            <CustomSelect
              id="msp-default-language"
              label={t('mspLanguage.fields.defaultLanguage')}
              options={languageOptions}
              value={defaultLocale}
              onValueChange={handleDefaultLanguageChange}
              disabled={loading || saving}
              placeholder="Select a language"
              data-automation-id="msp-default-language-select"
            />
            <p className="text-sm text-gray-500">
              {t('mspLanguage.help.defaultLanguage')}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {t('mspLanguage.fields.availableLanguages')}
            </label>
            <p className="text-sm text-gray-500 mb-2">
              {t('mspLanguage.help.availableLanguages')}
            </p>
            <div className="space-y-2">
              {visibleLocales.map((locale) => (
                <Checkbox
                  key={locale}
                  id={`msp-locale-${locale}`}
                  label={`${LOCALE_CONFIG.localeNames[locale]} (${locale.toUpperCase()})${locale === defaultLocale ? ' (default)' : ''}`}
                  checked={enabledLocales.includes(locale)}
                  disabled={locale === defaultLocale || loading || saving}
                  onChange={(e) => {
                    if (e.target.checked) {
                      handleEnabledLanguagesChange([...enabledLocales, locale]);
                    } else {
                      handleEnabledLanguagesChange(enabledLocales.filter((l) => l !== locale));
                    }
                  }}
                  className={locale === defaultLocale ? 'font-medium' : ''}
                />
              ))}
            </div>
          </div>

          <LanguageHierarchyTable />
        </div>
      </CardContent>
    </Card>
  );
};

export default MspLanguageSettings;
