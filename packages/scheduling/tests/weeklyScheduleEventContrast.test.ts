import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isLightSurface, surfaceLuminance } from '@alga-psa/ui/lib/surfaceColor';

const COMPONENT = path.resolve(__dirname, '../src/components/schedule/WeeklyScheduleEvent.tsx');
const GLOBALS = path.resolve(__dirname, '../../../server/src/app/globals.css');

const component = fs.readFileSync(COMPONENT, 'utf8');
const globals = fs.readFileSync(GLOBALS, 'utf8');

/** The chip fill tokens the component actually paints with, base and hover. */
function readFillMap(name: string): Record<string, string> {
  const block = new RegExp(`const ${name}: Record<WorkItemType, string> = \\{([^}]*)\\}`).exec(component);
  if (!block) throw new Error(`${name} is no longer a token map in WeeklyScheduleEvent`);
  const fills: Record<string, string> = {};
  for (const [, type, token] of block[1].matchAll(/(\w+):\s*'(--[a-z0-9-]+)'/g)) {
    fills[type] = token;
  }
  return fills;
}

function readInk(name: string): string {
  const ink = new RegExp(`const ${name} = '([^']+)'`).exec(component);
  if (!ink) throw new Error(`${name} is no longer declared in WeeklyScheduleEvent`);
  return ink[1];
}

/** Theme token tables, one per shipped pair and mode, resolved the way the cascade does. */
function readThemes(): { name: string; tokens: Record<string, string> }[] {
  const blocks: { mode: string; pair: string; tokens: Record<string, string> }[] = [];
  const lines = globals.split('\n');
  lines.forEach((line, index) => {
    const header = /^html\.(light|dark)(?:\[data-theme-pair="([a-z-]+)"\])?\s*\{/.exec(line);
    if (!header) return;
    const tokens: Record<string, string> = {};
    for (let i = index + 1; i < lines.length && !/^\}/.test(lines[i]); i += 1) {
      const declaration = /^\s*(--[a-z0-9-]+):\s*([^;]+);/.exec(lines[i]);
      if (declaration) tokens[declaration[1]] = declaration[2].trim();
    }
    blocks.push({ mode: header[1], pair: header[2] ?? 'default', tokens });
  });

  const base: Record<string, Record<string, string>> = { light: {}, dark: {} };
  for (const block of blocks) {
    if (block.pair === 'default') Object.assign(base[block.mode], block.tokens);
  }

  const pairs = [...new Set(blocks.map((block) => block.pair))];
  return pairs.flatMap((pair) =>
    ['light', 'dark'].map((mode) => ({
      name: `${pair}-${mode}`,
      tokens: {
        ...base[mode],
        ...blocks
          .filter((block) => block.pair === pair && block.mode === mode)
          .reduce((all, block) => Object.assign(all, block.tokens), {}),
      },
    })),
  );
}

function resolveToken(tokens: Record<string, string>, token: string, depth = 0): string | null {
  const value = tokens[token];
  if (!value || depth > 5) return null;
  const alias = /^var\((--[a-z0-9-]+)\)$/.exec(value);
  return alias ? resolveToken(tokens, alias[1], depth + 1) : value;
}

function contrast(a: string, b: string): number {
  const first = surfaceLuminance(a);
  const second = surfaceLuminance(b);
  if (first === null || second === null) throw new Error(`Unreadable colour pair: ${a} / ${b}`);
  const [lighter, darker] = first > second ? [first, second] : [second, first];
  return (lighter + 0.05) / (darker + 0.05);
}

describe('weekly schedule chip legibility', () => {
  const fills = { base: readFillMap('workItemFills'), hover: readFillMap('workItemHoverFills') };
  const inkOnLight = readInk('INK_ON_LIGHT_FILL');
  const inkOnDark = readInk('INK_ON_DARK_FILL');
  const themes = readThemes();

  it('measures the fill it paints rather than assuming the mode', () => {
    expect(component).toContain('const fillIsLight = useSurfaceIsLight(eventRef, fill);');
    expect(component).toContain('const textColor = fillIsLight ? INK_ON_LIGHT_FILL : INK_ON_DARK_FILL;');
    // A gray-950 foreground is exactly the bug: globals.css remaps the 900-400
    // steps under `.dark` but not 950, so it stayed near-black on a dark chip.
    expect(component).not.toContain('text-gray-950');
  });

  it('covers every shipped theme pair in both modes', () => {
    expect(themes.length).toBeGreaterThanOrEqual(18);
    expect(themes.map((theme) => theme.name)).toContain('high-contrast-dark');
  });

  it('clears WCAG AA on every work item type, theme and hover state', () => {
    const failures: string[] = [];

    for (const theme of themes) {
      for (const [state, tokens] of Object.entries(fills)) {
        for (const [type, token] of Object.entries(tokens)) {
          const fill = resolveToken(theme.tokens, token);
          expect(fill, `${theme.name} has no ${token} for ${type}`).not.toBeNull();

          const ink = isLightSurface(fill) ? inkOnLight : inkOnDark;
          const ratio = contrast(ink, fill!);
          if (ratio < 4.5) {
            failures.push(`${theme.name} ${type} ${state}: ${ratio.toFixed(2)}:1 on rgb(${fill})`);
          }
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
