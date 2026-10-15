/**
 * Dark-mode legibility of the vault-wide audit hero.
 *
 * The banner paints white lettering on a solid brand fill, and the primary ramp
 * INVERTS between modes: `primary-900` is the deepest rung of every light pair
 * and the lightest tint of every dark one — pure white in high-contrast dark,
 * where the heading read as blank. Nothing else catches it: layer 6 of
 * server/src/test/unit/app/themeContract.test.ts measures classNames that name a
 * `--color-*` as BOTH ink and fill, and this pair is a Tailwind palette utility
 * against a literal white.
 *
 * So measure what the screen actually paints: take the rung it names for each
 * mode out of the source and check white ink clears WCAG AA on it in every
 * shipped pair. The derived "custom" pair has no block here — it is generated at
 * render time from a tenant seed and the theme contract suite measures it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../../..');
const css = fs.readFileSync(path.join(repoRoot, 'server/src/app/globals.css'), 'utf8');
const screen = fs.readFileSync(
  path.join(repoRoot, 'ee/server/src/components/credentials/CredentialAuditScreen.tsx'),
  'utf8',
);

const heroStart = screen.indexOf('id="credentials-audit-hero"');
const hero = heroStart === -1 ? '' : screen.slice(heroStart, screen.indexOf('</Card>', heroStart));
const heroClass = /className="([^"]+)"/.exec(hero)?.[1] ?? '';
const lightRung = /(?:^|\s)bg-primary-(\d{2,3})(?:\s|$)/.exec(heroClass)?.[1];
const darkRung = /(?:^|\s)dark:bg-primary-(\d{2,3})(?:\s|$)/.exec(heroClass)?.[1];
const rungFor = (mode: 'light' | 'dark') => (mode === 'dark' ? darkRung ?? lightRung : lightRung);

const WHITE = [255, 255, 255];

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

/** `null` is the alga pair, which lives in the plain html.light / html.dark blocks. */
function themeTokens(mode: 'light' | 'dark', pair: string | null): Record<string, string> {
  const base = tokensOf(`html.${mode}`);
  return pair ? { ...base, ...tokensOf(`html.${mode}[data-theme-pair="${pair}"]`) } : base;
}

const pairIds = [...new Set(
  [...css.matchAll(/html\.(?:light|dark)\[data-theme-pair="([a-z-]+)"\]\s*\{/g)].map((match) => match[1]),
)];

const triple = (value: string | undefined) =>
  value
    ? value.trim().split(/[\s,]+/).map(Number).filter((n) => !Number.isNaN(n)).slice(0, 3)
    : null;

const srgb = (c: number) => {
  const x = c / 255;
  return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const relLuminance = ([r, g, b]: number[]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
function contrast(a: number[], b: number[]): number {
  const [hi, lo] = [relLuminance(a), relLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('credential audit hero contrast', () => {
  it('paints a mode-specific brand rung under its white lettering', () => {
    expect(heroStart, 'hero card not found in CredentialAuditScreen').toBeGreaterThan(-1);
    expect(lightRung, 'hero names no light-mode brand fill').toBeDefined();
    expect(darkRung, 'the primary ramp inverts — the hero needs its own dark-mode fill').toBeDefined();
    expect(hero, 'hero ink is white; measure the new ink here if that changes').toContain('text-white');
    expect(heroClass, 'elevation must come from card-elevated — shadow-* cannot follow the mode')
      .not.toMatch(/(?:^|\s)shadow-/);
  });

  it('measures every shipped theme pair', () => {
    // A selector change that stopped matching would make the assertion below
    // pass over the alga pair alone.
    expect(pairIds).toContain('high-contrast');
    expect(pairIds.length).toBeGreaterThanOrEqual(8);
  });

  it('fails on the mode-blind fill that shipped', () => {
    // The regression itself: one `bg-primary-900` for both modes. Every dark
    // pair must reject it, or this file is measuring nothing.
    const survivors = pairIds
      .map((pair) => ({ pair, fill: triple(themeTokens('dark', pair)[`--color-primary-${lightRung}`]) }))
      .filter(({ fill }) => fill && contrast(WHITE, fill) >= 4.5)
      .map(({ pair }) => pair);
    expect(survivors, `dark pairs where the light-mode rung would still pass:\n${survivors.join('\n')}`)
      .toEqual([]);
  });

  it('keeps the hero lettering above WCAG AA in every pair and mode', () => {
    const failures: string[] = [];
    (['light', 'dark'] as const).forEach((mode) => {
      [null, ...pairIds].forEach((pair) => {
        const rung = rungFor(mode);
        const fill = triple(themeTokens(mode, pair)[`--color-primary-${rung}`]);
        const label = `${pair ?? 'alga'}/${mode}`;
        if (!fill || fill.length !== 3) {
          failures.push(`${label}: no --color-primary-${rung}`);
          return;
        }
        const ratio = contrast(WHITE, fill);
        if (ratio < 4.5) {
          failures.push(`${label}: white on primary-${rung} = ${ratio.toFixed(2)}:1`);
        }
      });
    });
    expect(failures, `audit hero lettering below WCAG AA:\n${failures.join('\n')}`).toEqual([]);
  });
});
