/**
 * alga-2026-0003343: only an unmodified primary click may be taken over by an
 * in-app handler; every modifier and the middle button belong to the browser so
 * "open in new tab" works on entity-name links.
 */
import { describe, expect, it } from 'vitest';
import { isPlainLeftClick } from './plainLeftClick';

describe('isPlainLeftClick', () => {
  it('is true for an unmodified left click', () => {
    expect(isPlainLeftClick({ button: 0 })).toBe(true);
  });

  it('treats a missing button as the primary button', () => {
    expect(isPlainLeftClick({})).toBe(true);
  });

  it('is false for a middle click', () => {
    expect(isPlainLeftClick({ button: 1 })).toBe(false);
  });

  it('is false for a right click', () => {
    expect(isPlainLeftClick({ button: 2 })).toBe(false);
  });

  it.each([
    ['metaKey', { button: 0, metaKey: true }],
    ['ctrlKey', { button: 0, ctrlKey: true }],
    ['shiftKey', { button: 0, shiftKey: true }],
    ['altKey', { button: 0, altKey: true }],
  ])('is false when %s is held', (_name, event) => {
    expect(isPlainLeftClick(event)).toBe(false);
  });
});
