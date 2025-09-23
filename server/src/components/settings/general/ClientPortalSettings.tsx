'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "server/src/components/ui/Card";
import { Badge } from 'server/src/components/ui/Badge';
import { Globe } from 'lucide-react';
import { LOCALE_CONFIG, type SupportedLocale } from '@/lib/i18n/config';
import { updateTenantDefaultLocaleAction, getTenantLocaleSettingsAction } from '@/lib/actions/tenant-actions/tenantLocaleActions';
import { toast } from 'react-hot-toast';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';
import { getPortalDomainStatusAction } from '@/lib/actions/tenant-actions/portalDomainActions';
import type { PortalDomainStatusResponse } from '@/lib/actions/tenant-actions/portalDomain.types';

const ClientPortalSettings = () => {
  const [defaultLocale, setDefaultLocale] = useState<SupportedLocale>(LOCALE_CONFIG.defaultLocale as SupportedLocale);
  const [enabledLocales, setEnabledLocales] = useState<SupportedLocale[]>([...LOCALE_CONFIG.supportedLocales]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [portalStatus, setPortalStatus] = useState<PortalDomainStatusResponse | null>(null);
  const [portalLoading, setPortalLoading] = useState(true);

  // Convert locale config to SelectOption format
  const languageOptions = useMemo((): SelectOption[] => {
    return LOCALE_CONFIG.supportedLocales.map((locale) => ({
      value: locale,
      label: `${LOCALE_CONFIG.localeNames[locale]} (${locale.toUpperCase()})`,
    }));
  }, []);

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

  useEffect(() => {
    const loadPortalStatus = async () => {
      setPortalLoading(true);
      try {
        const status = await getPortalDomainStatusAction();
        setPortalStatus(status);
      } catch (error) {
        console.error('Failed to load portal domain status:', error);
      } finally {
        setPortalLoading(false);
      }
    };

    loadPortalStatus();
  }, []);

  const handleDefaultLanguageChange = async (newLocale: string) => {
    const locale = newLocale as SupportedLocale;

    if (locale === defaultLocale) return;

    setSaving(true);
    try {
      // Ensure the default locale is in the enabled list
      const updatedEnabledLocales = enabledLocales.includes(locale)
        ? enabledLocales
        : [...enabledLocales, locale];

      await updateTenantDefaultLocaleAction(locale, updatedEnabledLocales);
      setDefaultLocale(locale);
      setEnabledLocales(updatedEnabledLocales);
      toast.success(`Client portal default language updated to ${LOCALE_CONFIG.localeNames[locale]}`);
    } catch (error) {
      console.error('Failed to update tenant language settings:', error);
      toast.error('Failed to update tenant language settings');
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

  return (
    <div className="space-y-6">
      {/* Custom Domain Card */}
      <Card>
        <CardHeader>
          <CardTitle>
            <div className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Custom Domain
              <Badge variant="secondary" className="uppercase text-[10px] tracking-wide">
                Enterprise
              </Badge>
            </div>
          </CardTitle>
          <CardDescription>
            Enterprise tenants can host the portal on a custom domain. Your default hosted address is shown below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-6">
              {portalLoading ? (
                <div className="h-5 w-48 animate-pulse rounded bg-gray-200" />
              ) : (
                <div className="space-y-3 text-center">
                  <div className="text-sm font-medium text-gray-600">Default portal address</div>
                  <code className="inline-block rounded bg-white px-3 py-1 text-sm text-gray-900 shadow-sm">
                    {portalStatus?.canonicalHost ?? '—'}
                  </code>
                  <p className="text-xs text-gray-500">
                    Upgrade to Enterprise to configure a branded customer portal domain and automated certificates.
                  </p>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Language Settings Card */}
      <Card>
        <CardHeader>
          <CardTitle>Language Settings</CardTitle>
          <CardDescription>
            Configure the default language settings for your client portal.
            These settings apply to all users and companies unless overridden.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div className="space-y-2">
              <CustomSelect
                id="tenant-default-language"
                label="Default Language"
                options={languageOptions}
                value={defaultLocale}
                onValueChange={handleDefaultLanguageChange}
                disabled={loading || saving}
                placeholder="Select a language"
                data-automation-id="tenant-default-language-select"
              />
              <p className="text-sm text-gray-500">
                This will be the default language for all client portal users unless overridden by company setting or individual user preferences
              </p>
            </div>

            <div>
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

            <div className="p-4 bg-blue-50 rounded-lg">
              <h4 className="text-sm font-medium text-blue-900 mb-2">Language Preference Hierarchy</h4>
              <ol className="text-sm text-blue-700 space-y-1 list-decimal list-inside">
                <li>Individual user preference (highest priority)</li>
                <li>Company default language</li>
                <li>Organization default (configured here)</li>
                <li>System default (English)</li>
              </ol>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Branding Settings Card */}
      <Card>
        <CardHeader>
          <CardTitle>Branding & Appearance (Coming Soon)</CardTitle>
          <CardDescription>
            Customize the look and feel of your client portal with your company branding.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-gray-50 rounded-lg p-6 text-center">
            <p className="text-gray-600 mb-2">Branding customization will be available in a future update.</p>
            <p className="text-sm text-gray-500">You'll be able to:</p>
            <ul className="text-sm text-gray-500 mt-2 space-y-1">
              <li>• Upload your company logo</li>
              <li>• Customize colors and themes</li>
              <li>• Add custom CSS for advanced styling</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ClientPortalSettings;
