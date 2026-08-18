'use client';

import React, { useMemo, useState } from 'react';
import ColorPicker from '@alga-psa/ui/components/ColorPicker';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  CUSTOM_THEME_TOKEN_KEYS,
  validateCustomThemeContrast,
  type CustomThemeContrastForeground,
  type CustomThemeMode,
  type CustomThemeTokenKey,
  type CustomThemeTokens,
} from '@alga-psa/tenancy/lib/customTheme';
import CustomThemeMock from './CustomThemeMock';

const TOKEN_FALLBACK_LABELS: Record<CustomThemeTokenKey, string> = {
  background: 'Page background',
  card: 'Card surface',
  surface: 'Raised surface',
  textPrimary: 'Primary text',
  textSecondary: 'Secondary text',
  textMuted: 'Muted text',
  border: 'Border',
  borderStrong: 'Strong border',
  primary: 'Primary color',
  secondary: 'Secondary color',
  accent: 'Accent color',
  sidebarBg: 'Side panel background',
  sidebarText: 'Side panel text',
  sidebarHover: 'Side panel hover',
  headerBg: 'Header background',
};

interface CustomThemeEditorProps {
  theme: { light: CustomThemeTokens; dark: CustomThemeTokens };
  mode: CustomThemeMode;
  onModeChange: (mode: CustomThemeMode) => void;
  onTokenChange: (mode: CustomThemeMode, key: CustomThemeTokenKey, value: string) => void;
  /** Pair the colors were seeded from, named in the "starting point" note. */
  seededFrom?: string;
  disabled?: boolean;
}

export function CustomThemeEditor({
  theme,
  mode,
  onModeChange,
  onTokenChange,
  seededFrom,
  disabled = false,
}: CustomThemeEditorProps) {
  const { t } = useTranslation('msp/settings');
  const tokens = theme[mode];
  // Which token the mock and the color list are pointing at, so it is obvious
  // which surface a color paints before it is changed.
  const [highlight, setHighlight] = useState<CustomThemeTokenKey | null>(null);

  const colorName = (key: CustomThemeContrastForeground) =>
    key === 'buttonLabel'
      ? t('appearance.custom.tokens.buttonLabel', { defaultValue: 'White button labels' })
      : t(`appearance.custom.tokens.${key}`, { defaultValue: TOKEN_FALLBACK_LABELS[key] });

  // Same checks the server re-runs on save, so a failing palette is visible
  // before the admin hits the button.
  const issues = useMemo(() => validateCustomThemeContrast(theme), [theme]);
  const modeIssues = issues.filter((issue) => issue.mode === mode);

  return (
    <div className="space-y-4">
      {seededFrom && (
        <p className="text-sm text-[rgb(var(--color-text-500))]" data-automation-id="custom-theme-seeded-from">
          {t('appearance.custom.seededFrom', {
            defaultValue:
              'These colors start from the {{pair}} theme — change the few you care about and the full scales follow.',
            pair: seededFrom,
          })}
        </p>
      )}

      <div className="flex gap-2">
        {(['light', 'dark'] as const).map((candidate) => (
          <button
            key={candidate}
            id={`custom-theme-mode-${candidate}`}
            type="button"
            onClick={() => onModeChange(candidate)}
            className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
              mode === candidate
                ? 'border-[rgb(var(--color-primary-500))] bg-[rgb(var(--color-primary-50))] text-[rgb(var(--color-primary-700))]'
                : 'border-[rgb(var(--color-border-300))] text-[rgb(var(--color-text-600))]'
            }`}
            data-automation-id={`custom-theme-mode-${candidate}`}
          >
            {candidate === 'light'
              ? t('appearance.custom.lightMode', { defaultValue: 'Light variant' })
              : t('appearance.custom.darkMode', { defaultValue: 'Dark variant' })}
          </button>
        ))}
      </div>

      <div>
        <CustomThemeMock tokens={tokens} highlight={highlight} onHighlight={setHighlight} />
        <p className="mt-1 text-xs text-[rgb(var(--color-text-500))]" data-automation-id="custom-theme-mock-caption">
          {highlight
            ? t('appearance.custom.mock.showing', {
                defaultValue: 'Highlighted: {{token}}',
                token: colorName(highlight),
              })
            : t('appearance.custom.mock.caption', {
                defaultValue: 'Point at a color below to see which part of the app it paints.',
              })}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CUSTOM_THEME_TOKEN_KEYS.map((key) => (
          <div
            key={key}
            onMouseEnter={() => setHighlight(key)}
            onMouseLeave={() => setHighlight(null)}
            onFocus={() => setHighlight(key)}
            onBlur={() => setHighlight(null)}
          >
            <label className="mb-1 block text-xs font-medium text-[rgb(var(--color-text-600))]">
              {t(`appearance.custom.tokens.${key}`, { defaultValue: TOKEN_FALLBACK_LABELS[key] })}
            </label>
            <ColorPicker
              currentBackgroundColor={tokens[key]}
              onSave={(color) => {
                if (color) onTokenChange(mode, key, color);
              }}
              trigger={
                <button
                  type="button"
                  disabled={disabled}
                  className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 transition-colors ${
                    highlight === key
                      ? 'border-[rgb(var(--color-primary-500))] bg-[rgb(var(--color-primary-50))]'
                      : 'border-[rgb(var(--color-border-400))]'
                  }`}
                  data-automation-id={`custom-theme-${mode}-${key}`}
                >
                  <span
                    className="h-6 w-6 rounded border border-[rgb(var(--color-border-300))]"
                    style={{ backgroundColor: tokens[key] }}
                  />
                  <span className="text-xs">{tokens[key]}</span>
                </button>
              }
              showTextColor={false}
              previewType="circle"
              colorMode="tag"
            />
          </div>
        ))}
      </div>

      {modeIssues.length > 0 && (
        <div
          className="rounded-md border border-[rgb(var(--color-status-error))] bg-[rgb(var(--color-alert-destructive-bg))] p-3 text-sm"
          data-automation-id="custom-theme-contrast-issues"
        >
          <p className="font-medium">
            {t('appearance.custom.contrastTitle', {
              defaultValue: 'These colors are too close together to read. Fix them before saving:',
            })}
          </p>
          <ul className="mt-1 list-inside list-disc">
            {modeIssues.map((issue) => (
              <li key={`${issue.mode}-${issue.pair}`}>
                {t('appearance.custom.contrastIssue', {
                  defaultValue:
                    '{{foreground}} on {{background}} is only {{ratio}}:1, and {{required}}:1 is the minimum. {{hint}}',
                  foreground: colorName(issue.foreground),
                  background: colorName(issue.background),
                  ratio: issue.ratio,
                  required: issue.required,
                  hint: issue.fix === 'lighten'
                    ? t('appearance.custom.contrastHints.lighten', {
                        defaultValue: 'Pick a lighter {{foreground}} or a darker {{background}}.',
                        foreground: colorName(issue.foreground),
                        background: colorName(issue.background),
                      })
                    : t('appearance.custom.contrastHints.darken', {
                        defaultValue: 'Pick a darker {{foreground}} or a lighter {{background}}.',
                        foreground: colorName(issue.foreground),
                        background: colorName(issue.background),
                      }),
                })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default CustomThemeEditor;
