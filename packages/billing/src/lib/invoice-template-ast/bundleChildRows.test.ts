import { describe, expect, it } from 'vitest';
import {
  buildBundleChildRowsPreset,
  bundleChildRowsShowChange,
  detectBundleChildRowsPreset,
} from './bundleChildRows';
import { getStandardTemplateAstByCode } from './standardTemplates';

type Json = unknown;

/** Rebuild every object with its keys sorted or reversed, then round-trip through JSON (what jsonb does to key order). */
const reorder = (value: Json, mode: 'sorted' | 'reversed'): Json => {
  if (Array.isArray(value)) return value.map((v) => reorder(v, mode));
  if (value && typeof value === 'object') {
    const keys = Object.keys(value as object).sort();
    if (mode === 'reversed') keys.reverse();
    return Object.fromEntries(keys.map((k) => [k, reorder((value as Record<string, Json>)[k], mode)]));
  }
  return value;
};
const roundTrip = (value: Json, mode: 'sorted' | 'reversed') => JSON.parse(JSON.stringify(reorder(value, mode)));

const findChildRows = (node: any): any => {
  if (!node || typeof node !== 'object') return undefined;
  if (node.childRows) return node.childRows;
  for (const child of Object.values(node)) {
    const hit = findChildRows(child);
    if (hit) return hit;
  }
  return undefined;
};

describe('detectBundleChildRowsPreset', () => {
  const cases = [
    ['quantities', false],
    ['quantities', true],
    ['quantities-and-prices', false],
    ['quantities-and-prices', true],
  ] as const;

  for (const [name, showChange] of cases) {
    for (const mode of ['sorted', 'reversed'] as const) {
      it(`detects ${name} (change ${showChange}) after ${mode} key reorder`, () => {
        const preset = buildBundleChildRowsPreset({ prices: name === 'quantities-and-prices', showChange });
        const stored = roundTrip(preset, mode);
        expect(detectBundleChildRowsPreset(stored)).toBe(name);
        expect(bundleChildRowsShowChange(stored)).toBe(showChange);
      });
    }
  }

  it('treats parentBlankColumns as a set', () => {
    const preset = buildBundleChildRowsPreset({ prices: false, showChange: true });
    expect(preset.parentBlankColumns).toHaveLength(2);
    const swapped = { ...preset, parentBlankColumns: [...preset.parentBlankColumns!].reverse() };
    expect(detectBundleChildRowsPreset(swapped)).toBe('quantities');
    expect(detectBundleChildRowsPreset({ ...preset, parentBlankColumns: ['quantity'] })).toBe('custom');
  });

  it('treats an undefined-valued key like a missing one', () => {
    const preset = buildBundleChildRowsPreset({ prices: false, showChange: false });
    expect(detectBundleChildRowsPreset({ ...preset, extra: undefined })).toBe('quantities');
  });

  it('resolves the stock standard-bundle-quantities AST as quantities with change on', () => {
    const fromTemplates = findChildRows(getStandardTemplateAstByCode('standard-bundle-quantities'));
    expect(fromTemplates).toBeTruthy();

    for (const mode of ['sorted', 'reversed'] as const) {
      const stored = roundTrip(fromTemplates, mode);
      expect(detectBundleChildRowsPreset(stored)).toBe('quantities');
      expect(bundleChildRowsShowChange(stored)).toBe(true);
    }
  });

  it('still reports custom for a modified childRows', () => {
    const preset = buildBundleChildRowsPreset({ prices: true, showChange: true });
    const modified = JSON.parse(JSON.stringify(preset));
    modified.cells['line-total'].extra = { value: { type: 'path', path: 'component.name' } };
    expect(detectBundleChildRowsPreset(roundTrip(modified, 'reversed'))).toBe('custom');
    expect(detectBundleChildRowsPreset(undefined)).toBe('off');
  });
});
