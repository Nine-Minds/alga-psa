import { describe, expect, it } from 'vitest';
import { buildDocumentFileName } from './fileNames';

describe('buildDocumentFileName', () => {
  it('keeps an ordinary title', () => {
    expect(buildDocumentFileName('Estimate for renovation', 'Quote_Q-1')).toBe('Estimate for renovation.pdf');
  });

  it('removes characters that are invalid in portable filenames', () => {
    expect(buildDocumentFileName('A/B: C*? "D" <E> | F\\G\u0001\u0085', 'Quote_Q-1'))
      .toBe('AB C D E FG.pdf');
  });

  it('preserves accented and other Unicode letters', () => {
    expect(buildDocumentFileName('Soumission – Été', 'Quote_Q-1')).toBe('Soumission – Été.pdf');
  });

  it.each(['', '   \t  '])('uses the fallback when the title is empty (%j)', (title) => {
    expect(buildDocumentFileName(title, 'Quote_Q-1')).toBe('Quote_Q-1.pdf');
  });

  it('uses the fallback when sanitizing removes the entire title', () => {
    expect(buildDocumentFileName('///:*?"<>|', 'Quote_Q-1')).toBe('Quote_Q-1.pdf');
  });

  it('appends the PDF extension only once', () => {
    expect(buildDocumentFileName('Estimate.pdf', 'Quote_Q-1')).toBe('Estimate.pdf');
  });

  it('caps the basename without splitting a surrogate pair', () => {
    const result = buildDocumentFileName(`${'a'.repeat(149)}😀tail`, 'Quote_Q-1');
    expect(result).toBe(`${'a'.repeat(149)}😀.pdf`);
    expect(Array.from(result.slice(0, -4))).toHaveLength(150);
  });

  it('uses the fallback for a Windows reserved basename', () => {
    expect(buildDocumentFileName('CON', 'Quote_Q-1')).toBe('Quote_Q-1.pdf');
  });
});
