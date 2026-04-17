'use client';


import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@alga-psa/ui/components/Card";
import { Globe, Palette, Eye, EyeOff } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';

import { LOCALE_CONFIG, filterPseudoLocales, type SupportedLocale } from '@alga-psa/core/i18n/config';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import {
  getTenantLocaleSettingsAction,
  updateTenantDefaultLocaleAction,
} from '@alga-psa/tenancy/actions';
import { getTenantBrandingAction, updateTenantBrandingAction } from '@alga-psa/tenancy/actions';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import EntityImageUpload from '@alga-psa/ui/components/EntityImageUpload';
import ColorPicker from '@alga-psa/ui/components/ColorPicker';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { deleteTenantLogo, uploadTenantLogo } from '@alga-psa/tenancy/actions';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { useBranding } from '@alga-psa/tenancy/components';
import ClientPortalDomainSettings from '@alga-psa/client-portal/domain-settings/entry';
import SignInPagePreview from './SignInPagePreview';
import { getPortalDomainStatusAction } from '@alga-psa/tenancy/actions';
import { Switch } from '@alga-psa/ui/components/Switch';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

const ClientPortalSettings = () => {
  const { t } = useTranslation('msp/settings');
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
  const [supportEmail, setSupportEmail] = useState<string>('');
  const [supportPhone, setSupportPhone] = useState<string>('');
  const [tenantId, setTenantId] = useState<string>('');
  const [showPreview, setShowPreview] = useState<boolean>(false);
  const [previewMode, setPreviewMode] = useState<'dashboard' | 'signin' | null>(null);
  const [previewTheme, setPreviewTheme] = useState<'light' | 'dark'>('light');
  const [hasCustomDomain, setHasCustomDomain] = useState<boolean>(false);
  const { refreshBranding } = useBranding();
  const { enabled: isMspI18nEnabled } = useFeatureFlag('msp-i18n-enabled', { defaultValue: false });
  const visibleLocales = useMemo(
    () => filterPseudoLocales(LOCALE_CONFIG.supportedLocales, !!isMspI18nEnabled),
    [isMspI18nEnabled],
  );

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
    return visibleLocales.map((locale) => ({
      value: locale,
      label: `${LOCALE_CONFIG.localeNames[locale]} (${locale.toUpperCase()})`,
    }));
  }, [visibleLocales]);

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
          setSupportEmail(brandingSettings.supportEmail || '');
          setSupportPhone(brandingSettings.supportPhone || '');
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
      handleError(error, 'Failed to update tenant language settings');
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
      handleError(error, 'Failed to update available languages');
    } finally {
      setSaving(false);
    }
  };


  const saveBrandingSettings = async (updates: Partial<{
    primaryColor: string;
    secondaryColor: string;
    clientName: string;
    supportEmail: string;
    supportPhone: string;
  }>) => {
    const brandingData = {
      logoUrl: logoUrl, // Keep existing logo URL
      primaryColor: updates.primaryColor || primaryColor,
      secondaryColor: updates.secondaryColor || secondaryColor,
      clientName: updates.clientName !== undefined ? updates.clientName : clientName,
      supportEmail: updates.supportEmail !== undefined ? updates.supportEmail : supportEmail,
      supportPhone: updates.supportPhone !== undefined ? updates.supportPhone : supportPhone,
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
        supportEmail,
        supportPhone,
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
      handleError(error, 'Failed to save branding settings');
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
          <CardTitle>
            <div className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              {t('clientPortal.language.title')}
            </div>
          </CardTitle>
          <CardDescription>
            {t('clientPortal.language.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div className="space-y-2">
              <CustomSelect
                id="tenant-default-language"
                label={t('clientPortal.language.fields.defaultLanguage')}
                options={languageOptions}
                value={defaultLocale}
                onValueChange={handleDefaultLanguageChange}
                disabled={loading || saving}
                placeholder="Select a language"
                data-automation-id="tenant-default-language-select"
              />
              <p className="text-sm text-gray-500">
                {t('clientPortal.language.help.defaultLanguage')}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('clientPortal.language.fields.availableLanguages')}
              </label>
              <p className="text-sm text-gray-500 mb-2">
                {t('clientPortal.language.help.availableLanguages')}
              </p>
              <div className="space-y-2">
                {visibleLocales.map((locale) => (
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

            <Alert variant="info">
              <AlertDescription>
                <h4 className="font-medium mb-2">{t('clientPortal.language.hierarchy.title')}</h4>
                <p className="mb-2">
                  {t('clientPortal.language.hierarchy.description')}
                </p>
                <ol className="space-y-1 list-decimal list-inside">
                  <li>{t('clientPortal.language.hierarchy.userPreference')}</li>
                  <li>{t('clientPortal.language.hierarchy.clientDefault')}</li>
                  <li>{t('clientPortal.language.hierarchy.orgDefault')}</li>
                  <li>{t('clientPortal.language.hierarchy.systemDefault')}</li>
                </ol>
                <p className="mt-2 italic">
                  {t('clientPortal.language.hierarchy.note')}
                </p>
              </AlertDescription>
            </Alert>
          </div>
        </CardContent>
      </Card>

      {/* Branding Settings Card */}
      <Card>
        <CardHeader>
          <CardTitle>
            <div className="flex items-center gap-2">
              <Palette className="h-5 w-5" />
              {t('clientPortal.branding.title')}
            </div>
          </CardTitle>
          <CardDescription>
            {t('clientPortal.branding.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* Company Name */}
            <div>
              <Input
                id="company-name"
                label={t('clientPortal.branding.fields.companyName')}
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Your Company Name"
                disabled={brandingLoading || brandingSaving}
                containerClassName="mb-1"
              />
              <p className="text-sm text-gray-500">
                {t('clientPortal.branding.help.companyName')}
              </p>
            </div>

            {/* Support Email */}
            <div>
              <Input
                id="support-email"
                label={t('clientPortal.branding.fields.supportEmail', { defaultValue: 'Support Email' })}
                type="email"
                value={supportEmail}
                onChange={(e) => setSupportEmail(e.target.value)}
                placeholder="support@yourcompany.com"
                disabled={brandingLoading || brandingSaving}
                containerClassName="mb-1"
              />
              <p className="text-sm text-gray-500">
                {t('clientPortal.branding.help.supportEmail', {
                  defaultValue: 'Shown to clients in appointment confirmations and other outbound emails as the address to contact for help.'
                })}
              </p>
            </div>

            {/* Support Phone */}
            <div>
              <Input
                id="support-phone"
                label={t('clientPortal.branding.fields.supportPhone', { defaultValue: 'Support Phone' })}
                type="tel"
                value={supportPhone}
                onChange={(e) => setSupportPhone(e.target.value)}
                placeholder="+1 (555) 123-4567"
                disabled={brandingLoading || brandingSaving}
                containerClassName="mb-1"
              />
              <p className="text-sm text-gray-500">
                {t('clientPortal.branding.help.supportPhone', {
                  defaultValue: 'Optional. Shown alongside the support email in client-facing emails.'
                })}
              </p>
            </div>

            {/* Logo Upload */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('clientPortal.branding.fields.companyLogo')}
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
                {t('clientPortal.branding.help.companyLogo')}
              </p>
            </div>

            {/* Color Palette */}
            <div className="space-y-4">
              <label className="block text-sm font-medium text-gray-700">
                {t('clientPortal.branding.fields.colorPalette')}
              </label>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-2">
                    {t('clientPortal.branding.fields.primaryColor')}
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
                    {t('clientPortal.branding.help.primaryColor')}
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-2">
                    {t('clientPortal.branding.fields.secondaryColor')}
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
                    {t('clientPortal.branding.help.secondaryColor')}
                  </p>
                </div>
              </div>
            </div>

            {/* Preview Selection Buttons */}
            <div className="border-t pt-4">
              <h4 className="text-sm font-medium text-gray-700 mb-3">{t('clientPortal.branding.preview')}</h4>
              <div className="flex items-center gap-3 mb-3">
                <Switch
                  id="branding-preview-theme-toggle"
                  checked={previewTheme === 'dark'}
                  onCheckedChange={(checked) => setPreviewTheme(checked ? 'dark' : 'light')}
                  label={t('clientPortal.branding.previewDarkMode')}
                  aria-label="Branding preview theme mode"
                />
              </div>
              <div className="flex gap-2 mb-3">
                <Button
                  id="preview-dashboard"
                  type="button"
                  variant={previewMode === 'dashboard' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPreviewMode(previewMode === 'dashboard' ? null : 'dashboard')}
                >
                  {previewMode === 'dashboard' ? t('clientPortal.branding.actions.hideDashboard') : t('clientPortal.branding.actions.previewDashboard')}
                </Button>
                {(() => {
                  const disabledMessage = t('clientPortal.branding.customDomainRequired');
                  const signInButton = (
                    <Button
                      id="preview-signin"
                      type="button"
                      variant={previewMode === 'signin' ? 'default' : 'outline'}
                      size="sm"
                      className={!hasCustomDomain ? 'cursor-not-allowed opacity-50' : ''}
                      onClick={(e) => {
                        if (!hasCustomDomain) {
                          e.preventDefault();
                          e.stopPropagation();
                          return;
                        }
                        setPreviewMode(previewMode === 'signin' ? null : 'signin');
                      }}
                      aria-disabled={!hasCustomDomain || undefined}
                      aria-describedby={!hasCustomDomain ? 'preview-signin-disabled-reason' : undefined}
                    >
                      {previewMode === 'signin' ? t('clientPortal.branding.actions.hideSignIn') : t('clientPortal.branding.actions.previewSignIn')}
                    </Button>
                  );
                  return !hasCustomDomain ? (
                    <>
                      <Tooltip content={disabledMessage}>{signInButton}</Tooltip>
                      <span id="preview-signin-disabled-reason" className="sr-only">
                        {disabledMessage}
                      </span>
                    </>
                  ) : (
                    signInButton
                  );
                })()}
              </div>

              {/* Dashboard Preview */}
              {previewMode === 'dashboard' && (
              <div className={`border border-gray-200 rounded-lg overflow-hidden bg-gray-50 ${previewTheme === 'dark' ? 'dark' : ''}`}>
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
                    <h2 className="text-base font-semibold text-gray-900 mb-1">{t('clientPortal.dashboardPreview.welcome')}</h2>
                    <p className="text-xs text-gray-600">{t('clientPortal.dashboardPreview.subtitle')}</p>
                  </div>

                  {/* Stats Cards */}
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    <div className="bg-white rounded-lg p-3 border border-gray-200">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-gray-600">{t('clientPortal.dashboardPreview.openTickets')}</span>
                        <div
                          className="w-6 h-6 rounded flex items-center justify-center text-white text-xs font-bold"
                          style={{ backgroundColor: primaryColor || '#8B5CF6' }}
                        >
                          3
                        </div>
                      </div>
                      <div className="text-lg font-semibold text-gray-900">3</div>
                      <div className="text-xs text-gray-500">{t('clientPortal.dashboardPreview.urgent', { count: 2 })}</div>
                    </div>
                    <div className="bg-white rounded-lg p-3 border border-gray-200">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-gray-600">{t('clientPortal.dashboardPreview.activeProjects')}</span>
                        <div
                          className="w-6 h-6 rounded flex items-center justify-center text-white text-xs font-bold"
                          style={{ backgroundColor: secondaryColor || '#6366F1' }}
                        >
                          5
                        </div>
                      </div>
                      <div className="text-lg font-semibold text-gray-900">5</div>
                      <div className="text-xs text-gray-500">{t('clientPortal.dashboardPreview.nearDeadline', { count: 1 })}</div>
                    </div>
                    <div className="bg-white rounded-lg p-3 border border-gray-200">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-gray-600">{t('clientPortal.dashboardPreview.invoices')}</span>
                        <div className="w-6 h-6 rounded bg-gray-300 flex items-center justify-center text-white text-xs font-bold">
                          $
                        </div>
                      </div>
                      <div className="text-lg font-semibold text-gray-900">$2,450</div>
                      <div className="text-xs text-gray-500">{t('clientPortal.dashboardPreview.dueThisMonth')}</div>
                    </div>
                  </div>

                  {/* Recent Activity */}
                  <div className="bg-white rounded-lg p-4 mb-3">
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">{t('clientPortal.dashboardPreview.recentActivity')}</h3>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: primaryColor || '#8B5CF6' }}
                        />
                        <span className="text-gray-600">{t('clientPortal.dashboardPreview.ticketUpdated')}</span>
                        <span className="text-gray-400 ml-auto">{t('clientPortal.dashboardPreview.hoursAgo', { count: 2 })}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: secondaryColor || '#6366F1' }}
                        />
                        <span className="text-gray-600">{t('clientPortal.dashboardPreview.newInvoice')}</span>
                        <span className="text-gray-400 ml-auto">{t('clientPortal.dashboardPreview.hoursAgo', { count: 5 })}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: primaryColor || '#8B5CF6' }}
                        />
                        <span className="text-gray-600">{t('clientPortal.dashboardPreview.milestoneCompleted')}</span>
                        <span className="text-gray-400 ml-auto">{t('clientPortal.dashboardPreview.dayAgo')}</span>
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
                      {t('clientPortal.dashboardPreview.createTicket')}
                    </button>
                    <button
                      className="px-3 py-1.5 rounded text-xs font-medium border transition-colors"
                      style={{
                        borderColor: secondaryColor || '#6366F1',
                        color: secondaryColor || '#6366F1'
                      }}
                      disabled
                    >
                      {t('clientPortal.dashboardPreview.viewProjects')}
                    </button>
                  </div>
                </div>
              </div>
              )}

              {/* Sign-in Page Preview */}
              {previewMode === 'signin' && (
                <div className={previewTheme === 'dark' ? 'dark' : ''}>
                  <SignInPagePreview
                    branding={{
                      logoUrl,
                      primaryColor: primaryColor || '#8B5CF6',
                      secondaryColor: secondaryColor || '#6366F1',
                      clientName
                    }}
                  />
                </div>
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
                {brandingSaving ? 'Saving...' : t('clientPortal.branding.actions.saveBranding')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ClientPortalSettings;
