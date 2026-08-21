/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(file: string): string {
  return fs.readFileSync(path.resolve(__dirname, file), 'utf8');
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
