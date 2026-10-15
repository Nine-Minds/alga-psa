import { describe, expect, it } from 'vitest';
import { applyEmailPalette } from '../applyEmailPalette';
import { addGradientFallback, stripGradientFallback } from '../gradientFallback';
import { resolveEmailPalette } from '../resolveEmailPalette';
import { STOCK_EMAIL_PALETTE } from '../stockPalette';
import { loadSystemTemplates } from './systemTemplateFixtures';

/** The header cell exactly as the layout wrote it before the fallback existed. */
const LEGACY_HEADER =
  '<td style="padding:32px;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">';

/** The header cell as the layout writes it now. */
const CURRENT_HEADER =
  '<td bgcolor="#8A4DEA" style="padding:32px;background-color:#8A4DEA;background:linear-gradient(135deg,#8A4DEA,#40CFF9);color:#ffffff;">';

const SLATE = resolveEmailPalette({ primary: '#4a5a68', secondary: '#6b7c8a' });

const layoutTemplates = loadSystemTemplates().filter((template) => template.html.includes('linear-gradient('));

describe('addGradientFallback', () => {
  it('gives the legacy header cell the flat primary as bgcolor and background-color', () => {
    expect(addGradientFallback(LEGACY_HEADER)).toBe(CURRENT_HEADER);
  });

  it('is a no-op on the header the layout writes now', () => {
    expect(addGradientFallback(CURRENT_HEADER)).toBe(CURRENT_HEADER);
  });

  it('is a no-op on every shipped system template', () => {
    expect(layoutTemplates.length).toBeGreaterThan(0);
    for (const template of layoutTemplates) {
      expect(addGradientFallback(template.html), template.name).toBe(template.html);
    }
  });

  it('repairs a branded row written before the fallback with the tenant primary', () => {
    const legacyBranded = applyEmailPalette(LEGACY_HEADER, STOCK_EMAIL_PALETTE, SLATE);

    expect(addGradientFallback(legacyBranded)).toBe(
      `<td bgcolor="${SLATE.primary}" style="padding:32px;background-color:${SLATE.primary};background:${SLATE.gradient};color:#ffffff;">`,
    );
  });

  it('tolerates spaced stops with percentages and picks the first color', () => {
    const html = '<td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px;">';

    expect(addGradientFallback(html)).toBe(
      '<td bgcolor="#667eea" style="background-color:#667eea;background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px;">',
    );
  });

  it('handles an rgba first stop without truncating it', () => {
    const html = '<div style="background:linear-gradient(90deg, rgba(10, 20, 30, 0.9), #fff);">';

    expect(addGradientFallback(html)).toBe(
      '<div style="background-color:rgba(10, 20, 30, 0.9);background:linear-gradient(90deg, rgba(10, 20, 30, 0.9), #fff);">',
    );
  });

  it('adds bgcolor only to elements the Word-based Outlook reads it on', () => {
    expect(addGradientFallback('<div style="background:linear-gradient(135deg,#111,#222)">')).toBe(
      '<div style="background-color:#111;background:linear-gradient(135deg,#111,#222)">',
    );
  });

  it('leaves an element that already declares a background color alone', () => {
    const html = '<td bgcolor="#000000" style="background-color:#000000;background:linear-gradient(135deg,#111,#222);">';
    expect(addGradientFallback(html)).toBe(html);

    const colorAfter = '<td style="background:linear-gradient(135deg,#111,#222);background-color:#333;">';
    expect(addGradientFallback(colorAfter)).toBe(colorAfter);
  });

  it('leaves markup without gradients untouched', () => {
    const html = '<td style="background:#f8f5ff;color:#5b38b0;">Footer</td>';
    expect(addGradientFallback(html)).toBe(html);
    expect(addGradientFallback('')).toBe('');
  });
});

describe('stripGradientFallback', () => {
  it('returns the current header to its legacy form', () => {
    expect(stripGradientFallback(CURRENT_HEADER)).toBe(LEGACY_HEADER);
  });

  it('round-trips with addGradientFallback on every shipped template', () => {
    for (const template of layoutTemplates) {
      expect(addGradientFallback(stripGradientFallback(template.html)), template.name).toBe(template.html);
    }
  });

  it('does not touch background colors on elements without a gradient', () => {
    const html = '<td bgcolor="#ffffff" style="background-color:#ffffff;padding:8px;">';
    expect(stripGradientFallback(html)).toBe(html);
  });
});
