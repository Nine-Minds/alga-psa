'use client';

import React from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { CustomThemeTokenKey, CustomThemeTokens } from '@alga-psa/tenancy/lib/customTheme';

/**
 * Page-sized mock of the app painted with the editor's colors. Every region
 * carries the token that paints it, so hovering a color in the editor lights up
 * the surface it lands on — and hovering the surface lights up the color.
 * Inline styles on purpose: the mock has to render a palette the page itself is
 * not wearing.
 */
interface CustomThemeMockProps {
  tokens: CustomThemeTokens;
  highlight: CustomThemeTokenKey | null;
  onHighlight: (key: CustomThemeTokenKey | null) => void;
}

export function CustomThemeMock({ tokens, highlight, onHighlight }: CustomThemeMockProps) {
  const { t } = useTranslation('msp/settings');

  const region = (key: CustomThemeTokenKey) => ({
    'data-token': key,
    'data-automation-id': `custom-theme-mock-${key}`,
    onMouseEnter: () => onHighlight(key),
    onMouseLeave: () => onHighlight(null),
    style: highlight === key
      ? { outline: '2px solid rgb(var(--color-primary-500))', outlineOffset: '-2px' }
      : undefined,
  });

  /** Merge the highlight outline into a region that also carries its own colors. */
  const paint = (key: CustomThemeTokenKey, style: React.CSSProperties) => {
    const base = region(key);
    return { ...base, style: { ...style, ...(base.style ?? {}) } };
  };

  return (
    <div
      className="flex h-64 w-full overflow-hidden rounded-lg border"
      style={{ borderColor: tokens.border }}
      data-automation-id="custom-theme-mock"
    >
      <div
        className="flex w-40 shrink-0 flex-col gap-1 p-2"
        {...paint('sidebarBg', { backgroundColor: tokens.sidebarBg })}
      >
        <div className="px-2 py-1 text-xs font-semibold" {...paint('sidebarText', { color: tokens.sidebarText })}>
          {t('appearance.custom.mock.nav', { defaultValue: 'Home' })}
        </div>
        <div
          className="rounded px-2 py-1 text-xs"
          {...paint('sidebarHover', { backgroundColor: tokens.sidebarHover, color: tokens.sidebarText })}
        >
          {t('appearance.custom.mock.navActive', { defaultValue: 'Tickets' })}
        </div>
        <div className="px-2 py-1 text-xs opacity-70" style={{ color: tokens.sidebarText }}>
          {t('appearance.custom.mock.navMuted', { defaultValue: 'Reports' })}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div
          className="border-b px-3 py-2 text-xs font-medium"
          {...paint('headerBg', { backgroundColor: tokens.headerBg, borderColor: tokens.border, color: tokens.textPrimary })}
        >
          {t('appearance.custom.mock.headerTitle', { defaultValue: 'Tickets' })}
        </div>

        <div className="flex-1 space-y-2 p-3" {...paint('background', { backgroundColor: tokens.background })}>
          <div
            className="rounded-md border p-3"
            {...paint('card', { backgroundColor: tokens.card, borderColor: tokens.border })}
          >
            <div className="text-sm font-semibold" {...paint('textPrimary', { color: tokens.textPrimary })}>
              {t('appearance.custom.mock.cardTitle', { defaultValue: 'Printer offline at the front desk' })}
            </div>
            <div className="mt-0.5 text-xs" {...paint('textSecondary', { color: tokens.textSecondary })}>
              {t('appearance.custom.mock.cardBody', { defaultValue: 'Assigned to Dana Reyes' })}
            </div>
            <div className="mt-0.5 text-xs" {...paint('textMuted', { color: tokens.textMuted })}>
              {t('appearance.custom.mock.cardMuted', { defaultValue: 'Updated 2 hours ago' })}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className="rounded px-2 py-1 text-xs font-medium text-white"
                {...paint('primary', { backgroundColor: tokens.primary })}
              >
                {t('appearance.custom.mock.primaryAction', { defaultValue: 'Save' })}
              </span>
              <span
                className="rounded px-2 py-1 text-xs font-medium text-white"
                {...paint('secondary', { backgroundColor: tokens.secondary })}
              >
                {t('appearance.custom.mock.secondaryAction', { defaultValue: 'Assign' })}
              </span>
              <span
                className="rounded border px-2 py-1 text-xs"
                {...paint('borderStrong', { borderColor: tokens.borderStrong, color: tokens.textSecondary })}
              >
                {t('appearance.custom.mock.ghostAction', { defaultValue: 'Cancel' })}
              </span>
              <span className="h-3 w-3 rounded-full" {...paint('accent', { backgroundColor: tokens.accent })} />
              <span className="h-3 w-8 rounded-full" {...paint('border', { backgroundColor: tokens.border })} />
            </div>
          </div>

          <div
            className="rounded-md px-3 py-2 text-xs"
            {...paint('surface', { backgroundColor: tokens.surface, color: tokens.textSecondary })}
          >
            {t('appearance.custom.mock.surface', { defaultValue: 'Recent activity' })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default CustomThemeMock;
