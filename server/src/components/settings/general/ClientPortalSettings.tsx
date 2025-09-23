'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "server/src/components/ui/Card";
import { Globe, Palette } from 'lucide-react';
import { LOCALE_CONFIG, type SupportedLocale } from '@/lib/i18n/config';
import { updateTenantDefaultLocaleAction, getTenantLocaleSettingsAction } from '@/lib/actions/tenant-actions/tenantLocaleActions';
import { updateTenantBrandingAction, getTenantBrandingAction } from '@/lib/actions/tenant-actions/tenantBrandingActions';
import { toast } from 'react-hot-toast';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import EntityImageUpload from 'server/src/components/ui/EntityImageUpload';
import ColorPicker from 'server/src/components/ui/ColorPicker';
import { uploadTenantLogo, deleteTenantLogo } from '@/lib/actions/tenant-actions/tenantLogoActions';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { useBranding } from 'server/src/components/providers/BrandingProvider';

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
  const [tenantId, setTenantId] = useState<string>('');
  const { refreshBranding } = useBranding();

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
        const [user, localeSettings, brandingSettings] = await Promise.all([
          getCurrentUser(),
          getTenantLocaleSettingsAction(),
          getTenantBrandingAction()
        ]);

        if (user) {
          setTenantId(user.tenant);
        }

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


  const saveBrandingSettings = async (updates: Partial<{
    primaryColor: string;
    secondaryColor: string;
    companyName: string;
  }>) => {
    const brandingData = {
      logoUrl: logoUrl, // Keep existing logo URL
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
      // Refresh branding context after saving
      await refreshBranding();
    } catch (error) {
      console.error('Failed to save branding settings:', error);
      toast.error('Failed to save branding settings');
    } finally {
      setBrandingSaving(false);
    }
  };

  // Wrapper for logo upload that refreshes branding
  const handleLogoUpload = async (entityId: string, formData: FormData) => {
    const result = await uploadTenantLogo(entityId, formData);
    if (result.success) {
      // Refresh branding context after successful upload
      await refreshBranding();
    }
    return result;
  };

  // Wrapper for logo delete that refreshes branding
  const handleLogoDelete = async (entityId: string) => {
    const result = await deleteTenantLogo(entityId);
    if (result.success) {
      // Refresh branding context after successful delete
      await refreshBranding();
    }
    return result;
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
              <Input
                id="company-name"
                label="Company Name"
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Your Company Name"
                disabled={brandingLoading || brandingSaving}
                containerClassName="mb-1"
              />
              <p className="text-sm text-gray-500">
                This will be displayed in the client portal header
              </p>
            </div>

            {/* Logo Upload */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Company Logo
              </label>
              {tenantId && (
                <EntityImageUpload
                  entityType="tenant"
                  entityId={tenantId}
                  entityName={companyName || 'Client Portal'}
                  imageUrl={logoUrl}
                  uploadAction={handleLogoUpload}
                  deleteAction={handleLogoDelete}
                  onImageChange={(newLogoUrl) => {
                    setLogoUrl(newLogoUrl || '');
                  }}
                  size="lg"
                />
              )}
              <p className="text-sm text-gray-500 mt-2">
                Recommended: PNG or SVG, max 2MB, transparent background
              </p>
            </div>

            {/* Color Palette */}
            <div className="space-y-4">
              <label className="block text-sm font-medium text-gray-700">
                Color Palette
              </label>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-2">
                    Primary Color
                  </label>
                  <ColorPicker
                    currentBackgroundColor={primaryColor}
                    onSave={(color) => {
                      if (color) setPrimaryColor(color);
                    }}
                    trigger={
                      <button
                        type="button"
                        className="flex items-center gap-2 px-3 py-2 border border-[rgb(var(--color-border-400))] rounded-md hover:bg-gray-50 transition-colors w-full"
                        disabled={brandingLoading || brandingSaving}
                      >
                        <div
                          className="w-8 h-8 rounded border border-gray-300"
                          style={{ backgroundColor: primaryColor }}
                        />
                        <span className="text-sm">{primaryColor}</span>
                      </button>
                    }
                    showTextColor={false}
                    previewType="circle"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Used for buttons, links, and highlights
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-2">
                    Secondary Color
                  </label>
                  <ColorPicker
                    currentBackgroundColor={secondaryColor}
                    onSave={(color) => {
                      if (color) setSecondaryColor(color);
                    }}
                    trigger={
                      <button
                        type="button"
                        className="flex items-center gap-2 px-3 py-2 border border-[rgb(var(--color-border-400))] rounded-md hover:bg-gray-50 transition-colors w-full"
                        disabled={brandingLoading || brandingSaving}
                      >
                        <div
                          className="w-8 h-8 rounded border border-gray-300"
                          style={{ backgroundColor: secondaryColor }}
                        />
                        <span className="text-sm">{secondaryColor}</span>
                      </button>
                    }
                    showTextColor={false}
                    previewType="circle"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Used for accents and secondary actions
                  </p>
                </div>
              </div>
            </div>

            {/* Preview */}
            <div className="border-t pt-4">
              <h4 className="text-sm font-medium text-gray-700 mb-3">Preview</h4>
              <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                {/* Mock Navigation Bar */}
                <div className="bg-white shadow-sm border-b border-gray-200">
                  <div className="px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {logoUrl ? (
                        <img src={logoUrl} alt="Logo" className="h-7 object-contain" />
                      ) : (
                        <div className="w-7 h-7 bg-gray-300 rounded" />
                      )}
                      <span className="text-base font-semibold text-gray-900">
                        {companyName || 'Your Company'} Portal
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <nav className="hidden md:flex items-center gap-6">
                        <span
                          className="text-sm font-medium cursor-default"
                          style={{ color: secondaryColor }}
                        >
                          Dashboard
                        </span>
                        <span className="text-sm text-gray-600 hover:text-gray-900 cursor-default">Tickets</span>
                        <span className="text-sm text-gray-600 hover:text-gray-900 cursor-default">Projects</span>
                      </nav>
                      <div className="w-8 h-8 bg-gray-300 rounded-full" />
                    </div>
                  </div>
                </div>

                {/* Mock Dashboard Content */}
                <div className="p-4">
                  {/* Welcome Section */}
                  <div className="bg-white rounded-lg p-4 mb-3">
                    <h2 className="text-base font-semibold text-gray-900 mb-1">Welcome back!</h2>
                    <p className="text-xs text-gray-600">Here's an overview of your account activity</p>
                  </div>

                  {/* Stats Cards */}
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    <div className="bg-white rounded-lg p-3 border border-gray-200">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-gray-600">Open Tickets</span>
                        <div
                          className="w-6 h-6 rounded flex items-center justify-center text-white text-xs font-bold"
                          style={{ backgroundColor: primaryColor }}
                        >
                          3
                        </div>
                      </div>
                      <div className="text-lg font-semibold text-gray-900">3</div>
                      <div className="text-xs text-gray-500">2 urgent</div>
                    </div>
                    <div className="bg-white rounded-lg p-3 border border-gray-200">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-gray-600">Active Projects</span>
                        <div
                          className="w-6 h-6 rounded flex items-center justify-center text-white text-xs font-bold"
                          style={{ backgroundColor: secondaryColor }}
                        >
                          5
                        </div>
                      </div>
                      <div className="text-lg font-semibold text-gray-900">5</div>
                      <div className="text-xs text-gray-500">1 near deadline</div>
                    </div>
                    <div className="bg-white rounded-lg p-3 border border-gray-200">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-gray-600">Invoices</span>
                        <div className="w-6 h-6 rounded bg-gray-300 flex items-center justify-center text-white text-xs font-bold">
                          $
                        </div>
                      </div>
                      <div className="text-lg font-semibold text-gray-900">$2,450</div>
                      <div className="text-xs text-gray-500">Due this month</div>
                    </div>
                  </div>

                  {/* Recent Activity */}
                  <div className="bg-white rounded-lg p-4 mb-3">
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">Recent Activity</h3>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: primaryColor }}
                        />
                        <span className="text-gray-600">Ticket #1234 was updated</span>
                        <span className="text-gray-400 ml-auto">2 hours ago</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: secondaryColor }}
                        />
                        <span className="text-gray-600">New invoice generated</span>
                        <span className="text-gray-400 ml-auto">5 hours ago</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: primaryColor }}
                        />
                        <span className="text-gray-600">Project milestone completed</span>
                        <span className="text-gray-400 ml-auto">1 day ago</span>
                      </div>
                    </div>
                  </div>

                  {/* Quick Actions */}
                  <div className="flex gap-2">
                    <button
                      className="px-3 py-1.5 rounded text-white text-xs font-medium transition-opacity hover:opacity-90"
                      style={{ backgroundColor: primaryColor }}
                      disabled
                    >
                      Create Ticket
                    </button>
                    <button
                      className="px-3 py-1.5 rounded text-xs font-medium border transition-colors"
                      style={{
                        borderColor: secondaryColor,
                        color: secondaryColor
                      }}
                      disabled
                    >
                      View Projects
                    </button>
                    <button
                      className="px-3 py-1.5 rounded text-xs font-medium bg-gray-100 text-gray-700 transition-colors"
                      disabled
                    >
                      Download Reports
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Save Button */}
            <div className="flex justify-end">
              <Button
                id="save-branding-settings"
                variant="default"
                onClick={handleSaveBranding}
                disabled={brandingLoading || brandingSaving}
              >
                {brandingSaving ? 'Saving...' : 'Save Branding Settings'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ClientPortalSettings;