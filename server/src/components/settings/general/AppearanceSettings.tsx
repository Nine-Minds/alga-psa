'use client';

/* global process */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Switch } from '@alga-psa/ui/components/Switch';
import EntityImageUpload from '@alga-psa/ui/components/EntityImageUpload';
import { useRegisterUnsavedChanges } from '@alga-psa/ui/context';
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
  getThemePairMeta,
  type ThemePairId,
} from '@alga-psa/tenancy/lib/themePairs';
import {
  customThemePresetFor,
  generateCustomThemeStyles,
  type CustomThemeMode,
  type CustomThemeTokenKey,
  type CustomThemeTokens,
} from '@alga-psa/tenancy/lib/customTheme';
import ThemePairPreview from './ThemePairPreview';
import CustomThemeEditor from './CustomThemeEditor';

type CustomThemePair = { light: CustomThemeTokens; dark: CustomThemeTokens };

/** Everything the Save button persists — kept together so "dirty" is one compare. */
interface ThemeDraft {
  pairId: ThemePairId;
  customTheme: CustomThemePair;
  mspWhiteLabel: boolean;
}

/** Live preview style element, appended after the server-rendered theme styles. */
const PREVIEW_STYLE_ID = 'preview-tenant-theme-styles';

const AppearanceSettings = () => {
  const { t } = useTranslation('msp/settings');
  const router = useRouter();
  const isEEAvailable = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // `saved` is what the rest of the organization sees; `draft` is what this tab
  // is previewing. Nothing reaches the tenant until Save.
  const [saved, setSaved] = useState<ThemeDraft>(() => ({
    pairId: DEFAULT_THEME_PAIR_ID,
    customTheme: customThemePresetFor(DEFAULT_THEME_PAIR_ID),
    mspWhiteLabel: false,
  }));
  const [draft, setDraft] = useState<ThemeDraft>(() => ({
    pairId: DEFAULT_THEME_PAIR_ID,
    customTheme: customThemePresetFor(DEFAULT_THEME_PAIR_ID),
    mspWhiteLabel: false,
  }));
  // Which predefined pair the editor colors were seeded from, or null while the
  // tenant's own saved palette is on screen.
  const [customSeedPairId, setCustomSeedPairId] = useState<ThemePairId | null>(DEFAULT_THEME_PAIR_ID);
  const [savedCustomTheme, setSavedCustomTheme] = useState<CustomThemePair | null>(null);
  const [customMode, setCustomMode] = useState<CustomThemeMode>('light');
  const [tenantId, setTenantId] = useState('');
  const [clientName, setClientName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [logoDarkUrl, setLogoDarkUrl] = useState('');

  const isDirty = useMemo(() => {
    if (draft.pairId !== saved.pairId) return true;
    if (draft.mspWhiteLabel !== saved.mspWhiteLabel) return true;
    // Colors only count while the custom pair is the one selected — a stale edit
    // on a predefined pair is never persisted.
    return draft.pairId === 'custom'
      && JSON.stringify(draft.customTheme) !== JSON.stringify(saved.customTheme);
  }, [draft, saved]);

  useRegisterUnsavedChanges('appearance-theme', isDirty);

  useEffect(() => {
    const load = async () => {
      try {
        const [theme, branding, user] = await Promise.all([
          getTenantThemeAction(),
          getTenantBrandingAction(),
          getCurrentUser(),
        ]);
        const persisted = theme.customTheme
          ? { light: theme.customTheme.light, dark: theme.customTheme.dark }
          : null;
        setSavedCustomTheme(persisted);

        let colors: CustomThemePair;
        if (theme.pairId === 'custom' && persisted) {
          // The custom palette is what the tenant is running, so edit that.
          colors = persisted;
          setCustomSeedPairId(null);
        } else {
          // Running a predefined pair: open on that pair's colors, so tweaking a
          // couple of them still yields a coherent theme. A palette saved during
          // an earlier visit must not shadow the pair on screen — it stays one
          // button away instead.
          const seed = theme.pairId === 'custom' ? DEFAULT_THEME_PAIR_ID : theme.pairId;
          colors = customThemePresetFor(seed);
          setCustomSeedPairId(seed);
        }

        const loaded: ThemeDraft = {
          pairId: theme.pairId,
          customTheme: colors,
          mspWhiteLabel: !!theme.mspWhiteLabel,
        };
        setSaved(loaded);
        setDraft(loaded);
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

  // Paint the draft on the whole app while the tab is open. The pair attribute
  // is server-rendered, so this only has to keep it in step; custom colors need
  // their CSS too, appended after the server-rendered block so it wins.
  useEffect(() => {
    if (loading) return;
    document.documentElement.setAttribute('data-theme-pair', draft.pairId);

    const existing = document.getElementById(PREVIEW_STYLE_ID);
    if (draft.pairId !== 'custom') {
      existing?.remove();
      return;
    }
    const style = existing ?? document.createElement('style');
    style.id = PREVIEW_STYLE_ID;
    style.textContent = generateCustomThemeStyles(draft.customTheme);
    if (!existing) document.head.appendChild(style);
  }, [draft, loading]);

  // Leaving the tab drops the preview: the shell goes back to what is saved,
  // without waiting for a full page load to re-render the attribute.
  const savedPairRef = React.useRef(saved.pairId);
  savedPairRef.current = saved.pairId;
  useEffect(() => () => {
    document.getElementById(PREVIEW_STYLE_ID)?.remove();
    document.documentElement.setAttribute('data-theme-pair', savedPairRef.current);
  }, []);

  const handleTokenChange = useCallback((mode: CustomThemeMode, key: CustomThemeTokenKey, value: string) => {
    setDraft((current) => ({
      ...current,
      // Touching a color is the request to preview it, so the custom pair takes
      // over the shell right away.
      pairId: 'custom',
      customTheme: { ...current.customTheme, [mode]: { ...current.customTheme[mode], [key]: value } },
    }));
  }, []);

  const pairLabel = (id: ThemePairId) => {
    if (id === 'custom') {
      return t('appearance.pairs.custom.label', { defaultValue: 'Custom' });
    }
    const meta = getThemePairMeta(id);
    return meta ? t(meta.labelKey, { defaultValue: meta.label }) : id;
  };

  const seedFrom = (seed: ThemePairId) => {
    setDraft((current) => ({ ...current, pairId: 'custom', customTheme: customThemePresetFor(seed) }));
    setCustomSeedPairId(seed);
  };

  const selectPair = (id: ThemePairId) => {
    // While the editor is still on seeded colors, following the previewed pair
    // keeps the mock and the app showing the same palette.
    const reseed = id !== 'custom' && customSeedPairId !== null;
    setDraft((current) => ({
      ...current,
      pairId: id,
      customTheme: reseed ? customThemePresetFor(id) : current.customTheme,
    }));
    if (reseed) setCustomSeedPairId(id);
  };

  const save = async () => {
    setSaving(true);
    try {
      await updateTenantThemeAction({
        // Only a custom selection sends colors. Switching to a predefined pair
        // leaves the saved palette to the action's carry-forward, so an unsaved,
        // contrast-failing edit can never block a pair change.
        pairId: draft.pairId,
        ...(draft.pairId === 'custom' ? { customTheme: draft.customTheme } : {}),
        mspWhiteLabel: draft.mspWhiteLabel,
      });
      setSaved(draft);
      if (draft.pairId === 'custom') {
        setSavedCustomTheme(draft.customTheme);
        setCustomSeedPairId(null);
      }
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

  const discard = () => {
    setDraft(saved);
    setCustomSeedPairId(saved.pairId === 'custom' ? null : saved.pairId);
    toast.success(t('appearance.messages.discarded', { defaultValue: 'Preview discarded' }));
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

  const customSwatch = (mode: CustomThemeMode) => ({
    background: draft.customTheme[mode].background,
    card: draft.customTheme[mode].card,
    text: draft.customTheme[mode].textPrimary,
    primary: draft.customTheme[mode].primary,
    sidebar: draft.customTheme[mode].sidebarBg,
  });

  return (
    <div className="space-y-6">
      {isDirty && (
        <div
          className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-md border border-[rgb(var(--color-primary-300))] bg-[rgb(var(--color-primary-50))] px-4 py-3"
          data-automation-id="appearance-unsaved-bar"
        >
          <p className="text-sm text-[rgb(var(--color-text-700))]">
            {t('appearance.unsaved.notice', {
              defaultValue:
                'You are previewing an unsaved theme. Everyone else keeps the saved one until you apply this.',
            })}
          </p>
          <div className="flex gap-2">
            <Button
              id="discard-appearance"
              type="button"
              variant="outline"
              disabled={saving}
              onClick={discard}
            >
              {t('appearance.unsaved.discard', { defaultValue: 'Discard' })}
            </Button>
            <Button id="save-appearance" type="button" disabled={saving} onClick={save}>
              {t('appearance.unsaved.save', { defaultValue: 'Apply to everyone' })}
            </Button>
          </div>
        </div>
      )}

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
              const selected = draft.pairId === pair.id;
              return (
                <button
                  key={pair.id}
                  id={`theme-pair-${pair.id}`}
                  type="button"
                  disabled={loading || saving}
                  onClick={() => selectPair(pair.id)}
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

            {isEEAvailable && (
              <button
                id="theme-pair-custom"
                type="button"
                disabled={loading || saving}
                onClick={() => selectPair('custom')}
                data-automation-id="theme-pair-custom"
                aria-pressed={draft.pairId === 'custom'}
                className={`rounded-lg border-2 p-3 text-left transition-colors ${
                  draft.pairId === 'custom'
                    ? 'border-[rgb(var(--color-primary-500))]'
                    : 'border-[rgb(var(--color-border-200))] hover:border-[rgb(var(--color-border-400))]'
                }`}
              >
                <div className="grid grid-cols-2 gap-2">
                  <ThemePairPreview swatch={customSwatch('light')} label="Custom light" />
                  <ThemePairPreview swatch={customSwatch('dark')} label="Custom dark" />
                </div>
                <div className="mt-2 text-sm font-medium">
                  {t('appearance.pairs.custom.label', { defaultValue: 'Custom' })}
                </div>
                <p className="text-xs text-[rgb(var(--color-text-500))]">
                  {t('appearance.pairs.custom.description', {
                    defaultValue: 'Your own colors, edited below.',
                  })}
                </p>
              </button>
            )}
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
              theme={draft.customTheme}
              mode={customMode}
              onModeChange={setCustomMode}
              onTokenChange={handleTokenChange}
              seededFrom={customSeedPairId ? pairLabel(customSeedPairId) : undefined}
              disabled={loading || saving}
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                id="reset-custom-theme"
                type="button"
                variant="outline"
                disabled={loading || saving}
                onClick={() => {
                  const seed = saved.pairId === 'custom' ? DEFAULT_THEME_PAIR_ID : saved.pairId;
                  seedFrom(seed);
                  toast.success(
                    t('appearance.custom.actions.resetDone', {
                      defaultValue: 'Colors reset to the {{pair}} theme — save to apply',
                      pair: pairLabel(seed),
                    }),
                  );
                }}
              >
                {t('appearance.custom.actions.reset', {
                  defaultValue: 'Reset to {{pair}} colors',
                  pair: pairLabel(saved.pairId === 'custom' ? DEFAULT_THEME_PAIR_ID : saved.pairId),
                })}
              </Button>
              {savedCustomTheme && customSeedPairId && (
                <Button
                  id="use-saved-custom-theme"
                  type="button"
                  variant="outline"
                  disabled={loading || saving}
                  onClick={() => {
                    setDraft((current) => ({ ...current, pairId: 'custom', customTheme: savedCustomTheme }));
                    setCustomSeedPairId(null);
                    toast.success(
                      t('appearance.custom.actions.useSavedDone', {
                        defaultValue: 'Your saved colors are back — save to apply',
                      }),
                    );
                  }}
                >
                  {t('appearance.custom.actions.useSaved', { defaultValue: 'Use my saved colors' })}
                </Button>
              )}
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
                  'The logo slots are shared with the client portal, but they only affect the MSP app after MSP UI customization is enabled below.',
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {tenantId && (
              <div className="mb-6">
                <p className="mb-4 text-sm text-[rgb(var(--color-text-500))]">
                  {t('appearance.whiteLabel.logoHelp', {
                    defaultValue:
                      'When enabled, the always-dark MSP side menu uses the dark-background logo and falls back to the main logo. Portal uploads alone never change the MSP app.',
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
                    defaultValue: 'Enable MSP UI customization',
                  })}
                </p>
                <p className="text-sm text-[rgb(var(--color-text-500))]">
                  {t('appearance.whiteLabel.colors.help', {
                    defaultValue:
                      'Off by default. When enabled and applied, the MSP app uses the shared logo while its colors continue to come from the organization theme above.',
                  })}
                </p>
              </div>
              <Switch
                id="msp-white-label-toggle"
                checked={draft.mspWhiteLabel}
                disabled={loading || saving}
                onCheckedChange={(checked) => setDraft((current) => ({ ...current, mspWhiteLabel: checked }))}
                aria-label={t('appearance.whiteLabel.colors.label', {
                  defaultValue: 'Enable MSP UI customization',
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
