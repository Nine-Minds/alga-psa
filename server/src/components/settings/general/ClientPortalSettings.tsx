'use client';


import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@alga-psa/ui/components/Card";
import { Globe, Palette } from 'lucide-react';
import { LanguageHierarchyTable } from '@alga-psa/ui/components/LanguageHierarchyTable';
import { LOCALE_CONFIG, filterPseudoLocales, type SupportedLocale } from '@alga-psa/core/i18n/config';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import {
  getTenantBrandingAction,
  updateTenantBrandingAction,
  getTenantLocaleSettingsAction,
  getTenantClientPortalLocaleAction,
  updateTenantClientPortalLocaleAction,
} from '@alga-psa/tenancy/actions';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
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

const UNSET_LOCALE_VALUE = '__inherit__';

const ClientPortalSettings = () => {
  const { t } = useTranslation('msp/settings');
  const [brandingLoading, setBrandingLoading] = useState(true);
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string>('');
  const [primaryColor, setPrimaryColor] = useState<string>('');
  const [secondaryColor, setSecondaryColor] = useState<string>('');
  const [clientName, setClientName] = useState<string>('');
  const [supportEmail, setSupportEmail] = useState<string>('');
  const [supportPhone, setSupportPhone] = useState<string>('');
  const [tenantId, setTenantId] = useState<string>('');
  const [previewMode, setPreviewMode] = useState<'dashboard' | 'signin' | null>(null);
  const [previewTheme, setPreviewTheme] = useState<'light' | 'dark'>('light');
  const [hasCustomDomain, setHasCustomDomain] = useState<boolean>(false);
  const [clientPortalLocale, setClientPortalLocale] = useState<SupportedLocale | null>(null);
  const [orgDefaultLocale, setOrgDefaultLocale] = useState<SupportedLocale>(
    LOCALE_CONFIG.defaultLocale as SupportedLocale,
  );
  const [localeLoading, setLocaleLoading] = useState<boolean>(true);
  const [localeSaving, setLocaleSaving] = useState<boolean>(false);
  const { refreshBranding } = useBranding();

  const visibleLocales = useMemo(
    () => filterPseudoLocales(LOCALE_CONFIG.supportedLocales),
    [],
  );

  const languageOptions = useMemo<SelectOption[]>(() => {
    const inheritLabel = t('clientPortalLanguage.inheritOption', {
      defaultValue: 'Use organization default ({{language}})',
      language: LOCALE_CONFIG.localeNames[orgDefaultLocale],
    });
    return [
      { value: UNSET_LOCALE_VALUE, label: inheritLabel },
      ...visibleLocales.map((locale) => ({
        value: locale,
        label: `${LOCALE_CONFIG.localeNames[locale]} (${locale.toUpperCase()})`,
      })),
    ];
  }, [visibleLocales, orgDefaultLocale, t]);

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

  useEffect(() => {
    const loadTenantSettings = async () => {
      try {
        const [user, brandingSettings, orgLocaleSettings, clientPortalLocaleSettings] = await Promise.all([
          getCurrentUser(),
          getTenantBrandingAction(),
          getTenantLocaleSettingsAction(),
          getTenantClientPortalLocaleAction(),
        ]);

        if (user) {
          setTenantId(user.tenant);
        }

        if (brandingSettings) {
          setLogoUrl(brandingSettings.logoUrl || '');
          setPrimaryColor(brandingSettings.primaryColor || '');
          setSecondaryColor(brandingSettings.secondaryColor || '');
          setClientName(brandingSettings.clientName || '');
          setSupportEmail(brandingSettings.supportEmail || '');
          setSupportPhone(brandingSettings.supportPhone || '');
        }

        if (orgLocaleSettings?.defaultLocale) {
          setOrgDefaultLocale(orgLocaleSettings.defaultLocale);
        }

        setClientPortalLocale(clientPortalLocaleSettings?.defaultLocale ?? null);
      } catch (error) {
        console.error('Failed to load tenant settings:', error);
      } finally {
        setBrandingLoading(false);
        setLocaleLoading(false);
      }
    };

    loadTenantSettings();
  }, []);

  const handleClientPortalLocaleChange = async (next: string) => {
    if (next === UNSET_LOCALE_VALUE) {
      // Clearing the override is a future enhancement — for now disallow
      // "unset" once something has been chosen and guide the admin to set
      // the org default instead.
      toast(
        t('clientPortalLanguage.unsetHint', {
          defaultValue:
            'To remove the client portal override, change the organization default under Settings → Language.',
        }),
      );
      return;
    }
    if (next === clientPortalLocale) return;
    const locale = next as SupportedLocale;
    setLocaleSaving(true);
    try {
      await updateTenantClientPortalLocaleAction(locale);
      setClientPortalLocale(locale);
      toast.success(
        t('clientPortalLanguage.updated', {
          defaultValue: 'Client portal default language updated to {{language}}',
          language: LOCALE_CONFIG.localeNames[locale],
        }),
      );
    } catch (error) {
      handleError(error, 'Failed to update client portal default language');
    } finally {
      setLocaleSaving(false);
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
    toast.success(t('clientPortal.brandingUpdated'));
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

      {/* Client Portal Language Card */}
      <Card>
        <CardHeader>
          <CardTitle>
            <div className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              {t('clientPortalLanguage.title', { defaultValue: 'Client Portal Language' })}
            </div>
          </CardTitle>
          <CardDescription>
            {t('clientPortalLanguage.description', {
              defaultValue:
                'Override the default language for client portal users only. MSP staff keep the organization default.',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            <div className="space-y-2">
              <CustomSelect
                id="client-portal-default-language"
                label={t('clientPortalLanguage.fields.defaultLanguage', { defaultValue: 'Default Language' })}
                options={languageOptions}
                value={clientPortalLocale ?? UNSET_LOCALE_VALUE}
                onValueChange={handleClientPortalLocaleChange}
                disabled={localeLoading || localeSaving}
                placeholder={t('clientPortalLanguage.placeholder', { defaultValue: 'Select a language' })}
                data-automation-id="client-portal-default-language-select"
              />
              <p className="text-sm text-gray-500">
                {t('clientPortalLanguage.help.defaultLanguage', {
                  defaultValue:
                    'When set, client portal users see this language unless their individual preference or their client’s default overrides it.',
                })}
              </p>
            </div>
            <LanguageHierarchyTable />
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
                placeholder={t('clientPortal.yourCompanyName')}
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
                  aria-label={t('clientPortal.brandingPreviewMode')}
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

              {/* Dashboard Preview — small, hand-rolled mock that mirrors the
                  live client portal layout. Theme classes are switched per
                  previewTheme so the dark-mode toggle actually changes colors;
                  the wrapper is height-bounded so the page doesn't grow huge
                  when the preview is open. */}
              {previewMode === 'dashboard' && (() => {
                const isDark = previewTheme === 'dark';
                const pageBg = isDark ? 'bg-slate-950' : 'bg-gray-100';
                const surface = isDark ? 'bg-slate-900' : 'bg-white';
                const surfaceMuted = isDark ? 'bg-slate-800' : 'bg-white';
                const borderCls = isDark ? 'border-slate-700' : 'border-gray-200';
                const heading = isDark ? 'text-slate-100' : 'text-gray-900';
                const text = isDark ? 'text-slate-300' : 'text-gray-700';
                const subtext = isDark ? 'text-slate-400' : 'text-gray-500';
                const sidebarInactiveText = isDark ? '#94a3b8' : '#cbd5e1';

                return (
                  <div className={`border ${borderCls} rounded-lg overflow-hidden ${pageBg} max-h-[560px] overflow-y-auto`}>
                    <div className="flex">
                      {/* Sidebar */}
                      <aside className="w-40 shrink-0 bg-slate-900 text-white py-3">
                        <div className="px-3 flex items-center gap-2">
                          {logoUrl ? (
                            <img src={logoUrl} alt="Logo" className="h-6 w-6 rounded-full object-contain bg-white/10" />
                          ) : (
                            <div
                              className="h-6 w-6 rounded-full"
                              style={{ backgroundColor: primaryColor || '#8B5CF6' }}
                            />
                          )}
                          <span className="text-sm font-semibold truncate">
                            {clientName || 'Your Client'}
                          </span>
                        </div>
                        <div className="px-3 mt-3 text-[10px] uppercase tracking-wider text-slate-400">
                          {t('clientPortal.dashboardPreview.workspaceSection', { defaultValue: 'Workspace' })}
                        </div>
                        <ul className="mt-1 space-y-0.5">
                          {[
                            { label: t('clientPortal.dashboardPreview.navDashboard', { defaultValue: 'Dashboard' }), active: true },
                            { label: t('clientPortal.dashboardPreview.navTickets', { defaultValue: 'Tickets' }), active: false },
                            { label: t('clientPortal.dashboardPreview.navServiceRequests', { defaultValue: 'Service Requests' }), active: false },
                            { label: t('clientPortal.dashboardPreview.navProjects', { defaultValue: 'Projects' }), active: false },
                            { label: t('clientPortal.dashboardPreview.navAppointments', { defaultValue: 'Appointments' }), active: false },
                            { label: t('clientPortal.dashboardPreview.navDevices', { defaultValue: 'My devices' }), active: false },
                          ].map((item, idx) => (
                            <li key={idx}>
                              <div
                                className="mx-2 rounded px-2 py-1 text-xs"
                                style={
                                  item.active
                                    ? { backgroundColor: `${primaryColor || '#8B5CF6'}33`, color: '#fff' }
                                    : { color: sidebarInactiveText }
                                }
                              >
                                {item.label}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </aside>

                      {/* Right column */}
                      <div className="flex-1 min-w-0">
                        {/* Topbar */}
                        <div className={`${surface} border-b ${borderCls} px-4 py-3 flex items-center justify-between`}>
                          <div className="min-w-0">
                            <div className={`text-[10px] uppercase tracking-wider ${subtext} truncate`}>
                              {clientName ? clientName.toUpperCase() : 'CLIENT PORTAL'}
                            </div>
                            <div className={`text-sm font-semibold ${heading}`}>
                              {t('clientPortal.dashboardPreview.dashboardTitle', { defaultValue: 'Dashboard' })}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className={`h-6 w-6 rounded-full ${isDark ? 'bg-slate-700' : 'bg-gray-100'}`} />
                            <div className={`h-6 w-6 rounded-full ${isDark ? 'bg-slate-700' : 'bg-gray-100'}`} />
                            <div className={`h-7 w-7 rounded-full ${isDark ? 'bg-slate-600' : 'bg-gray-300'}`} />
                          </div>
                        </div>

                        {/* Body */}
                        <div className="p-3 space-y-3">
                          {/* Hero */}
                          <div
                            className="rounded-lg p-3 text-white"
                            style={{
                              background: `linear-gradient(135deg, ${primaryColor || '#8B5CF6'}, ${secondaryColor || '#6366F1'})`,
                            }}
                          >
                            <div className="text-[10px] uppercase tracking-wider text-white/80">
                              {t('clientPortal.dashboardPreview.welcomeBack', { defaultValue: 'Welcome back' })}
                            </div>
                            <div className="text-sm font-semibold">
                              {t('clientPortal.dashboardPreview.greeting', { defaultValue: 'Good morning, Alex 👋' })}
                            </div>
                            <p className="mt-1 text-xs text-white/85">
                              {t('clientPortal.dashboardPreview.subtitle')}
                            </p>
                          </div>

                          {/* KPI cards */}
                          <div className="grid grid-cols-5 gap-2">
                            {[
                              { label: t('clientPortal.dashboardPreview.openTickets'), value: '3' },
                              { label: t('clientPortal.dashboardPreview.activeProjects'), value: '5' },
                              { label: t('clientPortal.dashboardPreview.serviceRequests', { defaultValue: 'Service requests' }), value: '2' },
                              { label: t('clientPortal.dashboardPreview.upcomingVisits', { defaultValue: 'Upcoming visits' }), value: '1' },
                              { label: t('clientPortal.dashboardPreview.activeDevices', { defaultValue: 'Active devices' }), value: '8' },
                            ].map((card, idx) => (
                              <div
                                key={idx}
                                className={`rounded-lg ${surfaceMuted} border ${borderCls} p-2`}
                              >
                                <div className={`text-[10px] truncate ${subtext}`}>{card.label}</div>
                                <div
                                  className="mt-1 text-sm font-semibold"
                                  style={{ color: idx === 0 ? primaryColor || '#8B5CF6' : isDark ? '#f1f5f9' : '#111' }}
                                >
                                  {card.value}
                                </div>
                              </div>
                            ))}
                          </div>

                          {/* Activity + side rail */}
                          <div className="grid grid-cols-3 gap-2">
                            <div className={`col-span-2 rounded-lg ${surfaceMuted} border ${borderCls} p-3`}>
                              <div className={`text-xs font-semibold ${heading} mb-2`}>
                                {t('clientPortal.dashboardPreview.recentActivity')}
                              </div>
                              <div className="space-y-1.5">
                                {[
                                  { dot: primaryColor, text: t('clientPortal.dashboardPreview.ticketUpdated'), when: t('clientPortal.dashboardPreview.hoursAgo', { count: 2 }) },
                                  { dot: secondaryColor, text: t('clientPortal.dashboardPreview.newInvoice'), when: t('clientPortal.dashboardPreview.hoursAgo', { count: 5 }) },
                                  { dot: primaryColor, text: t('clientPortal.dashboardPreview.milestoneCompleted'), when: t('clientPortal.dashboardPreview.dayAgo') },
                                ].map((row, idx) => (
                                  <div key={idx} className="flex items-center gap-2 text-[11px]">
                                    <span
                                      className="h-1.5 w-1.5 rounded-full"
                                      style={{ backgroundColor: row.dot || '#8B5CF6' }}
                                    />
                                    <span className={`${text} truncate`}>{row.text}</span>
                                    <span className={`ml-auto ${subtext} shrink-0`}>{row.when}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div className={`rounded-lg ${surfaceMuted} border ${borderCls} p-3`}>
                              <div className={`text-xs font-semibold ${heading} mb-2`}>
                                {t('clientPortal.dashboardPreview.upcomingShort', { defaultValue: 'Upcoming' })}
                              </div>
                              <div className="flex items-start gap-2">
                                <div
                                  className="flex w-9 flex-col items-center justify-center rounded py-1"
                                  style={{
                                    backgroundColor: `${primaryColor || '#8B5CF6'}1A`,
                                    color: primaryColor || '#8B5CF6',
                                  }}
                                >
                                  <div className="text-[9px] font-semibold uppercase tracking-wider">May</div>
                                  <div className="text-base font-semibold leading-none">19</div>
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className={`text-[11px] font-medium ${heading} truncate`}>
                                    {t('clientPortal.dashboardPreview.basicSupport', { defaultValue: 'Basic Support' })}
                                  </div>
                                  <div className={`text-[10px] ${subtext}`}>12:30 PM · 60m</div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

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
