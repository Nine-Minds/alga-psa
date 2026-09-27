import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WorkItemType } from '@alga-psa/types';
import { isLightSurface, surfaceLuminance } from '@alga-psa/ui/lib/surfaceColor';
import {
  INK_ON_DARK_FILL,
  INK_ON_LIGHT_FILL,
  fillTokenFor,
  workItemFills,
} from '../src/lib/scheduleChipInk';
import {
  getEventColors,
  hoverInkClassForFill,
  inkClassForFill,
} from '../src/components/technician-dispatch/utils';

const SRC = path.resolve(__dirname, '../src');
const GLOBALS = path.resolve(__dirname, '../../../server/src/app/globals.css');

const source = (relative: string) => fs.readFileSync(path.join(SRC, relative), 'utf8');
const globals = fs.readFileSync(GLOBALS, 'utf8');

const WORK_ITEM_TYPES = Object.keys(workItemFills) as WorkItemType[];

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

function resolveToken(tokens: Record<string, string>, token: string, depth = 0): string {
  const value = tokens[token];
  if (!value || depth > 5) throw new Error(`No theme value for ${token}`);
  const alias = /^var\((--[a-z0-9-]+)\)$/.exec(value);
  return alias ? resolveToken(tokens, alias[1], depth + 1) : value;
}

function channels(color: string): number[] {
  const numbers = color.trim().match(/-?\d*\.?\d+/g);
  if (!numbers || numbers.length < 3) throw new Error(`Unreadable colour: ${color}`);
  return numbers.slice(0, 3).map(Number);
}

/** A translucent fill paints part of whatever is behind it. */
function composite(fill: string, alpha: number, ground: string): string {
  const front = channels(fill);
  const back = channels(ground);
  return front.map((value, index) => value * alpha + back[index] * (1 - alpha)).join(' ');
}

function contrast(a: string, b: string): number {
  const first = surfaceLuminance(a);
  const second = surfaceLuminance(b);
  if (first === null || second === null) throw new Error(`Unreadable colour pair: ${a} / ${b}`);
  const [lighter, darker] = first > second ? [first, second] : [second, first];
  return (lighter + 0.05) / (darker + 0.05);
}

/** The ink a chip picks for itself once it has read the fill it is painted with. */
const inkOn = (fill: string) => (isLightSurface(fill) ? INK_ON_LIGHT_FILL : INK_ON_DARK_FILL);

/** `text-[rgb(3_7_18)]` is how that same ink is spelled as a Tailwind utility. */
function colorFromInkClass(className: string): string {
  const arbitrary = /text-\[rgb\(([0-9_]+)\)\]$/.exec(className);
  if (!arbitrary) throw new Error(`${className} is not an arbitrary rgb ink class`);
  return `rgb(${arbitrary[1].replace(/_/g, ' ')})`;
}

const AA = 4.5;
const themes = readThemes();

