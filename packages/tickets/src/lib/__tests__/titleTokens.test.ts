import { describe, expect, it } from 'vitest';
import { findUnknownTokens, hasTokens, substituteTokens } from '../titleTokens';

describe('titleTokens', () => {
  it('finds unknown tokens in first-seen order without repeats', () => {
    expect(findUnknownTokens('{{a}} {{x}} {{b}} {{x}} {{y}}', ['a', 'b'])).toEqual(['x', 'y']);
    expect(findUnknownTokens('{{a}} {{b}}', ['a', 'b'])).toEqual([]);
  });

  it('tolerates whitespace inside the braces', () => {
    expect(findUnknownTokens('{{  a }}', ['a'])).toEqual([]);
    expect(findUnknownTokens('{{ zz }}', ['a'])).toEqual(['zz']);
  });

  it('substitutes repeated tokens', () => {
    expect(substituteTokens('{{a}}-{{ a }}-{{b}}', { a: () => '1', b: () => '2' })).toBe('1-1-2');
  });

  it('throws on an unknown token', () => {
    expect(() => substituteTokens('{{a}} {{q}}', { a: () => '1' })).toThrow('Unknown title token: {{q}}');
    expect(() => substituteTokens('{{p}} {{q}}', {})).toThrow('Unknown title tokens: {{p}}, {{q}}');
  });

  it('detects tokens', () => {
    expect(hasTokens('a {{x}} b')).toBe(true);
    expect(hasTokens('plain')).toBe(false);
    expect(hasTokens('{{x}}')).toBe(true);
    expect(hasTokens('{{x}}')).toBe(true); // stateless across calls
  });
});
