'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "server/src/components/ui/Card";
import { Palette, Eye, EyeOff } from 'lucide-react';

import { LOCALE_CONFIG, type SupportedLocale } from '@/lib/i18n/config';
import { updateTenantDefaultLocaleAction, getTenantLocaleSettingsAction } from '@/lib/actions/tenant-actions/tenantLocaleActions';
import { updateTenantBrandingAction, getTenantBrandingAction } from '@/lib/actions/tenant-actions/tenantBrandingActions';
import { toast } from 'react-hot-toast';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import EntityImageUpload from 'server/src/components/ui/EntityImageUpload';
import ColorPicker from 'server/src/components/ui/ColorPicker';
import { uploadTenantLogo, deleteTenantLogo } from '@/lib/actions/tenant-actions/tenantLogoActions';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import { useBranding } from 'server/src/components/providers/BrandingProvider';
import ClientPortalDomainSettings from '@product/client-portal-domain/entry';
import SignInPagePreview from './SignInPagePreview';
import { getPortalDomainStatusAction } from '@/lib/actions/tenant-actions/portalDomainActions';

const ClientPortalSettings = () => {
  const [defaultLocale, setDefaultLocale] = useState<SupportedLocale>(LOCALE_CONFIG.defaultLocale as SupportedLocale);
  const [enabledLocales, setEnabledLocales] = useState<SupportedLocale[]>([...LOCALE_CONFIG.supportedLocales]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [brandingLoading, setBrandingLoading] = useState(true);
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string>('');
  const [primaryColor, setPrimaryColor] = useState<string>('');
  const [secondaryColor, setSecondaryColor] = useState<string>('');
  const [clientName, setClientName] = useState<string>('');
  const [tenantId, setTenantId] = useState<string>('');
  const [showPreview, setShowPreview] = useState<boolean>(false);
  const [previewMode, setPreviewMode] = useState<'dashboard' | 'signin' | null>(null);
  const [hasCustomDomain, setHasCustomDomain] = useState<boolean>(false);
  const { refreshBranding } = useBranding();

  // Check if custom domain is configured
  useEffect(() => {
    const checkCustomDomain = async () => {
      try {
        const status = await getPortalDomainStatusAction();
        // Enable preview if there's a domain value (regardless of status)
        setHasCustomDomain(!!status?.domain);
      } catch (error) {
        console.error('Failed to check custom domains:', error);
        setHasCustomDomain(false);
      }
    };

    // Check initially
    checkCustomDomain();

    // Check periodically every 5 seconds to detect domain changes
    const interval = setInterval(checkCustomDomain, 5000);

    return () => clearInterval(interval);
  }, []);

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
          setPrimaryColor(brandingSettings.primaryColor || '');
          setSecondaryColor(brandingSettings.secondaryColor || '');
          setClientName(brandingSettings.clientName || '');
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
    clientName: string;
  }>) => {
    const brandingData = {
      logoUrl: logoUrl, // Keep existing logo URL
      primaryColor: updates.primaryColor || primaryColor,
      secondaryColor: updates.secondaryColor || secondaryColor,
      clientName: updates.clientName !== undefined ? updates.clientName : clientName,
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
        clientName,
      });
      // Refresh branding context after saving
      await refreshBranding();

      // Re-check custom domain status
      try {
        const status = await getPortalDomainStatusAction();
        setHasCustomDomain(!!status?.domain);
      } catch (error) {
        console.error('Failed to re-check custom domain:', error);
      }
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
      <ClientPortalDomainSettings />

      {/* Language Settings Card */}
      <Card>
        <CardHeader>
          <CardTitle>Language Settings</CardTitle>
          <CardDescription>
            Configure the default language settings for your client portal.
            These settings apply to all users and clients unless overridden.
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
                This will be the default language for all client portal users and email notifications unless overridden by client setting or individual user preferences
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
                  <Checkbox
                    key={locale}
                    id={`locale-${locale}`}
                    label={`${LOCALE_CONFIG.localeNames[locale]} (${locale.toUpperCase()})${locale === defaultLocale ? ' (default)' : ''}`}
                    checked={enabledLocales.includes(locale)}
                    disabled={locale === defaultLocale || loading || saving}
                    onChange={(e) => {
                      if (e.target.checked) {
                        handleEnabledLanguagesChange([...enabledLocales, locale]);
                      } else {
                        handleEnabledLanguagesChange(enabledLocales.filter(l => l !== locale));
                      }
                    }}
                    className={locale === defaultLocale ? 'font-medium' : ''}
                  />
                ))}
              </div>
            </div>

            <div className="p-4 bg-blue-50 rounded-lg">
              <h4 className="text-sm font-medium text-blue-900 mb-2">Language Preference Hierarchy</h4>
              <p className="text-sm text-blue-800 mb-2">
                This hierarchy applies to both the client portal interface and email notifications sent to client portal users:
              </p>
              <ol className="text-sm text-blue-700 space-y-1 list-decimal list-inside">
                <li>Individual user preference (highest priority)</li>
                <li>Client default language</li>
                <li>Organization default (configured here)</li>
                <li>System default (English)</li>
              </ol>
              <p className="text-sm text-blue-600 mt-2 italic">
                Note: Internal MSP users always receive emails in English
              </p>
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
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
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
                  entityName={clientName || 'Client Portal'}
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
                    currentBackgroundColor={primaryColor || '#8B5CF6'}
                    onSave={(color) => {
                      // Set color or empty string to clear tenant override
                      setPrimaryColor(color || '');
                    }}
                    trigger={
                      <button
                        type="button"
                        className="flex items-center gap-2 px-3 py-2 border border-[rgb(var(--color-border-400))] rounded-md hover:bg-gray-50 transition-colors w-full"
                        disabled={brandingLoading || brandingSaving}
                      >
                        <div
                          className="w-8 h-8 rounded border border-gray-300"
                          style={{ backgroundColor: primaryColor || '#8B5CF6' }}
                        />
                        <span className="text-sm">{primaryColor || '#8B5CF6'}</span>
                      </button>
                    }
                    showTextColor={false}
                    previewType="circle"
                    colorMode="tag"
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
                    currentBackgroundColor={secondaryColor || '#6366F1'}
                    onSave={(color) => {
                      // Set color or empty string to clear tenant override
                      setSecondaryColor(color || '');
                    }}
                    trigger={
                      <button
                        type="button"
                        className="flex items-center gap-2 px-3 py-2 border border-[rgb(var(--color-border-400))] rounded-md hover:bg-gray-50 transition-colors w-full"
                        disabled={brandingLoading || brandingSaving}
                      >
                        <div
                          className="w-8 h-8 rounded border border-gray-300"
                          style={{ backgroundColor: secondaryColor || '#6366F1' }}
                        />
                        <span className="text-sm">{secondaryColor || '#6366F1'}</span>
                      </button>
                    }
                    showTextColor={false}
                    previewType="circle"
                    colorMode="tag"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Used for accents and secondary actions
                  </p>
                </div>
              </div>
            </div>

            {/* Preview Selection Buttons */}
            <div className="border-t pt-4">
              <h4 className="text-sm font-medium text-gray-700 mb-3">Preview</h4>
              <div className="flex gap-2 mb-3">
                <Button
                  id="preview-dashboard"
                  type="button"
                  variant={previewMode === 'dashboard' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPreviewMode(previewMode === 'dashboard' ? null : 'dashboard')}
                >
                  {previewMode === 'dashboard' ? 'Hide' : 'Preview'} Client Dashboard
                </Button>
                <Button
                  id="preview-signin"
                  type="button"
                  variant={previewMode === 'signin' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPreviewMode(previewMode === 'signin' ? null : 'signin')}
                  disabled={!hasCustomDomain}
                  title={!hasCustomDomain ? 'Configure a custom domain first to preview sign-in page' : ''}
                >
                  {previewMode === 'signin' ? 'Hide' : 'Preview'} Sign-in Page
                </Button>
              </div>

              {/* Dashboard Preview */}
              {previewMode === 'dashboard' && (
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
                        {clientName || 'Your Client'} Portal
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <nav className="hidden md:flex items-center gap-6">
                        <span
                          className="text-sm font-medium cursor-default"
                          style={{ color: secondaryColor || '#6366F1' }}
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
                          style={{ backgroundColor: primaryColor || '#8B5CF6' }}
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
                          style={{ backgroundColor: secondaryColor || '#6366F1' }}
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
                          style={{ backgroundColor: primaryColor || '#8B5CF6' }}
                        />
                        <span className="text-gray-600">Ticket #1234 was updated</span>
                        <span className="text-gray-400 ml-auto">2 hours ago</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: secondaryColor || '#6366F1' }}
                        />
                        <span className="text-gray-600">New invoice generated</span>
                        <span className="text-gray-400 ml-auto">5 hours ago</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: primaryColor || '#8B5CF6' }}
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
                        borderColor: secondaryColor || '#6366F1',
                        color: secondaryColor || '#6366F1'
                      }}
                      disabled
                    >
                      View Projects
                    </button>
                  </div>
                </div>
              </div>
              )}

              {/* Sign-in Page Preview */}
              {previewMode === 'signin' && (
                <SignInPagePreview
                  branding={{
                    logoUrl,
                    primaryColor: primaryColor || '#8B5CF6',
                    secondaryColor: secondaryColor || '#6366F1',
                    clientName
                  }}
                />
              )}
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
