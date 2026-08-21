/**
 * One suite for the whole theme contract, in three layers:
 *
 *   1. token blocks    — every pair declares the values it must, and the
 *                        shade-inversion / separation invariants hold.
 *   2. token references — every --color-* a component names actually exists.
 *   3. surface rules    — the handful of CSS rules whose failure mode is
 *                        silent and mode-asymmetric (menus, editor paper).
 *
 * They live together because they fail together: all three exist to catch
 * styling that looks correct in light mode and breaks in dark.
 */
import { execFileSync } from 'node:child_process';
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { THEME_PAIRS } from '@alga-psa/tenancy/lib/themePairs';

const REPO = path.resolve(__dirname, '../../../../..');
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

/** A rule's declaration body, for selectors that carry no tokens. */
function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `missing rule: ${selector}`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start));
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
    expect(dark['--color-border-50']).toBe('19 13 36');
    expect(dark['--color-border-100']).toBe('27 21 48');
    // Not a site anchor like the values above it — this one is the edge shade,
    // retuned 2026-08-21 from 39 32 65 because Δ8.4 off the card was a third of
    // light's Δ23.7 and every dark edge went mushy. Kept here so a change is
    // deliberate; the separation floor below is what actually guards the intent.
    expect(dark['--color-border-200']).toBe('49 41 82');
    expect(dark['--color-text-900']).toBe('232 228 246');
    expect(dark['--color-primary-500']).toBe('138 77 234');
    expect(dark['--color-sidebar-bg']).toBe('21 16 36');
  });

  // Cards carry the tint, so they have to sit above the page and the chrome while
  // staying inside the neutral ramp: wells (border-50) and the shell ground
  // (border-100) below, flyouts above.
  it('lifts dark cards above the page and the sidebar so the tint reads', () => {
    const dark = tokensOf('html.dark');

    expect(sum(dark['--color-card'])).toBeGreaterThan(sum(dark['--color-background']));
    expect(sum(dark['--color-card'])).toBeGreaterThan(sum(dark['--color-sidebar-bg']));
    expect(sum(dark['--color-card'])).toBeGreaterThan(sum(dark['--color-border-50']));
    expect(sum(dark['--color-card'])).toBeGreaterThan(sum(dark['--color-border-100']));
    expect(sum(dark['--color-submenu-bg'])).toBeGreaterThan(sum(dark['--color-card']));
  });

  // Everything the shell can paint behind a card — the app ground, the wells and
  // the chip surfaces — has to stay under the card, or cards sink into the page
  // instead of lifting off it (the mismatch against the nineminds.com reference,
  // where the content panel is the lightest large surface). Slate is exempt (it
  // restores the pre-purple values verbatim) and so is high contrast (flat black
  // surfaces, separated by borders, by design).
  const elevationPairs = pairIds.filter((id) => id !== 'slate' && id !== 'high-contrast');

  it.each(elevationPairs)('%s keeps the dark shell ground under the card', (pairId) => {
    const base = tokensOf('html.dark');
    const dark = { ...base, ...tokensOf(`html.dark[data-theme-pair="${pairId}"]`) };

    expect(sum(dark['--color-background'])).toBeLessThan(sum(dark['--color-border-50']));
    expect(sum(dark['--color-border-50'])).toBeLessThan(sum(dark['--color-border-100']));
    expect(sum(dark['--color-border-100'])).toBeLessThan(sum(dark['--color-card']));
    expect(sum(dark['--color-card'])).toBeLessThan(sum(dark['--color-border-200']));
  });

  // Radix Themes declares its own --color-background on the theme root, which
  // shadows ours for the whole app subtree unless we hand the value back.
  it('keeps --color-background resolvable inside the Radix theme root', () => {
    expect(css).toContain('--alga-color-background: var(--color-background);');
    // `html .radix-themes`, not `.radix-themes`: Radix's dark rule matches the
    // same element and would otherwise win the tie on source order.
    expect(css).toMatch(/html \.radix-themes \{\s*--color-background: var\(--alga-color-background\);/);
    // Mantine's own `body` rule ties on specificity, so ours has to out-specify it.
    expect(css).toContain('html body {');
  });

  it('keeps the reference light sidebar', () => {
    expect(tokensOf('html.light')['--color-sidebar-bg']).toBe('12 17 29');
  });

  // The shell, the scrolling body and <main> all paint the same muted surface,
  // so the pt-2/px-3 gutter never falls through to the near-black page ground.
  // One token — but each mode aims it at whichever shade actually clears the
  // card, which is not the same shade in both (see the separation test below).
  it('gives the app shell one ground token in both modes', () => {
    expect(tokensOf('html.light')['--color-app-ground']).toBe('var(--color-border-100)');
    expect(tokensOf('html.dark')['--color-app-ground']).toBe('var(--color-border-50)');
    expect(css).toContain('.app-shell-ground {\n    background-color: rgb(var(--color-app-ground));');
    expect(css).toMatch(/\.dark main \{\s*background-color: rgb\(var\(--color-app-ground\)\);/);
  });

  // The point of the ground token: a card has to be visibly a surface sitting on
  // it. Dark used to fail this badly — pointing the ground at border-100 left the
  // card 2.9-4.5 luma off it on alga/ocean/sky/sunset and INVERTED on slate, so
  // cards read as bare outlines. High contrast is exempt: its card and border-50
  // are both #000, so it keeps the lighter ground and separates by border.
  it('keeps dark cards off the ground they sit on', () => {
    const luma = (triple: string) => {
      const [r, g, b] = triple.split(' ').map(Number);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const darkGround = (tokens: Record<string, string>) => tokens['--color-border-50'];

    const base = tokensOf('html.dark');
    const pairs = THEME_PAIRS.map((p) => p.id).filter((id) => id !== 'alga' && id !== 'custom');

    [['alga', base] as const, ...pairs.map((id) => [id, { ...base, ...tokensOf(`html.dark[data-theme-pair="${id}"]`) }] as const)]
      .filter(([id]) => id !== 'high-contrast')
      .forEach(([id, tokens]) => {
        const delta = Math.abs(luma(tokens['--color-card']) - luma(darkGround(tokens)));
        expect(delta, `${id}: card sits ${delta.toFixed(1)} luma off the shell ground`).toBeGreaterThan(5);
      });
  });

  // A page ground identical to the card leaves nothing for cards to lift off, and
  // reads as two identical swatches in the theme editor.
  // The retune's actual intent: an edge has to be visible on the surface it
  // bounds. Light gets Δ23.7 from border-200 for free; dark was as low as Δ8.4,
  // which is what made cards, inputs and table rules dissolve into their panels.
  // High contrast is exempt — its borders are pure black/white.
  it('keeps dark borders visible against the card they bound', () => {
    const luma = (triple: string) => {
      const [r, g, b] = triple.split(' ').map(Number);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const base = tokensOf('html.dark');
    const pairs = THEME_PAIRS.map((p) => p.id).filter((id) => id !== 'alga' && id !== 'custom');

    [['alga', base] as const, ...pairs.map((id) => [id, { ...base, ...tokensOf(`html.dark[data-theme-pair="${id}"]`) }] as const)]
      .filter(([id]) => id !== 'high-contrast')
      .forEach(([id, tokens]) => {
        const delta = Math.abs(luma(tokens['--color-border-200']) - luma(tokens['--color-card']));
        expect(delta, `${id}: border-200 sits only ${delta.toFixed(1)} luma off the card`).toBeGreaterThan(15);
      });
  });

  // The header and the sidebar are one continuous piece of chrome in dark, so any
  // gap between them reads as a rendering fault. Four pairs shipped 5-12 luma
  // apart (slate, sky, cappuccino, vice). Light is deliberately NOT covered: its
  // dark-rail/white-header split is consistent across all nine pairs by design.
  it('paints the dark header and sidebar the same', () => {
    const luma = (triple: string) => {
      const [r, g, b] = triple.split(' ').map(Number);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const base = tokensOf('html.dark');
    const pairs = THEME_PAIRS.map((p) => p.id).filter((id) => id !== 'alga' && id !== 'custom');

    [['alga', base] as const, ...pairs.map((id) => [id, { ...base, ...tokensOf(`html.dark[data-theme-pair="${id}"]`) }] as const)]
      .forEach(([id, tokens]) => {
        const delta = Math.abs(luma(tokens['--color-sidebar-bg']) - luma(tokens['--color-header-bg']));
        expect(delta, `${id}: header sits ${delta.toFixed(1)} luma off the sidebar`).toBeLessThan(3);
      });
  });

  it('keeps every light page background off the card color', () => {
    ['html.light', ...pairIds.map((id) => `html.light[data-theme-pair="${id}"]`)]
      // High contrast is flat white by design; its cards are separated by borders.
      .filter((selector) => !selector.includes('high-contrast'))
      .forEach((selector) => {
        const tokens = tokensOf(selector);
        expect(tokens['--color-background'], selector).not.toBe(tokens['--color-card']);
      });
  });

  it('does not globally erase native data-table header borders', () => {
    expect(css).not.toContain('thead tr th,');
    expect(css).not.toContain('table th,');
  });

  // The editor's paper tint was flattened once already because it was read as a
  // disabled-looking grey. It stays, but tinted from the running pair's own
  // tokens and only in the corners, so the reading surface keeps full brightness.
  it('tints the editor paper from pair tokens in both modes', () => {
    const light = block('.editor-paper');
    const dark = block('.dark .editor-paper');

    [light, dark].forEach((rule) => {
      expect(rule).toContain('rgb(var(--color-primary-500) /');
      expect(rule).toContain('rgb(var(--color-secondary-500) /');
      // No pair-specific literals: every theme has to tint itself.
      expect(rule).not.toMatch(/radial-gradient\([^)]*rgb\(\s*\d/);
      expect(rule).toContain('inset');
    });

    expect(light).toContain('rgb(var(--color-card))');
    expect(dark).toContain('rgb(var(--color-border-100))');
  });

  // High contrast drops the hue lamps but keeps the shading: a shadow costs no
  // contrast, and the hard border is still there underneath it.
  it('shades the high-contrast editor paper without tinting it', () => {
    const base = block('html[data-theme-pair="high-contrast"] .editor-paper');
    expect(base).not.toContain('radial-gradient');
    expect(base).toContain('background: rgb(var(--color-card));');

    ['light', 'dark'].forEach((mode) => {
      const rule = block(`html.${mode}[data-theme-pair="high-contrast"] .editor-paper`);
      expect(rule, mode).not.toContain('radial-gradient');
      expect(rule, mode).toContain('inset');
      // The border ring survives the shadow override.
      expect(rule, mode).toContain('inset 0 0 0 1px rgb(var(--color-border-300))');
    });
  });

  it('inverts high-contrast switch surfaces between off and on', () => {
    expect(css).toContain('html[data-theme-pair="high-contrast"] .switch-root {');
    expect(css).toContain('box-shadow: inset 0 0 0 2px rgb(var(--color-border-200));');
    expect(css).toContain('html[data-theme-pair="high-contrast"] .switch-root[data-state="checked"] {');
    expect(css).toContain('html[data-theme-pair="high-contrast"] .switch-root[data-state="checked"] .switch-thumb {');
  });
});

/**
 * Every `--color-*` a component names must actually be declared in globals.css.
 *
 * An undefined token fails silently and asymmetrically, which is how several of
 * these survived: `rgb(var(--color-surface-50))` with no fallback is an invalid
 * color, so the declaration is dropped and the element renders transparent —
 * which usually looks fine on a white page. With a fallback it is worse:
 * `rgb(var(--color-card-50, 248 250 252))` painted a near-white block that read
 * as normal in light mode and glared in dark. Neither form errors anywhere.
 */

/**
 * Escape hatch, deliberately empty.
 *
 * The first run of this check found 20 undefined tokens across 35 files, all
 * reaching for scales that were imagined but never built: there is no
 * `--color-warning-*`, `--color-background-<n>`, `--color-bg-*`,
 * `--color-surface-*`, `--color-destructive-<n>`, `--color-danger-*` or
 * `--color-success-<n>` ramp. The real ones are `--color-border-*` for surfaces,
 * `--color-status-*` / `--color-destructive` for semantics, and `--badge-*` for
 * alert chrome. All 35 files were repointed rather than baselined.
 */
const KNOWN_UNDEFINED = new Set<string>([
  // Empty, and it should stay that way. Every entry here is a token a component
  // names that globals.css never declares — which renders transparent (no
  // fallback) or as a light literal in dark mode (with one). Add a real token to
  // globals.css or point the component at an existing one; do not list it here
  // to silence the check.
]);

function declaredTokens(): Set<string> {
  return new Set(css.match(/--color-[a-z0-9-]+(?=\s*:)/g) ?? []);
}

/** Every `var(--color-…)` reference in component source, mapped to its files. */
function referencedTokens(): Map<string, string[]> {
  const out = execFileSync(
    'grep',
    ['-rnoE', 'var\\(--color-[a-z0-9-]+', 'packages', 'server/src', 'ee/server/src',
      '--include=*.tsx', '--include=*.ts'],
    { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );

  const refs = new Map<string, string[]>();
  for (const line of out.split('\n')) {
    if (!line || line.includes('/dist/')) continue;
    const match = /^(.+?):\d+:var\((--color-[a-z0-9-]+)$/.exec(line);
    if (!match) continue;
    const [, file, token] = match;

    // This file names broken tokens on purpose, in prose and in the baseline.
    if (file.endsWith('themeContract.test.ts')) continue;
    // A trailing hyphen is the static half of `var(--color-primary-${shade})`,
    // not a token name.
    if (token.endsWith('-')) continue;

    const seen = refs.get(token) ?? [];
    if (!seen.includes(file)) seen.push(file);
    refs.set(token, seen);
  }
  return refs;
}

describe('theme token references', () => {
  const declared = declaredTokens();
  const refs = referencedTokens();

  it('names only tokens that globals.css actually declares', () => {
    // Guard the guard: if the grep or the parse breaks, an empty result would
    // make this pass while checking nothing.
    expect(declared.size).toBeGreaterThan(50);
    expect(refs.size).toBeGreaterThan(20);

    const offenders = [...refs.entries()]
      .filter(([token]) => !declared.has(token) && !KNOWN_UNDEFINED.has(token))
      .map(([token, files]) => `${token} — used in ${files.join(', ')}`);

    expect(offenders, `undefined --color-* token(s):\n${offenders.join('\n')}`).toEqual([]);
  });

  it('keeps the baseline honest — a fixed token must be struck from the list', () => {
    const stale = [...KNOWN_UNDEFINED].filter(
      (token) => declared.has(token) || !refs.has(token),
    );

    expect(stale, `no longer undefined or no longer referenced — remove from KNOWN_UNDEFINED:\n${stale.join('\n')}`)
      .toEqual([]);
  });
});

const UI_COMPONENTS = path.join(REPO, 'packages/ui/src/components');

function read(file: string): string {
  return fs.readFileSync(path.join(UI_COMPONENTS, file), 'utf8');
}

/** Components that render a floating panel over the page. */
const PANELS = ['CustomSelect.tsx', 'SearchableSelect.tsx', 'DropdownMenu.tsx', 'Popover.tsx'];

const DARK_SURFACE = 'dark:bg-[rgb(var(--color-card))]';

describe('dropdown surface contract', () => {
  it.each(PANELS)('%s paints its panel with the card surface in dark mode', (file) => {
    expect(read(file)).toContain(DARK_SURFACE);
  });

  // `bg-background` is the PAGE ground. In light it is a hair off the card, so a
  // stray one is invisible; in dark the gap is ~#0c0a18 against ~#1e1836 and the
  // element reads as a black rectangle punched into the menu. Menu items should
  // be transparent and let the panel show through; anything that does paint has
  // to say what it becomes in dark.
  it.each(PANELS)('%s never paints the page ground without a dark counterpart', (file) => {
    read(file).split('\n').forEach((line, index) => {
      if (line.includes('bg-background')) {
        expect(line, `${file}:${index + 1}`).toContain(DARK_SURFACE);
      }
    });
  });
});

/**
 * The picker family: floating panels painted `--color-card` that host rows,
 * header bands and chips.
 *
 * The trap is the `.dark .bg-gray-*` shims in globals.css. They remap a
 * hardcoded gray rather than leaving it light, so nothing looks obviously
 * broken — but the direction is wrong for anything meant to read as RAISED:
 *
 *   bg-gray-50  -> border-50  (#130d24) — DARKER than the card
 *   bg-gray-100 -> border-100 (#1b1530) — darker than the card
 *   bg-gray-200 -> border-200 (#272041) — lighter, so this one is fine
 *
 * A header band or a selected row built on gray-50 therefore renders as a hole
 * punched in the panel. Both shipped that way in ClientPicker. Light mode looks
 * correct throughout, so only a check like this catches it.
 */
const PICKER_PANELS = [
  'ClientPicker.tsx',
  'ContactPicker.tsx',
  'CountryPicker.tsx',
  'MultiUserPicker.tsx',
  'MultiUserAndTeamPicker.tsx',
  'TimezonePicker.tsx',
  'TreeSelect.tsx',
  'UserAndTeamPicker.tsx',
  'UserPicker.tsx',
  'tags/TagFilter.tsx',
  'tags/TagInput.tsx',
  'settings/general/BoardPicker.tsx',
];

/** `bg-white` / `bg-gray-50` / `bg-gray-100`, and gray borders, unpaired with a dark: override. */
const RECEDING_FILL = /\b(?:bg-white|bg-(?:gray|slate)-(?:50|100)|(?:border|divide)-(?:gray|slate)-\d+)\b/;

describe('picker surface contract', () => {
  it.each(PICKER_PANELS)('%s builds its surfaces from tokens, not shimmed grays', (file) => {
    const offenders = read(file)
      .split('\n')
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => RECEDING_FILL.test(line) && !line.includes('dark:'))
      .map(({ line, index }) => `${file}:${index + 1}  ${line.trim().slice(0, 100)}`);

    expect(offenders, `receding/hardcoded surface(s):\n${offenders.join('\n')}`).toEqual([]);
  });
});
