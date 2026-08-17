import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { THEME_PAIRS } from '@alga-psa/tenancy/lib/themePairs';

const GLOBALS = path.resolve(__dirname, '../../../app/globals.css');
const css = fs.readFileSync(GLOBALS, 'utf8');

const CHROME_TOKENS = [
  'sidebar-bg', 'sidebar-text', 'sidebar-hover', 'sidebar-icon',
  'submenu-bg', 'submenu-text', 'submenu-hover', 'submenu-icon',
  'header-bg', 'header-text', 'header-border',
];

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

const sum = (triple: string) => triple.split(' ').map(Number).reduce((a, b) => a + b, 0);

describe('theme pair token blocks', () => {
  const pairIds = THEME_PAIRS.map((pair) => pair.id).filter((id) => id !== 'alga');

  it.each(pairIds)('%s declares both a light and a dark block', (pairId) => {
    expect(css).toContain(`html.light[data-theme-pair="${pairId}"] {`);
    expect(css).toContain(`html.dark[data-theme-pair="${pairId}"] {`);
  });

  it('leaves the alga pair to the plain html.light / html.dark blocks', () => {
    expect(css).not.toContain('data-theme-pair="alga"');
  });

  it.each(pairIds)('%s honors the shade-inversion contract in both modes', (pairId) => {
    const light = tokensOf(`html.light[data-theme-pair="${pairId}"]`);
    const dark = tokensOf(`html.dark[data-theme-pair="${pairId}"]`);

    // *-50 is always the subtlest surface: darkest in light mode is *-900,
    // and the scale flips in dark mode.
    expect(sum(light['--color-border-50'])).toBeGreaterThan(sum(light['--color-border-900']));
    expect(sum(light['--color-text-50'])).toBeGreaterThan(sum(light['--color-text-900']));
    expect(sum(dark['--color-border-50'])).toBeLessThan(sum(dark['--color-border-900']));
    expect(sum(dark['--color-text-50'])).toBeLessThan(sum(dark['--color-text-900']));
  });

  it('keeps every chrome token an RGB triple so pairs can restate it', () => {
    const blocks = ['html.light', 'html.dark', ...pairIds.flatMap((id) => [
      `html.light[data-theme-pair="${id}"]`,
      `html.dark[data-theme-pair="${id}"]`,
    ])];

    blocks.forEach((selector) => {
      const tokens = tokensOf(selector);
      CHROME_TOKENS.forEach((name) => {
        const value = tokens[`--color-${name}`];
        if (value === undefined) return;
        expect(value, `${selector} --color-${name}`).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
      });
    });
  });

  // The purple repaint changes every dark-mode user's look; Slate is the
  // documented escape hatch and has to restore the previous values exactly.
  it('slate dark restores the pre-purple dark palette verbatim', () => {
    const slate = tokensOf('html.dark[data-theme-pair="slate"]');

    expect(slate['--color-background']).toBe('0 0 0');
    expect(slate['--color-card']).toBe('22 28 48');
    expect(slate['--color-border-50']).toBe('15 23 42');
    expect(slate['--color-border-900']).toBe('248 250 252');
    expect(slate['--color-text-900']).toBe('248 250 252');
    expect(slate['--color-primary-500']).toBe('152 85 238');
    expect(slate['--color-sidebar-bg']).toBe('15 23 42');
    expect(slate['--color-submenu-bg']).toBe('30 41 59');
    expect(slate['--color-table-row-alt']).toBe('30 33 52');
  });

  // Anchors read off the product mock on nineminds.com, our design reference:
  // --background 12 10 24, --card 21 16 36 (the mock's dark sidebar), --muted
  // 27 21 48, --accent 30 24 54 (the mock's content surface), --border 39 32 65,
  // --foreground 232 228 246, --primary #8a4dea. Light mode keeps the mock's
  // #0C111D sidebar.
  it('paints the default dark theme in the Alga purple anchors', () => {
    const dark = tokensOf('html.dark');

    expect(dark['--color-background']).toBe('12 10 24');
    expect(dark['--color-card']).toBe('30 24 54');
    expect(dark['--color-border-50']).toBe('21 16 36');
    expect(dark['--color-border-200']).toBe('39 32 65');
    expect(dark['--color-text-900']).toBe('232 228 246');
    expect(dark['--color-primary-500']).toBe('138 77 234');
    expect(dark['--color-sidebar-bg']).toBe('21 16 36');
  });

  // Cards carry the tint, so they have to sit above the page and the chrome while
  // staying inside the neutral ramp: wells (border-50) below, chips and shells
  // (border-100) above, flyouts above that.
  it('lifts dark cards above the page and the sidebar so the tint reads', () => {
    const dark = tokensOf('html.dark');

    expect(sum(dark['--color-card'])).toBeGreaterThan(sum(dark['--color-background']));
    expect(sum(dark['--color-card'])).toBeGreaterThan(sum(dark['--color-sidebar-bg']));
    expect(sum(dark['--color-card'])).toBeGreaterThan(sum(dark['--color-border-50']));
    expect(sum(dark['--color-card'])).toBeLessThan(sum(dark['--color-border-100']));
    expect(sum(dark['--color-submenu-bg'])).toBeGreaterThan(sum(dark['--color-card']));
  });

  it('keeps the reference light sidebar', () => {
    expect(tokensOf('html.light')['--color-sidebar-bg']).toBe('12 17 29');
  });
});
