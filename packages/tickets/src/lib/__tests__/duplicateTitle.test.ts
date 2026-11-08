import { describe, expect, it } from 'vitest';
import { renderDuplicateTitle, validateDuplicateTitle } from '../duplicateTitle';

const jane = { contactName: 'Jane Doe', clientName: 'Acme' };

describe('renderDuplicateTitle', () => {
  it('substitutes the contact', () => {
    expect(renderDuplicateTitle('Onboard {{contact}}', jane)).toEqual({ title: 'Onboard Jane Doe' });
  });
  it('substitutes both tokens, tolerating whitespace', () => {
    expect(renderDuplicateTitle('{{ contact }} – {{client}}', jane)).toEqual({ title: 'Jane Doe – Acme' });
  });
  it('requires a contact for {{contact}}', () => {
    expect(renderDuplicateTitle('{{contact}}', { contactName: null, clientName: 'Acme' })).toEqual({ error: 'contact_required' });
    expect(renderDuplicateTitle('x {{ contact }}', { contactName: '  ', clientName: 'Acme' })).toEqual({ error: 'contact_required' });
  });
  it('allows {{client}} without a contact', () => {
    expect(renderDuplicateTitle('{{client}} setup', { contactName: null, clientName: 'Acme' })).toEqual({ title: 'Acme setup' });
  });
  it('rejects unknown tokens', () => {
    expect(renderDuplicateTitle('{{contat}}', jane)).toEqual({ error: 'unknown_token', tokens: ['contat'] });
  });
  it('returns token-free templates unchanged', () => {
    expect(renderDuplicateTitle('Plain title', jane)).toEqual({ title: 'Plain title' });
  });
});

describe('validateDuplicateTitle', () => {
  it('flags empty and whitespace', () => {
    expect(validateDuplicateTitle('')).toBe('empty');
    expect(validateDuplicateTitle('   ')).toBe('empty');
  });
  it('flags leftover tokens', () => {
    expect(validateDuplicateTitle('Hi {{x}}')).toBe('unresolved_token');
  });
  it('accepts a normal title', () => {
    expect(validateDuplicateTitle('Onboard Jane')).toBeNull();
  });
});
