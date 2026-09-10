'use client';

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Palette, RefreshCw } from "lucide-react";
import { Button } from "@alga-psa/ui/components/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@alga-psa/ui/components/Card";
import ColorPicker from "@alga-psa/ui/components/ColorPicker";
import { Label } from "@alga-psa/ui/components/Label";
import { Switch } from "@alga-psa/ui/components/Switch";
import { useRegisterUnsavedChanges } from "@alga-psa/ui/context";
import { useTranslation } from "@alga-psa/ui/lib/i18n/client";
import { getErrorMessage } from "@alga-psa/ui/lib/errorHandling";
import { applyEmailPalette, decorateBrandedHtml, STOCK_EMAIL_PALETTE } from "@alga-psa/email/branding";
import {
  getEmailBrandingStatusAction,
  removeEmailBrandingAction,
  saveEmailBrandingAction,
} from "../../actions";
import type { EmailBrandingStatus } from "../../lib/emailBranding";
import type { SystemEmailTemplate } from "../../types/notification";
import { ApplyEmailBrandingDialog } from "./ApplyEmailBrandingDialog";
import { EmailTemplatePreview } from "./EmailTemplatePreview";
import {
  NEW_TEMPLATE_DISMISS_KEY,
  OVERRIDABLE_TOKENS,
  SOURCE_FALLBACKS,
  TOKEN_FALLBACKS,
  TOKEN_IDS,
  draftFromStatus,
  draftMatchesSuggestion,
  resolveDraft,
  shouldShowNewTemplateBanner,
  type EmailBrandingDraft,
  type OverridableToken,
} from "./emailBrandingPanelState";

const PREFERRED_PREVIEW_TEMPLATES = ['ticket-created', 'invoice-email'];

/** Client-side edition check; the server enforces it again with isEnterprise. */
const isEnterpriseEdition = process.env.NEXT_PUBLIC_EDITION === 'enterprise';

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** One palette color, picked through the shared ColorPicker popover. Resetting hands `null` back to the caller. */
function ColorField({ id, label, value, disabled, onChange }: {
  id: string;
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string | null) => void;
}) {
  const safeValue = HEX.test(value) ? value : '#ffffff';

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <ColorPicker
        currentBackgroundColor={safeValue}
        onSave={(backgroundColor) => onChange(backgroundColor)}
        showTextColor={false}
        previewType="circle"
        colorMode="solid"
        trigger={
          <button
            type="button"
            id={id}
            aria-label={label}
            disabled={disabled}
            className="flex w-full items-center gap-2 rounded-md border border-[rgb(var(--color-border-400))] px-3 py-2 transition-colors hover:border-[rgb(var(--color-border-500))] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span
              className="h-6 w-6 shrink-0 rounded border border-[rgb(var(--color-border-300))]"
              style={{ backgroundColor: safeValue }}
            />
            <span className="font-mono text-xs">{value}</span>
          </button>
        }
      />
    </div>
  );
}

/**
 * The "Email branding" card above the template table: prefilled with the colors
 * the tenant already picked elsewhere, previewed live against real system
 * templates, and saved without touching a single template row.
 */
