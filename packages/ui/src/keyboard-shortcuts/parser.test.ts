import { describe, expect, it } from 'vitest';
import { parseBinding, parseSequence } from './parser';

function expectBinding(input: string) {
  const result = parseBinding(input);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }

  return result.value;
}

describe('parseBinding', () => {
  it("parses 'mod+s' as a mod code binding for physical KeyS", () => {
    expect(expectBinding('mod+s')).toMatchObject({
      modifiers: ['mod'],
      token: { kind: 'code', value: 'KeyS' },
      normalized: 'mod+s',
    });
  });

  it("parses 'alt+n' as an alt code binding for physical KeyN", () => {
    expect(expectBinding('alt+n')).toMatchObject({
      modifiers: ['alt'],
      token: { kind: 'code', value: 'KeyN' },
      normalized: 'alt+n',
    });
  });

  it("parses '?' as a produced-character binding", () => {
    expect(expectBinding('?')).toMatchObject({
      modifiers: [],
      token: { kind: 'char', value: '?' },
      normalized: '?',
    });
  });

  it('parses bracket tokens as physical bracket code bindings', () => {
    expect(expectBinding('[')).toMatchObject({
      token: { kind: 'code', value: 'BracketLeft' },
      normalized: '[',
    });
    expect(expectBinding(']')).toMatchObject({
      token: { kind: 'code', value: 'BracketRight' },
      normalized: ']',
    });
  });

  it.each([
    ['Enter', 'Enter'],
    ['Escape', 'Escape'],
    ['Tab', 'Tab'],
    ['Space', 'Space'],
    ['ArrowUp', 'ArrowUp'],
    ['ArrowDown', 'ArrowDown'],
    ['ArrowLeft', 'ArrowLeft'],
    ['ArrowRight', 'ArrowRight'],
    ['Delete', 'Delete'],
    ['Backspace', 'Backspace'],
    ['Home', 'Home'],
    ['End', 'End'],
    ['PageUp', 'PageUp'],
    ['PageDown', 'PageDown'],
  ])('parses named key %s as code %s', (input, code) => {
    expect(expectBinding(input)).toMatchObject({
      token: { kind: 'code', value: code },
    });
  });

  it('parses digits and F1..F12 as physical code bindings', () => {
    expect(expectBinding('0')).toMatchObject({ token: { kind: 'code', value: 'Digit0' } });
    expect(expectBinding('9')).toMatchObject({ token: { kind: 'code', value: 'Digit9' } });
    expect(expectBinding('F1')).toMatchObject({ token: { kind: 'code', value: 'F1' } });
    expect(expectBinding('f12')).toMatchObject({ token: { kind: 'code', value: 'F12' } });
  });

  it('parses literal ctrl/meta distinctly from mod', () => {
    expect(expectBinding('ctrl+s').modifiers).toEqual(['ctrl']);
    expect(expectBinding('meta+s').modifiers).toEqual(['meta']);
    expect(expectBinding('mod+s').modifiers).toEqual(['mod']);
  });

  it('normalizes modifier order deterministically and lowercases printable keys', () => {
    expect(expectBinding('Shift+MOD+S')).toMatchObject({
      modifiers: ['mod', 'shift'],
      token: { kind: 'code', value: 'KeyS', source: 's' },
      normalized: 'mod+shift+s',
    });
    expect(expectBinding('shift+alt+?').normalized).toBe('alt+shift+?');
  });

  it.each(['', 'mod+', 'foo+bar', 'ctrl+ctrl+s'])('rejects invalid syntax %s', (input) => {
    const result = parseBinding(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.input).toBe(input);
    }
  });
});

describe('parseSequence', () => {
  it('parses whitespace-separated chord sequences in order', () => {
    const result = parseSequence('g t');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((chord) => chord.normalized)).toEqual(['g', 't']);
    }

    const threeChord = parseSequence('g t c');
    expect(threeChord.ok).toBe(true);
    if (threeChord.ok) {
      expect(threeChord.value.map((chord) => chord.normalized)).toEqual(['g', 't', 'c']);
    }
  });

  it('rejects a sequence when any chord is invalid', () => {
    const result = parseSequence('g mod+');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid-sequence');
      expect(result.error.token).toBe('mod+');
    }
  });
});
