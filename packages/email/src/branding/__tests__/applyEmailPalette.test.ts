import { describe, expect, it } from 'vitest';
import { applyEmailPalette, containsEmailPaletteTokens } from '../applyEmailPalette';
import { resolveEmailPalette } from '../resolveEmailPalette';
import { NON_PALETTE_TEMPLATE_COLORS, STOCK_EMAIL_PALETTE } from '../stockPalette';
import { loadSystemTemplate, loadSystemTemplates } from './systemTemplateFixtures';

const TERRACOTTA = resolveEmailPalette({ primary: '#b4552f', secondary: '#3f4d8a' });
const FOREST = resolveEmailPalette({ primary: '#1f7a44', secondary: '#7ac8a1' });

const stockHexTokens = [
  STOCK_EMAIL_PALETTE.primary,
  STOCK_EMAIL_PALETTE.secondary,
  STOCK_EMAIL_PALETTE.dark,
  STOCK_EMAIL_PALETTE.outerBg,
  STOCK_EMAIL_PALETTE.footerBg,
  STOCK_EMAIL_PALETTE.cardBorder,
  STOCK_EMAIL_PALETTE.infoBoxBg,
  STOCK_EMAIL_PALETTE.infoBoxBorder,
];

describe('applyEmailPalette', () => {
  const templates = loadSystemTemplates('en');

  it('loads the real English system templates', () => {
    expect(templates.length).toBeGreaterThan(40);
  });

  it.each(templates.map((template) => [template.name, template] as const))(
    'removes every stock token from %s',
    (_name, template) => {
      const rewritten = applyEmailPalette(template.html, STOCK_EMAIL_PALETTE, TERRACOTTA);

      for (const token of stockHexTokens) {
        expect(rewritten.toLowerCase()).not.toContain(token.toLowerCase());
      }
      expect(rewritten).not.toMatch(/rgba\(\s*138\s*,\s*77\s*,\s*234/i);
      expect(containsEmailPaletteTokens(rewritten, STOCK_EMAIL_PALETTE)).toBe(false);
    },
  );

  it('rewrites the auth templates that style themselves with <style> blocks', () => {
    const passwordReset = loadSystemTemplate('password-reset');

    expect(passwordReset.html).toContain('<style>');
    const rewritten = applyEmailPalette(passwordReset.html, STOCK_EMAIL_PALETTE, TERRACOTTA);

    expect(rewritten).toContain(TERRACOTTA.primary);
    expect(rewritten.toLowerCase()).not.toContain(STOCK_EMAIL_PALETTE.primary.toLowerCase());
    expect(rewritten).toContain('<style>');
  });

  it('matches hex tokens in either case and with or without a space after the colon', () => {
    const html = 'a{background:#8a4dea}b{background: #8A4DEA}c{color:#8A4dEa;}';

    expect(applyEmailPalette(html, STOCK_EMAIL_PALETTE, TERRACOTTA))
      .toBe(`a{background:${TERRACOTTA.primary}}b{background: ${TERRACOTTA.primary}}c{color:${TERRACOTTA.primary};}`);
  });

  it('matches rgba tokens with and without spaces', () => {
    const html = 'x{background:rgba(138,77,234,0.12)}y{background:rgba(138, 77, 234, 0.12)}';

    expect(applyEmailPalette(html, STOCK_EMAIL_PALETTE, TERRACOTTA))
      .toBe(`x{background:${TERRACOTTA.badgeBg}}y{background:${TERRACOTTA.badgeBg}}`);
  });

  it('rewrites the box shadow with its own spacing variants', () => {
    const html = 'box-shadow:0 12px 32px rgba(138, 77, 234, 0.12);';

    expect(applyEmailPalette(html, STOCK_EMAIL_PALETTE, TERRACOTTA))
      .toBe(`box-shadow:${TERRACOTTA.cardShadow};`);
  });

  it('leaves non-palette colors untouched', () => {
    const html = NON_PALETTE_TEMPLATE_COLORS.join(' ');

    expect(applyEmailPalette(html, STOCK_EMAIL_PALETTE, TERRACOTTA)).toBe(html);
  });

  it('leaves template variables untouched', () => {
    const ticketCreated = loadSystemTemplate('ticket-created');
    const rewritten = applyEmailPalette(ticketCreated.html, STOCK_EMAIL_PALETTE, TERRACOTTA);

    const variablesOf = (html: string) => html.match(/\{\{[^}]+\}\}/g) ?? [];
    expect(variablesOf(rewritten)).toEqual(variablesOf(ticketCreated.html));
    expect(rewritten).toContain('{{ticket.title}}');
  });

  it('re-applies over a previously applied map (stock->A->B equals stock->B)', () => {
    const ticketCreated = loadSystemTemplate('ticket-created');

    const viaTerracotta = applyEmailPalette(
      applyEmailPalette(ticketCreated.html, STOCK_EMAIL_PALETTE, TERRACOTTA),
      TERRACOTTA,
      FOREST,
    );

    expect(viaTerracotta).toBe(applyEmailPalette(ticketCreated.html, STOCK_EMAIL_PALETTE, FOREST));
  });

  it('is a no-op when the palettes are identical', () => {
    const ticketCreated = loadSystemTemplate('ticket-created');

    expect(applyEmailPalette(ticketCreated.html, STOCK_EMAIL_PALETTE, STOCK_EMAIL_PALETTE))
      .toBe(ticketCreated.html);
  });

  it('does not match a hex token that is only the prefix of a longer hex', () => {
    const html = 'a{color:#8a4deaff}';

    expect(applyEmailPalette(html, STOCK_EMAIL_PALETTE, TERRACOTTA)).toBe(html);
  });
});

describe('containsEmailPaletteTokens', () => {
  it('is true for a stock template and false for a redesign', () => {
    const ticketCreated = loadSystemTemplate('ticket-created');

    expect(containsEmailPaletteTokens(ticketCreated.html, STOCK_EMAIL_PALETTE)).toBe(true);
    expect(containsEmailPaletteTokens('<html><body style="background:#101010"></body></html>', STOCK_EMAIL_PALETTE))
      .toBe(false);
  });
});
