import { describe, expect, it } from 'vitest';
import { findUnknownTitleTokens, renderTitleTemplate } from '../titleTemplate';

describe('recurring title tokens', () => {
  const context = { clientName: 'Acme Corp', dueDate: '2026-03-31', locale: 'en' };

  it('renders every known token', () => {
    expect(renderTitleTemplate('{{client}} — {{month}} {{year}} (due {{due_date}})', context)).toBe(
      'Acme Corp — March 2026 (due March 31, 2026)'
    );
  });

  it('tolerates whitespace inside the braces and repeated tokens', () => {
    expect(renderTitleTemplate('{{ client }} / {{client}}', context)).toBe('Acme Corp / Acme Corp');
  });

  it('leaves a template without tokens untouched', () => {
    expect(renderTitleTemplate('Monthly patching', context)).toBe('Monthly patching');
  });

  it('renders date words in the tenant locale', () => {
    expect(renderTitleTemplate('{{month}}', { ...context, locale: 'de' })).toBe('März');
    expect(renderTitleTemplate('{{month}}', { ...context, locale: 'fr' })).toBe('mars');
  });

  it('falls back to English for a missing or invalid locale', () => {
    expect(renderTitleTemplate('{{month}}', { ...context, locale: null })).toBe('March');
    expect(renderTitleTemplate('{{month}}', { ...context, locale: 'not a locale' })).toBe('March');
  });

  it('formats the due date as a calendar date regardless of the process timezone', () => {
    const original = process.env.TZ;
    try {
      process.env.TZ = 'Pacific/Auckland';
      expect(renderTitleTemplate('{{due_date}}', { ...context, dueDate: '2026-12-31' })).toBe('December 31, 2026');
      process.env.TZ = 'America/Los_Angeles';
      expect(renderTitleTemplate('{{due_date}}', { ...context, dueDate: '2026-01-01' })).toBe('January 1, 2026');
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it('reports unknown tokens once each, in first-seen order', () => {
    expect(findUnknownTitleTokens('{{client}} {{cliant}} {{foo}} {{cliant}} {{year}}')).toEqual(['cliant', 'foo']);
    expect(findUnknownTitleTokens('{{client}} {{due_date}} {{month}} {{year}}')).toEqual([]);
  });

  it('treats an empty token as unknown', () => {
    expect(findUnknownTitleTokens('a {{}} b')).toEqual(['']);
  });

  it('refuses to render a template with an unknown token', () => {
    expect(() => renderTitleTemplate('{{client}} {{nope}}', context)).toThrow(/Unknown title token: \{\{nope\}\}/);
  });

  it('rejects a malformed due date', () => {
    expect(() => renderTitleTemplate('{{year}}', { ...context, dueDate: '31/03/2026' })).toThrow(/Invalid due date/);
  });

  it('does not treat a client name that looks like a token as a token', () => {
    expect(renderTitleTemplate('{{client}}', { ...context, clientName: '{{year}} Ltd' })).toBe('{{year}} Ltd');
  });
});
