'use client';

/* global process */

import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Switch } from '@alga-psa/ui/components/Switch';
import EntityImageUpload from '@alga-psa/ui/components/EntityImageUpload';
import { Palette, Sparkles } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getTenantThemeAction,
  updateTenantThemeAction,
} from '@alga-psa/tenancy/actions/tenant-actions/tenantThemeActions';
import { getTenantBrandingAction } from '@alga-psa/tenancy/actions/tenant-actions/tenantBrandingActions';
import { deleteTenantLogo, uploadTenantLogo } from '@alga-psa/tenancy/actions/tenant-actions/tenantLogoActions';
import { getCurrentUser } from '@alga-psa/user-composition/actions/userQueryActions';
import {
  DEFAULT_THEME_PAIR_ID,
  THEME_PAIRS,
  type ThemePairId,
} from '@alga-psa/tenancy/lib/themePairs';
import {
  DEFAULT_CUSTOM_THEME,
  type CustomThemeMode,
  type CustomThemeTokenKey,
  type CustomThemeTokens,
} from '@alga-psa/tenancy/lib/customTheme';
import ThemePairPreview from './ThemePairPreview';
import CustomThemeEditor from './CustomThemeEditor';

const cloneDefaultCustomTheme = (): { light: CustomThemeTokens; dark: CustomThemeTokens } => ({
  light: { ...DEFAULT_CUSTOM_THEME.light },
  dark: { ...DEFAULT_CUSTOM_THEME.dark },
});

