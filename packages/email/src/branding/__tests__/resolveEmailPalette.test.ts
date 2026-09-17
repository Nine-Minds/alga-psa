import { describe, expect, it } from 'vitest';
import { mixWithWhite, scaleLightness } from '../color';
import { resolveEmailPalette } from '../resolveEmailPalette';
import { STOCK_EMAIL_PALETTE } from '../stockPalette';

const TERRACOTTA = '#b4552f';

describe('resolveEmailPalette', () => {
  it('reproduces the stock token map exactly for the stock colors', () => {
    expect(resolveEmailPalette({ primary: '#8A4DEA', secondary: '#40CFF9' })).toEqual(STOCK_EMAIL_PALETTE);
    expect(resolveEmailPalette({ primary: '#8a4dea', secondary: '#40cff9' })).toEqual(STOCK_EMAIL_PALETTE);
  });

  it('darkens primary by 25% lightness and mixes the tints with white', () => {
    const tokens = resolveEmailPalette({ primary: TERRACOTTA, secondary: '#3f4d8a' });

    expect(tokens.dark).toBe(scaleLightness(TERRACOTTA, 0.75));
    expect(tokens.outerBg).toBe(mixWithWhite(TERRACOTTA, 0.95));
    expect(tokens.footerBg).toBe(mixWithWhite(TERRACOTTA, 0.96));
    expect(tokens.infoBoxBg).toBe(mixWithWhite(TERRACOTTA, 0.96));
    expect(tokens.cardBorder).toBe(mixWithWhite(TERRACOTTA, 0.88));
    expect(tokens.infoBoxBorder).toBe(mixWithWhite(TERRACOTTA, 0.9));
    expect(tokens.badgeBg).toBe('rgba(180,85,47,0.12)');
    expect(tokens.cardShadow).toBe('0 12px 32px rgba(180,85,47,0.12)');
    expect(tokens.gradient).toBe('linear-gradient(135deg,#b4552f,#3f4d8a)');
  });

  it('derives the gradient end from a lighter primary in single-color mode', () => {
    const tokens = resolveEmailPalette({ primary: TERRACOTTA, secondary: null });

    expect(tokens.secondary).toBe(scaleLightness(TERRACOTTA, 1.18));
    expect(tokens.gradient).toBe(`linear-gradient(135deg,${TERRACOTTA},${tokens.secondary})`);
    expect(tokens.secondary).not.toBe(TERRACOTTA);
  });

  it('lets an override win over the derived value without disturbing the rest', () => {
    const derived = resolveEmailPalette({ primary: TERRACOTTA, secondary: '#3f4d8a' });
    const overridden = resolveEmailPalette({
      primary: TERRACOTTA,
      secondary: '#3f4d8a',
      overrides: { cardBorder: '#123456' },
    });

    expect(overridden.cardBorder).toBe('#123456');
    expect({ ...overridden, cardBorder: derived.cardBorder }).toEqual(derived);
  });

  it('honours a badge alpha override in both the badge and the card shadow', () => {
    const tokens = resolveEmailPalette({
      primary: TERRACOTTA,
      secondary: '#3f4d8a',
      overrides: { badgeAlpha: 0.2 },
    });

    expect(tokens.badgeBg).toBe('rgba(180,85,47,0.2)');
    expect(tokens.cardShadow).toBe('0 12px 32px rgba(180,85,47,0.2)');
  });

  it('expands shorthand hex input', () => {
    expect(resolveEmailPalette({ primary: '#abc', secondary: '#def' }).gradient)
      .toBe('linear-gradient(135deg,#aabbcc,#ddeeff)');
  });
});
