import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  CUSTOM_THEME_PRESETS,
  type CustomThemeTokenKey,
} from '@alga-psa/tenancy/lib/customTheme';

const GLOBALS = path.resolve(__dirname, '../../../app/globals.css');
const css = fs.readFileSync(GLOBALS, 'utf8');

/** Token map for a selector's block, without the tokens it inherits. */
function tokensOf(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `missing block: ${selector}`).toBeGreaterThan(-1);
  const body = css.slice(start, start + css.slice(start).indexOf('\n}'));
  const tokens: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const match = /^\s*(--[a-z0-9-]+):\s*([^;]+);/.exec(line);
    if (match) tokens[match[1]] = match[2].trim();
  }
  return tokens;
}

// The custom editor opens on the tenant's current pair, so the preset tables in
// packages/tenancy have to be the same colors this stylesheet paints.
describe('custom theme presets mirror the pair blocks', () => {
  const CORE_TO_TOKEN: Array<[CustomThemeTokenKey, string]> = [
    ['background', 'color-background'],
    ['card', 'color-card'],
    ['surface', 'color-border-50'],
    ['textPrimary', 'color-text-900'],
    ['textSecondary', 'color-text-600'],
    ['textMuted', 'color-text-500'],
    ['border', 'color-border-200'],
    ['borderStrong', 'color-border-400'],
    ['primary', 'color-primary-500'],
    ['secondary', 'color-secondary-500'],
    ['accent', 'color-accent-500'],
    ['sidebarBg', 'color-sidebar-bg'],
    ['sidebarText', 'color-sidebar-text'],
    ['sidebarHover', 'color-sidebar-hover'],
    ['headerBg', 'color-header-bg'],
  ];

  const hexToTriple = (hex: string) => {
    const value = hex.replace('#', '');
    return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16)).join(' ');
  };

  const presetIds = Object.keys(CUSTOM_THEME_PRESETS) as Array<keyof typeof CUSTOM_THEME_PRESETS>;

  it.each(presetIds)('%s preset matches its CSS block in both modes', (pairId) => {
    (['light', 'dark'] as const).forEach((mode) => {
      const declared = {
        ...tokensOf(`html.${mode}`),
        ...(pairId === 'alga' ? {} : tokensOf(`html.${mode}[data-theme-pair="${pairId}"]`)),
      };

      CORE_TO_TOKEN.forEach(([core, token]) => {
        expect(hexToTriple(CUSTOM_THEME_PRESETS[pairId][mode][core]), `${pairId} ${mode} ${core}`)
          .toBe(declared[`--${token}`]);
      });
    });
  });
});