const AppearanceSettings = () => {
  const { t } = useTranslation('msp/settings');
  const router = useRouter();
  const isEEAvailable = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pairId, setPairId] = useState<ThemePairId>(DEFAULT_THEME_PAIR_ID);
  const [customTheme, setCustomTheme] = useState<{ light: CustomThemeTokens; dark: CustomThemeTokens } | null>(null);
  const [customMode, setCustomMode] = useState<CustomThemeMode>('light');
  const [mspWhiteLabel, setMspWhiteLabel] = useState(false);
  const [tenantId, setTenantId] = useState('');
  const [clientName, setClientName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [logoDarkUrl, setLogoDarkUrl] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const [theme, branding, user] = await Promise.all([
          getTenantThemeAction(),
          getTenantBrandingAction(),
          getCurrentUser(),
        ]);
        setPairId(theme.pairId);
        setCustomTheme(theme.customTheme ? { light: theme.customTheme.light, dark: theme.customTheme.dark } : null);
        setMspWhiteLabel(!!theme.mspWhiteLabel);
        setLogoUrl(branding?.logoUrl || '');
        setLogoDarkUrl(branding?.logoDarkUrl || '');
        setClientName(branding?.clientName || '');
        setTenantId(user?.tenant || '');
      } catch (error) {
        handleError(error, t('appearance.messages.loadFailed', { defaultValue: 'Failed to load appearance settings' }));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleTokenChange = useCallback((mode: CustomThemeMode, key: CustomThemeTokenKey, value: string) => {
    setCustomTheme((current) => {
      const base = current ?? cloneDefaultCustomTheme();
      return { ...base, [mode]: { ...base[mode], [key]: value } };
    });
  }, []);

  const applyPairAttribute = (nextPairId: ThemePairId) => {
    // The attribute is server-rendered; keep the open tab in sync so the admin
    // sees the pair they just saved without a reload.
    document.documentElement.setAttribute('data-theme-pair', nextPairId);
  };

  const save = async (overrides: { pairId?: ThemePairId; mspWhiteLabel?: boolean } = {}) => {
    const nextPairId = overrides.pairId ?? pairId;
    const nextWhiteLabel = overrides.mspWhiteLabel ?? mspWhiteLabel;
    setSaving(true);
    try {
      await updateTenantThemeAction({
        // Only the custom card sends colors. Switching to a predefined pair
        // leaves the saved palette to the action's carry-forward, so an
        // unsaved, contrast-failing edit can never block a pair change.
        pairId: nextPairId,
        ...(nextPairId === 'custom' ? { customTheme: customTheme ?? cloneDefaultCustomTheme() } : {}),
        mspWhiteLabel: nextWhiteLabel,
      });
      setPairId(nextPairId);
      setMspWhiteLabel(nextWhiteLabel);
      applyPairAttribute(nextPairId);
      // The shell reads branding on the server, so refresh it instead of making
      // the admin reload to see the change.
      router.refresh();
      toast.success(t('appearance.messages.saved', { defaultValue: 'Appearance updated' }));
    } catch (error) {
      handleError(error, t('appearance.messages.saveFailed', { defaultValue: 'Failed to save appearance settings' }));
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = (variant: 'default' | 'dark') =>
    async (entityId: string, formData: FormData) => {
      const result = await uploadTenantLogo(entityId, formData, variant);
      // The sidebar mark is resolved server-side; refresh so the new logo lands
      // in the rail right away rather than on the next full page load.
      if (result?.success) {
        router.refresh();
      }
      return result;
    };
  const handleLogoDelete = (variant: 'default' | 'dark') =>
    async (entityId: string) => {
      const result = await deleteTenantLogo(entityId, variant);
      if (result?.success) {
        router.refresh();
      }
      return result;
    };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <Palette className="h-5 w-5" />
              {t('appearance.title', { defaultValue: 'Theme' })}
            </span>
          </CardTitle>
          <CardDescription>
            {t('appearance.description', {
              defaultValue:
                'Pick the light/dark pair everyone in this organization sees, in both the MSP app and the client portal. Each person still chooses light, dark or system for themselves.',
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {THEME_PAIRS.map((pair) => {
              const selected = pairId === pair.id;
              return (
                <button
                  key={pair.id}
                  id={`theme-pair-${pair.id}`}
                  type="button"
                  disabled={loading || saving}
                  onClick={() => save({ pairId: pair.id })}
                  data-automation-id={`theme-pair-${pair.id}`}
                  aria-pressed={selected}
                  className={`rounded-lg border-2 p-3 text-left transition-colors ${
                    selected
                      ? 'border-[rgb(var(--color-primary-500))]'
                      : 'border-[rgb(var(--color-border-200))] hover:border-[rgb(var(--color-border-400))]'
                  }`}
                >
                  <div className="grid grid-cols-2 gap-2">
                    <ThemePairPreview swatch={pair.light} label={`${pair.label} light`} />
                    <ThemePairPreview swatch={pair.dark} label={`${pair.label} dark`} />
                  </div>
                  <div className="mt-2 text-sm font-medium">{t(pair.labelKey, { defaultValue: pair.label })}</div>
                  <p className="text-xs text-[rgb(var(--color-text-500))]">
                    {t(pair.descriptionKey, { defaultValue: pair.description })}
                  </p>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {isEEAvailable && (
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                {t('appearance.custom.title', { defaultValue: 'Custom theme' })}
              </span>
            </CardTitle>
            <CardDescription>
              {t('appearance.custom.description', {
                defaultValue:
                  'Build your own light and dark variants. The full color scales are derived from these core colors, and contrast is checked before the theme can be saved.',
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CustomThemeEditor
              theme={customTheme ?? cloneDefaultCustomTheme()}
              mode={customMode}
              onModeChange={setCustomMode}
              onTokenChange={handleTokenChange}
              disabled={loading || saving}
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                id="save-custom-theme"
                type="button"
                disabled={loading || saving}
                onClick={() => save({ pairId: 'custom' })}
              >
                {t('appearance.custom.actions.save', { defaultValue: 'Save and use custom theme' })}
              </Button>
              <Button
                id="reset-custom-theme"
                type="button"
                variant="outline"
                disabled={loading || saving}
                onClick={() => {
                  setCustomTheme(cloneDefaultCustomTheme());
                  toast.success(
                    t('appearance.custom.actions.resetDone', { defaultValue: 'Custom colors reset — save to apply' }),
                  );
                }}
              >
                {t('appearance.custom.actions.reset', { defaultValue: 'Reset colors' })}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isEEAvailable && (
        <Card>
          <CardHeader>
            <CardTitle>{t('appearance.whiteLabel.title', { defaultValue: 'White-label the MSP app' })}</CardTitle>
            <CardDescription>
              {t('appearance.whiteLabel.description', {
                defaultValue:
                  'Upload your logo once. It replaces the Alga mark in the MSP side menu, and the client portal uses the same images.',
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {tenantId && (
              <div className="mb-6">
                <p className="mb-4 text-sm text-[rgb(var(--color-text-500))]">
                  {t('appearance.whiteLabel.logoHelp', {
                    defaultValue:
                      'The MSP side menu is dark in both themes, so it uses the dark-background logo when you provide one and falls back to the main logo otherwise.',
                  })}
                </p>
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-medium">
                      {t('appearance.whiteLabel.fields.logo', { defaultValue: 'Logo' })}
                    </label>
                    <EntityImageUpload
                      entityType="tenant"
                      entityId={tenantId}
                      entityName={clientName || 'AlgaPSA'}
                      imageUrl={logoUrl}
                      uploadAction={handleLogoUpload('default')}
                      deleteAction={handleLogoDelete('default')}
                      onImageChange={(next) => setLogoUrl(next || '')}
                      size="lg"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium">
                      {t('appearance.whiteLabel.fields.logoDark', { defaultValue: 'Logo for dark backgrounds' })}
                    </label>
                    <EntityImageUpload
                      entityType="tenant"
                      entityId={tenantId}
                      entityName={clientName || 'AlgaPSA'}
                      imageUrl={logoDarkUrl}
                      uploadAction={handleLogoUpload('dark')}
                      deleteAction={handleLogoDelete('dark')}
                      onImageChange={(next) => setLogoDarkUrl(next || '')}
                      size="lg"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-4 border-t border-[rgb(var(--color-border-200))] pt-4">
              <div>
                <p className="text-sm font-medium">
                  {t('appearance.whiteLabel.colors.label', {
                    defaultValue: 'Use your brand colors in the MSP app',
                  })}
                </p>
                <p className="text-sm text-[rgb(var(--color-text-500))]">
                  {t('appearance.whiteLabel.colors.help', {
                    defaultValue:
                      'Off by default. When on, your primary and secondary colors replace the theme accents for MSP users, the way they already do in the client portal.',
                  })}
                </p>
              </div>
              <Switch
                id="msp-white-label-toggle"
                checked={mspWhiteLabel}
                disabled={loading || saving}
                onCheckedChange={(checked) => save({ mspWhiteLabel: checked })}
                aria-label={t('appearance.whiteLabel.colors.label', {
                  defaultValue: 'Use your brand colors in the MSP app',
                })}
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default AppearanceSettings;
