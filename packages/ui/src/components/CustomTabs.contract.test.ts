/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('CustomTabs source contract', () => {
  it('requires an id field on TabContent and uses ids for grouped auto-expand matching', () => {
    const source = read('./CustomTabs.tsx');

    expect(source).toContain('id: string;');
    expect(source).toContain('tab.id === defaultTab');
    expect(source).toContain('tab.id === value');
    expect(source).toContain('key={tab.id}');
    expect(source).toContain('value={tab.id}');
    expect(source).toContain('return allTabs[0].id;');
    expect(source).not.toContain('tab.label === defaultTab');
    expect(source).not.toContain('tab.label === value');
  });
});

/**
 * Tab chrome themes from tokens, in both tabs components.
 *
 * `text-gray-500` on a tab name only inverts in dark mode — the `.dark
 * .text-gray-*` shims in globals.css are the whole remap — so in a light pair
 * whose ground is not near-white the resting tab names kept painting #6B7280 on
 * whatever the shell was, and high contrast (an ink-black border ramp) is where
 * that bottomed out. The token rungs follow the pair in BOTH modes.
 */
const TAB_CHROME = ['./CustomTabs.tsx', './Tabs.tsx'];
const GRAY_UTILITY = /\b(?:text|bg|border|divide|placeholder|ring)-(?:gray|slate)-\d{2,3}\b/;

describe.each(TAB_CHROME)('%s tab chrome themes from tokens', (file) => {
  const source = read(file);

  it('names --color-* rungs for its rule and its resting ink', () => {
    expect(source).toContain('border-[rgb(var(--color-border-200))]');
    expect(source).toContain('text-[rgb(var(--color-text-600))]');
    expect(source).toContain('hover:text-[rgb(var(--color-text-900))]');
  });

  it('carries no hardcoded gray/slate utility anywhere', () => {
    const offenders = source
      .split('\n')
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => GRAY_UTILITY.test(line))
      .map(({ line, index }) => `${file}:${index + 1}  ${line.trim().slice(0, 100)}`);

    expect(offenders, `un-themed gray utilities:\n${offenders.join('\n')}`).toEqual([]);
  });
});
