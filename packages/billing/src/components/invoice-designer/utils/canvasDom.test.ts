import { describe, expect, it } from 'vitest';

import { stepZoom } from '../toolbar/DesignerToolbar';
import { resolveFitScale } from './canvasDom';

describe('resolveFitScale', () => {
  it('picks the largest 5% zoom at which the page and its rulers fit the viewport', () => {
    // 650px viewport, 816px page: (650 - 84) / 816 = 0.69 -> 65%.
    expect(resolveFitScale(650, 816)).toBe(0.65);
  });

  it('never zooms in past 100% or out past 50%', () => {
    expect(resolveFitScale(2000, 816)).toBe(1);
    expect(resolveFitScale(200, 816)).toBe(0.5);
    expect(resolveFitScale(0, 816)).toBe(1);
  });
});

describe('stepZoom', () => {
  it('moves to the next preset level, from in-between values too', () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(0.65, 1)).toBe(0.7);
    expect(stepZoom(0.65, -1)).toBe(0.6);
    expect(stepZoom(2, 1)).toBe(2);
    expect(stepZoom(0.5, -1)).toBe(0.5);
  });
});