describe('schedule chip legibility', () => {
  it('covers every shipped theme pair in both modes', () => {
    expect(themes.length).toBeGreaterThanOrEqual(18);
    expect(themes.map((theme) => theme.name)).toContain('high-contrast-dark');
  });

  it('clears AA on calendar chips: every type, theme and hover state', () => {
    const failures: string[] = [];

    for (const theme of themes) {
      for (const hovered of [false, true]) {
        for (const type of WORK_ITEM_TYPES) {
          const fill = resolveToken(theme.tokens, fillTokenFor(type, hovered));
          const ratio = contrast(inkOn(fill), fill);
          if (ratio < AA) {
            failures.push(
              `${theme.name} ${type} ${hovered ? 'hover' : 'base'}: ${ratio.toFixed(2)}:1 on rgb(${fill})`,
            );
          }
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it('clears AA on dispatch chips: every tokenised type, theme and hover state', () => {
    const failures: string[] = [];

    for (const theme of themes) {
      for (const type of WORK_ITEM_TYPES) {
        // Interaction and appointment chips are painted from the Tailwind
        // palette with their own dark variants, not from a theme token.
        const { fill, hoverFill } = getEventColors(type, true, false);
        if (!fill || !hoverFill) continue;

        const base = resolveToken(theme.tokens, fill);
        const hover = resolveToken(theme.tokens, hoverFill);
        const pairs: [string, string, string][] = [
          ['base', colorFromInkClass(inkClassForFill(isLightSurface(base))), base],
          ['hover', colorFromInkClass(hoverInkClassForFill(isLightSurface(hover))), hover],
        ];

        for (const [state, ink, surface] of pairs) {
          const ratio = contrast(ink, surface);
          if (ratio < AA) {
            failures.push(`${theme.name} ${type} ${state}: ${ratio.toFixed(2)}:1 on rgb(${surface})`);
          }
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it('clears AA on agent drawer chips, whose fill the stylesheet overrides', () => {
    // These chips ignore the per-type fill: the drawer stylesheet paints every
    // one of them with a translucent tint over the calendar ground, so the ink
    // that has to hold up is the text token, over that blend.
    const drawer = source('components/schedule/AgentScheduleDrawerStyles.tsx');
    const booked = /\.agent-schedule-view \.rbc-event \{[^}]*background-color: rgb\(var\((--[a-z0-9-]+)\) \/ ([\d.]+)\) !important/.exec(drawer);
    const other = /\.agent-schedule-event--other \{[^}]*background-color: rgb\(var\((--[a-z0-9-]+)\) \/ ([\d.]+)\) !important;[^}]*color: rgb\(var\((--[a-z0-9-]+)\)\) !important/.exec(drawer);
    expect(booked, 'the drawer no longer tints its chips; re-derive their surface').not.toBeNull();
    expect(other, 'the receded chips no longer set their own fill and ink').not.toBeNull();

    const failures: string[] = [];
    for (const theme of themes) {
      // The drawer sits on the border-50 panel; in dark mode the calendar
      // paints the page background over it.
      for (const groundToken of ['--color-border-50', '--color-background']) {
        const ground = resolveToken(theme.tokens, groundToken);
        const surfaces: [string, string, string][] = [
          [
            'booked',
            resolveToken(theme.tokens, '--color-text-900'),
            composite(resolveToken(theme.tokens, booked![1]), Number(booked![2]), ground),
          ],
          [
            'receded',
            resolveToken(theme.tokens, other![3]),
            composite(resolveToken(theme.tokens, other![1]), Number(other![2]), ground),
          ],
        ];

        for (const [state, ink, surface] of surfaces) {
          const ratio = contrast(ink, surface);
          if (ratio < AA) {
            failures.push(`${theme.name} ${state} on ${groundToken}: ${ratio.toFixed(2)}:1`);
          }
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it('measures the fill each chip paints rather than assuming the mode', () => {
    const week = source('components/schedule/WeeklyScheduleEvent.tsx');
    expect(week).toContain('const fillIsLight = useSurfaceIsLight(eventRef, fill);');
    expect(week).toContain('const textColor = inkForFill(fillIsLight);');

    const month = source('components/schedule/MonthScheduleChip.tsx');
    expect(month).toContain('const fillIsLight = useSurfaceIsLight(chipRef, fill);');
    expect(month).toContain('color: inkForFill(fillIsLight),');

    // The month chip is a component precisely so it can hold that hook; the
    // calendar's render callback cannot.
    const calendar = source('components/schedule/ScheduleCalendar.tsx');
    expect(calendar).toContain('<MonthScheduleChip');
    expect(calendar).not.toContain('backgroundColor: workItemColors');

    for (const chip of ['ScheduleEvent.tsx', 'WeeklyScheduleEvent.tsx']) {
      const dispatch = source(`components/technician-dispatch/${chip}`);
      expect(dispatch, chip).toContain('useSurfaceIsLight(eventRef, fill ?? undefined)');
      expect(dispatch, chip).toContain('${bg} ${ink}');
    }

    // A gray-950 foreground was the original bug: globals.css remaps the
    // 900-400 steps under `.dark` but not 950, so it stayed near-black on a
    // dark chip. A theme text token on a theme fill is the same trap — both
    // move with the theme, and on high-contrast dark they meet.
    for (const chip of [
      'components/schedule/WeeklyScheduleEvent.tsx',
      'components/schedule/MonthScheduleChip.tsx',
      'components/technician-dispatch/ScheduleEvent.tsx',
      'components/technician-dispatch/WeeklyScheduleEvent.tsx',
    ]) {
      expect(source(chip), chip).not.toContain('text-gray-950');
    }
  });
});
