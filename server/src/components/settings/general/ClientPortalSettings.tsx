'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "server/src/components/ui/Card";
import { Globe, Upload, Palette, X } from 'lucide-react';
import { LOCALE_CONFIG, type SupportedLocale } from '@/lib/i18n/config';
import { updateTenantDefaultLocaleAction, getTenantLocaleSettingsAction } from '@/lib/actions/tenant-actions/tenantLocaleActions';
import { updateTenantBrandingAction, getTenantBrandingAction } from '@/lib/actions/tenant-actions/tenantBrandingActions';
import { toast } from 'react-hot-toast';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';

const ClientPortalSettings = () => {
  const [defaultLocale, setDefaultLocale] = useState<SupportedLocale>(LOCALE_CONFIG.defaultLocale as SupportedLocale);
  const [enabledLocales, setEnabledLocales] = useState<SupportedLocale[]>([...LOCALE_CONFIG.supportedLocales]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [brandingLoading, setBrandingLoading] = useState(true);
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string>('');
  const [primaryColor, setPrimaryColor] = useState<string>('#6366F1');
  const [secondaryColor, setSecondaryColor] = useState<string>('#8B5CF6');
  const [companyName, setCompanyName] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        const [localeSettings, brandingSettings] = await Promise.all([
          getTenantLocaleSettingsAction(),
          getTenantBrandingAction()
        ]);

        if (localeSettings) {
          setDefaultLocale(localeSettings.defaultLocale);
          setEnabledLocales(localeSettings.enabledLocales);
        }

        if (brandingSettings) {
          setLogoUrl(brandingSettings.logoUrl || '');
          setPrimaryColor(brandingSettings.primaryColor || '#6366F1');
          setSecondaryColor(brandingSettings.secondaryColor || '#8B5CF6');
          setCompanyName(brandingSettings.companyName || '');
        }
      } catch (error) {
        console.error('Failed to load tenant settings:', error);
      } finally {
        setLoading(false);
        setBrandingLoading(false);
      }
    };

    loadTenantSettings();
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

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Check file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Logo file size must be less than 2MB');
      return;
    }

    // Check file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file');
      return;
    }

    setBrandingSaving(true);
    try {
      // Convert to base64
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64String = reader.result as string;
        setLogoUrl(base64String);
        await saveBrandingSettings({ logoUrl: base64String });
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Failed to upload logo:', error);
      toast.error('Failed to upload logo');
    } finally {
      setBrandingSaving(false);
    }
  };

  const handleRemoveLogo = async () => {
    setBrandingSaving(true);
    try {
      setLogoUrl('');
      await saveBrandingSettings({ logoUrl: '' });
      toast.success('Logo removed');
    } catch (error) {
      console.error('Failed to remove logo:', error);
      toast.error('Failed to remove logo');
    } finally {
      setBrandingSaving(false);
    }
  };

  const saveBrandingSettings = async (updates: Partial<{
    logoUrl: string;
    primaryColor: string;
    secondaryColor: string;
    companyName: string;
  }>) => {
    const brandingData = {
      logoUrl: updates.logoUrl !== undefined ? updates.logoUrl : logoUrl,
      primaryColor: updates.primaryColor || primaryColor,
      secondaryColor: updates.secondaryColor || secondaryColor,
      companyName: updates.companyName !== undefined ? updates.companyName : companyName,
    };

    await updateTenantBrandingAction(brandingData);
    toast.success('Branding settings updated');
  };

  const handleSaveBranding = async () => {
    setBrandingSaving(true);
    try {
      await saveBrandingSettings({
        primaryColor,
        secondaryColor,
        companyName,
      });
    } catch (error) {
      console.error('Failed to save branding settings:', error);
      toast.error('Failed to save branding settings');
    } finally {
      setBrandingSaving(false);
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
              Custom Domain (Coming Soon)
            </div>
          </CardTitle>
          <CardDescription>
            Configure a custom domain for your client portal (e.g., portal.yourcompany.com)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-6 text-center">
              <p className="text-gray-600 mb-2">Custom domain configuration will be available in a future update.</p>
              <p className="text-sm text-gray-500">You'll be able to:</p>
              <ul className="text-sm text-gray-500 mt-2 space-y-1">
                <li>• Use your own domain for the client portal</li>
                <li>• Configure SSL certificates automatically</li>
                <li>• Set up custom email domains</li>
              </ul>
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
          <CardTitle>
            <div className="flex items-center gap-2">
              <Palette className="h-5 w-5" />
              Branding & Appearance
            </div>
          </CardTitle>
          <CardDescription>
            Customize the look and feel of your client portal with your company branding.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* Company Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Company Name
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Your Company Name"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                disabled={brandingLoading || brandingSaving}
              />
              <p className="text-sm text-gray-500 mt-1">
                This will be displayed in the client portal header
              </p>
            </div>

            {/* Logo Upload */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Company Logo
              </label>
              <div className="mt-2">
                {logoUrl ? (
                  <div className="relative inline-block">
                    <div className="w-48 h-24 border-2 border-gray-300 rounded-lg overflow-hidden bg-white">
                      <img
                        src={logoUrl}
                        alt="Company logo"
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <button
                      onClick={handleRemoveLogo}
                      className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
                      disabled={brandingSaving}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="w-48 h-24 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-gray-400 bg-gray-50"
                  >
                    <Upload className="h-6 w-6 text-gray-400" />
                    <span className="text-sm text-gray-500 mt-1">Upload logo</span>
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  className="hidden"
                  disabled={brandingSaving}
                />
                <p className="text-sm text-gray-500 mt-2">
                  Recommended: PNG or SVG, max 2MB, transparent background
                </p>
              </div>
            </div>

            {/* Color Palette */}
            <div className="space-y-4">
              <label className="block text-sm font-medium text-gray-700">
                Color Palette
              </label>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Primary Color
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="h-10 w-20 border border-gray-300 rounded cursor-pointer"
                      disabled={brandingLoading || brandingSaving}
                    />
                    <input
                      type="text"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                      placeholder="#6366F1"
                      disabled={brandingLoading || brandingSaving}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Used for buttons, links, and highlights
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Secondary Color
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={secondaryColor}
                      onChange={(e) => setSecondaryColor(e.target.value)}
                      className="h-10 w-20 border border-gray-300 rounded cursor-pointer"
                      disabled={brandingLoading || brandingSaving}
                    />
                    <input
                      type="text"
                      value={secondaryColor}
                      onChange={(e) => setSecondaryColor(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                      placeholder="#8B5CF6"
                      disabled={brandingLoading || brandingSaving}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Used for accents and secondary actions
                  </p>
                </div>
              </div>
            </div>

            {/* Preview */}
            <div className="border-t pt-4">
              <h4 className="text-sm font-medium text-gray-700 mb-3">Preview</h4>
              <div className="border border-gray-200 rounded-lg p-4 bg-white">
                <div className="flex items-center gap-3 mb-4">
                  {logoUrl ? (
                    <img src={logoUrl} alt="Logo" className="h-8 object-contain" />
                  ) : (
                    <div className="w-8 h-8 bg-gray-300 rounded" />
                  )}
                  <span className="text-lg font-semibold">
                    {companyName || 'Your Company'} Portal
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    className="px-4 py-2 rounded text-white text-sm"
                    style={{ backgroundColor: primaryColor }}
                    disabled
                  >
                    Primary Button
                  </button>
                  <button
                    className="px-4 py-2 rounded text-white text-sm"
                    style={{ backgroundColor: secondaryColor }}
                    disabled
                  >
                    Secondary Button
                  </button>
                </div>
              </div>
            </div>

            {/* Save Button */}
            <div className="flex justify-end">
              <button
                onClick={handleSaveBranding}
                disabled={brandingLoading || brandingSaving}
                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {brandingSaving ? 'Saving...' : 'Save Branding Settings'}
              </button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ClientPortalSettings;