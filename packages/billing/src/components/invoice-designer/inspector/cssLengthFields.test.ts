import { describe, expect, it } from 'vitest';

import {
  areCssLengthBoxValuesLinked,
  formatCssLength,
  formatCssLengthBox,
  getCssLengthStep,
  parseCssLength,
  parseCssLengthBox,
} from './cssLengthFields';

describe('invoice designer css length helpers', () => {
  it('parses single css lengths for px, rem, percent, and unitless zero values', () => {
    expect(parseCssLength('16px')).toMatchObject({ value: 16, unit: 'px', isCustom: false });
    expect(parseCssLength('2rem')).toMatchObject({ value: 2, unit: 'rem', isCustom: false });
    expect(parseCssLength('50%')).toMatchObject({ value: 50, unit: '%', isCustom: false });
    expect(parseCssLength('0')).toMatchObject({ value: 0, unit: 'px', isCustom: false });
    expect(parseCssLength('0px')).toMatchObject({ value: 0, unit: 'px', isCustom: false });
  });

  it('formats single css lengths with the selected unit', () => {
    expect(formatCssLength(16, 'px')).toBe('16px');
    expect(formatCssLength(2, 'rem')).toBe('2rem');
    expect(formatCssLength(50, '%')).toBe('50%');
    expect(formatCssLength(null, 'px')).toBeUndefined();
  });

  it('uses 0.25 stepping for rem and whole-number stepping for px and percent', () => {
    expect(getCssLengthStep('px')).toBe(1);
    expect(getCssLengthStep('%')).toBe(1);
    expect(getCssLengthStep('rem')).toBe(0.25);
  });

  it('parses one-value, two-value, and four-value css box shorthand into per-side values', () => {
    expect(parseCssLengthBox('8px')).toMatchObject({
      top: 8,
      right: 8,
      bottom: 8,
      left: 8,
      unit: 'px',
      isCustom: false,
    });
    expect(parseCssLengthBox('8px 16px')).toMatchObject({
      top: 8,
      right: 16,
      bottom: 8,
      left: 16,
      unit: 'px',
      isCustom: false,
    });
    expect(parseCssLengthBox('8px 16px 24px 32px')).toMatchObject({
      top: 8,
      right: 16,
      bottom: 24,
      left: 32,
      unit: 'px',
      isCustom: false,
    });
  });

  it('detects when box values are fully linked', () => {
    expect(areCssLengthBoxValuesLinked({ top: 8, right: 8, bottom: 8, left: 8 })).toBe(true);
    expect(areCssLengthBoxValuesLinked({ top: 8, right: 16, bottom: 8, left: 16 })).toBe(false);
  });

  it('formats css box values into optimized shorthand', () => {
    expect(formatCssLengthBox({ top: 8, right: 8, bottom: 8, left: 8 }, 'px')).toBe('8px');
    expect(formatCssLengthBox({ top: 8, right: 16, bottom: 8, left: 16 }, 'px')).toBe('8px 16px');
    expect(formatCssLengthBox({ top: 8, right: 16, bottom: 24, left: 16 }, 'px')).toBe('8px 16px 24px');
    expect(formatCssLengthBox({ top: 8, right: 16, bottom: 24, left: 32 }, 'px')).toBe('8px 16px 24px 32px');
  });
});
