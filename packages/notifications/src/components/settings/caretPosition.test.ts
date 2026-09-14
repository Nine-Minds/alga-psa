import { describe, expect, it } from 'vitest';
import { scrollTopForOffset } from './caretPosition';

describe('scrollTopForOffset', () => {
  it('puts the offset a third of the way down the editor', () => {
    expect(scrollTopForOffset(600, 300)).toBe(500);
  });

  it('never scrolls above the top of the document', () => {
    expect(scrollTopForOffset(40, 300)).toBe(0);
    expect(scrollTopForOffset(0, 300)).toBe(0);
  });

  it('falls back to the top when the measurement failed', () => {
    expect(scrollTopForOffset(Number.NaN, 300)).toBe(0);
  });
});
