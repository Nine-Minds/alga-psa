import { describe, expect, it } from 'vitest';
import { scrollDeltaForOffset, scrollTopForOffset } from './caretPosition';

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

describe('scrollDeltaForOffset', () => {
  it('moves the pane until the character is a third of the way down it', () => {
    // A character 900px down the viewport, in a 600px pane starting at 100px:
    // it should end up at 300px, so the pane scrolls 600px further down.
    expect(scrollDeltaForOffset(900, 100, 600)).toBe(600);
  });

  it('scrolls back up for a character above the pane', () => {
    expect(scrollDeltaForOffset(0, 100, 600)).toBe(-300);
  });

  it('stays put when the measurement failed', () => {
    expect(scrollDeltaForOffset(Number.NaN, 100, 600)).toBe(0);
  });
});