export function EmailBrandingPanel({
  systemTemplates,
  selectedLanguages,
  onStatusChange,
  onApplied,
}: {
  systemTemplates: (SystemEmailTemplate & { category: string })[];
  selectedLanguages: Set<string>;
  onStatusChange?: (status: EmailBrandingStatus | null) => void;
  /** Refreshes the templates table once rows have been written or removed. */
  onApplied?: () => void | Promise<void>;
}) {
  const { t } = useTranslation('msp/settings');
  const [status, setStatus] = useState<EmailBrandingStatus | null>(null);
  const [draft, setDraft] = useState<EmailBrandingDraft | null>(null);
  const [savedDraft, setSavedDraft] = useState<EmailBrandingDraft | null>(null);
  const [showAdjust, setShowAdjust] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyPreselection, setApplyPreselection] = useState<string[] | undefined>(undefined);
  const [dismissedNewCount, setDismissedNewCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const next = await getEmailBrandingStatusAction();
      setStatus(next);
      onStatusChange?.(next);
      const nextDraft = draftFromStatus(next);
      setDraft(nextDraft);
      setSavedDraft(nextDraft);
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    }
  }, [onStatusChange]);

  useEffect(() => {
    loadStatus();
    const dismissed = typeof window !== 'undefined'
      ? window.sessionStorage?.getItem(NEW_TEMPLATE_DISMISS_KEY)
      : null;
    setDismissedNewCount(dismissed === null ? null : Number(dismissed));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isDirty = useMemo(
    () => !!draft && !!savedDraft && JSON.stringify(draft) !== JSON.stringify(savedDraft),
    [draft, savedDraft],
  );
  useRegisterUnsavedChanges('email-branding-panel', isDirty);

  const resolved = useMemo(() => (draft ? resolveDraft(draft) : STOCK_EMAIL_PALETTE), [draft]);

  const previewTemplates = useMemo(() => {
    const language = selectedLanguages.size > 0 ? [...selectedLanguages][0] : 'en';
    const inLanguage = systemTemplates.filter((template) => template.language_code === language);
    const pool = inLanguage.length > 0 ? inLanguage : systemTemplates;
    const preferred = PREFERRED_PREVIEW_TEMPLATES
      .map((name) => pool.find((template) => template.name === name))
      .filter((template): template is SystemEmailTemplate & { category: string } => !!template);

    return preferred.length === 2 ? preferred : pool.slice(0, 2);
  }, [systemTemplates, selectedLanguages]);

  const update = useCallback((patch: Partial<EmailBrandingDraft>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }, []);

  const updateOverride = useCallback((token: OverridableToken, value: string) => {
    setDraft((current) => {
      if (!current) return current;
      const overrides = { ...current.overrides };
      if (value) overrides[token] = value;
      else delete overrides[token];
      return { ...current, overrides };
    });
  }, []);

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await saveEmailBrandingAction({
        primary: draft.primary,
        secondary: draft.singleColor ? null : draft.secondary,
        overrides: draft.overrides,
        logo: draft.logoVariant ? { variant: draft.logoVariant } : null,
        hideAttribution: draft.hideAttribution,
      });
      setSavedDraft(draft);
      await loadStatus();
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    setError(null);
    try {
      await removeEmailBrandingAction();
      await onApplied?.();
      await loadStatus();
    } catch (removeError) {
      setError(getErrorMessage(removeError));
    } finally {
      setRemoving(false);
    }
  };

  if (!status || !draft) return null;

  const sourceLabel = status.palette
    ? t('notifications.emailBranding.source.saved', 'Saved')
    : t(`notifications.emailBranding.source.${status.suggestion.source}`, SOURCE_FALLBACKS[status.suggestion.source]);

  const showNewTemplateBanner = shouldShowNewTemplateBanner(status, dismissedNewCount);
  const hasAnyLogo = !!(status.logoOptions.logoWideUrl || status.logoOptions.logoUrl);

  // Preview exactly what an apply would write, brand assets included.
  const previewHtml = (html: string) => {
    const recolored = applyEmailPalette(html, STOCK_EMAIL_PALETTE, resolved);
    if (!isEnterpriseEdition || !status.isEnterprise) return recolored;

    const logoUrl = draft.logoVariant === 'wide'
      ? status.logoOptions.logoWideUrl || status.logoOptions.logoUrl
      : status.logoOptions.logoUrl;

    return decorateBrandedHtml(recolored, {
      logo: draft.logoVariant && logoUrl ? { url: logoUrl, alt: status.logoOptions.clientName ?? '' } : undefined,
      hideAttribution: draft.hideAttribution,
    });
  };

  const dismissNewTemplates = () => {
    setDismissedNewCount(status.newTemplateNames.length);
    window.sessionStorage?.setItem(NEW_TEMPLATE_DISMISS_KEY, String(status.newTemplateNames.length));
  };

  return (
    <>
    {showNewTemplateBanner && (
      <div
        id="new-email-templates-banner"
        className="flex flex-wrap items-center justify-between gap-3 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
      >
        <span>
          {t('notifications.emailBranding.newTemplates.message', {
            defaultValue: '{{count}} templates were added since you last applied your palette.',
            count: status.newTemplateNames.length,
          })}
        </span>
        <span className="flex gap-2">
          <Button
            id="apply-branding-to-new-templates"
            size="sm"
            disabled={!status.canEdit}
            onClick={() => {
              setApplyPreselection(status.newTemplateNames);
              setApplyOpen(true);
            }}
          >
            {t('notifications.emailBranding.newTemplates.action', 'Apply palette to new templates')}
          </Button>
          <Button id="dismiss-new-email-templates" size="sm" variant="ghost" onClick={dismissNewTemplates}>
            {t('notifications.emailBranding.newTemplates.dismiss', 'Dismiss')}
          </Button>
        </span>
      </div>
    )}

    <Card id="email-branding-card">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-4 w-4" />
            {t('notifications.emailBranding.title', 'Email branding')}
          </CardTitle>
          <p className="mt-1 text-sm text-gray-600">
            {t('notifications.emailBranding.description', 'Put your colors on every outbound email. Preview them here, then choose which templates to apply them to.')}
          </p>
        </div>
        <span
          id="email-branding-source-chip"
          className="shrink-0 rounded-full bg-primary-100 px-2 py-1 text-xs text-primary-700"
        >
          {sourceLabel}
        </span>
      </CardHeader>

      <CardContent className="space-y-5">
        {error && (
          <div id="email-branding-error" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <ColorField
              id="email-branding-primary-color"
              label={t('notifications.emailBranding.fields.primary', 'Primary color')}
              value={draft.primary}
              disabled={!status.canEdit}
              onChange={(value) => update({ primary: value ?? status.suggestion.primary })}
            />

            {!draft.singleColor && (
              <ColorField
                id="email-branding-secondary-color"
                label={t('notifications.emailBranding.fields.secondary', 'Secondary color')}
                value={draft.secondary}
                disabled={!status.canEdit}
                onChange={(value) => update({ secondary: value ?? status.suggestion.secondary })}
              />
            )}

            <div className="flex items-center gap-2">
              <Switch
                id="email-branding-single-color"
                checked={draft.singleColor}
                disabled={!status.canEdit}
                onCheckedChange={(checked) => update({ singleColor: checked })}
              />
              <Label htmlFor="email-branding-single-color">
                {t('notifications.emailBranding.fields.singleColor', 'Single color (derive the gradient from the primary color)')}
              </Label>
            </div>

            {!draftMatchesSuggestion(draft, status) && (
              <Button
                id="use-suggested-email-colors"
                variant="ghost"
                size="sm"
                className="flex items-center gap-2 px-0"
                disabled={!status.canEdit}
                onClick={() => update({
                  primary: status.suggestion.primary,
                  secondary: status.suggestion.secondary,
                  singleColor: false,
                })}
              >
                <RefreshCw className="h-3 w-3" />
                {t('notifications.emailBranding.actions.useSuggested', 'Use suggested colors')}
              </Button>
            )}

            {isEnterpriseEdition && status.isEnterprise && (
              <div id="email-branding-enterprise-section" className="space-y-3 border-t pt-4">
                <div className="flex items-center gap-2">
                  <Switch
                    id="email-branding-use-logo"
                    checked={!!draft.logoVariant}
                    disabled={!status.canEdit || !hasAnyLogo}
                    onCheckedChange={(checked) => update({
                      logoVariant: checked ? (status.logoOptions.logoWideUrl ? 'wide' : 'default') : null,
                    })}
                  />
                  <Label htmlFor="email-branding-use-logo">
                    {t('notifications.emailBranding.enterprise.useLogo', 'Use my logo in the email header')}
                  </Label>
                </div>

                {hasAnyLogo ? (
                  draft.logoVariant && (
                    <div className="flex gap-2">
                      {status.logoOptions.logoWideUrl && (
                        <Button
                          id="email-branding-logo-variant-wide"
                          size="sm"
                          variant={draft.logoVariant === 'wide' ? 'default' : 'outline'}
                          disabled={!status.canEdit}
                          onClick={() => update({ logoVariant: 'wide' })}
                        >
                          {t('notifications.emailBranding.enterprise.logoWide', 'Wide logo')}
                        </Button>
                      )}
                      {status.logoOptions.logoUrl && (
                        <Button
                          id="email-branding-logo-variant-default"
                          size="sm"
                          variant={draft.logoVariant === 'default' ? 'default' : 'outline'}
                          disabled={!status.canEdit}
                          onClick={() => update({ logoVariant: 'default' })}
                        >
                          {t('notifications.emailBranding.enterprise.logoDefault', 'Square logo')}
                        </Button>
                      )}
                    </div>
                  )
                ) : (
                  <p className="text-xs text-gray-500">
                    {t('notifications.emailBranding.enterprise.noLogo', 'Upload a logo in Settings → Client Portal → Branding to use it here.')}
                  </p>
                )}

                <div className="flex items-center gap-2">
                  <Switch
                    id="email-branding-show-attribution"
                    checked={!draft.hideAttribution}
                    disabled={!status.canEdit}
                    onCheckedChange={(checked) => update({ hideAttribution: !checked })}
                  />
                  <Label htmlFor="email-branding-show-attribution">
                    {t('notifications.emailBranding.enterprise.showAttribution', 'Show "Powered by AlgaPSA" in the footer')}
                  </Label>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Button
                id="email-branding-adjust-tokens"
                variant="ghost"
                size="sm"
                className="flex items-center gap-2 px-0"
                onClick={() => setShowAdjust((open) => !open)}
              >
                {showAdjust ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {t('notifications.emailBranding.actions.adjust', 'Adjust derived colors')}
              </Button>

              {showAdjust ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {OVERRIDABLE_TOKENS.map((token) => (
                    <ColorField
                      key={token}
                      id={`email-branding-override-${TOKEN_IDS[token]}`}
                      label={t(`notifications.emailBranding.tokens.${token}`, TOKEN_FALLBACKS[token])}
                      value={draft.overrides[token] ?? resolved[token]}
                      disabled={!status.canEdit}
                      onChange={(value) => updateOverride(token, value ?? '')}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {OVERRIDABLE_TOKENS.map((token) => (
                    <div
                      key={token}
                      id={`email-branding-swatch-${TOKEN_IDS[token]}`}
                      title={`${t(`notifications.emailBranding.tokens.${token}`, TOKEN_FALLBACKS[token])}: ${resolved[token]}`}
                      className="h-6 w-6 rounded border border-gray-300"
                      style={{ backgroundColor: resolved[token] }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <Label>{t('notifications.emailBranding.preview.title', 'Preview')}</Label>
            {previewTemplates.map((template) => (
              <EmailTemplatePreview
                key={`${template.name}-${template.language_code}`}
                id={`email-branding-preview-${template.name}`}
                htmlContent={previewHtml(template.html_content)}
                templateName={template.name}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Button
            id="save-email-branding"
            disabled={!status.canEdit || saving || !isDirty}
            onClick={handleSave}
          >
            {saving
              ? t('notifications.emailBranding.actions.saving', 'Saving...')
              : t('notifications.emailBranding.actions.save', 'Save palette')}
          </Button>

          <Button
            id="open-apply-email-branding"
            variant="outline"
            disabled={!status.canEdit || !status.palette || isDirty}
            onClick={() => {
              setApplyPreselection(undefined);
              setApplyOpen(true);
            }}
          >
            {t('notifications.emailBranding.actions.apply', 'Apply to templates')}
          </Button>

          {status.palette?.appliedAt && (
            <Button
              id="remove-email-branding"
              variant="outline"
              disabled={!status.canEdit || removing}
              onClick={handleRemove}
            >
              {removing
                ? t('notifications.emailBranding.actions.removing', 'Removing...')
                : t('notifications.emailBranding.actions.remove', 'Remove branding from all templates')}
            </Button>
          )}

          {isDirty && (
            <span className="text-xs text-gray-500">
              {t('notifications.emailBranding.unsavedHint', 'Save the palette before applying it.')}
            </span>
          )}
        </div>
      </CardContent>

      <ApplyEmailBrandingDialog
        isOpen={applyOpen}
        onClose={() => {
          setApplyOpen(false);
          setApplyPreselection(undefined);
          loadStatus();
        }}
        status={status}
        preselectedNames={applyPreselection}
        onApplied={async () => { await onApplied?.(); }}
      />
    </Card>
    </>
  );
}
