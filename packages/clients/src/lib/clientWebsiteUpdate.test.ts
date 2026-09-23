import { describe, expect, it } from 'vitest';
import { clientWebsiteFieldsForSave, mergeClientWebsiteUpdate } from './clientWebsiteUpdate';

describe('mergeClientWebsiteUpdate', () => {
  it('keeps both stored website copies for a properties-only update without website', () => {
    expect(mergeClientWebsiteUpdate('https://example.com', { website: 'https://example.com' }, {
      properties: { industry: 'IT' },
    })).toEqual({ properties: { website: 'https://example.com', industry: 'IT' } });
  });

  it('keeps existing properties when properties is explicitly null', () => {
    expect(mergeClientWebsiteUpdate('https://example.com', { website: 'https://example.com' }, {
      properties: null,
    })).toEqual({});
  });

  it('leaves website columns out of unrelated updates without url', () => {
    expect(mergeClientWebsiteUpdate('https://example.com', { website: 'https://example.com' }, {})).toEqual({});
  });

  it('preserves a properties-only website while updating unrelated fields', () => {
    expect(mergeClientWebsiteUpdate('', { website: 'https://properties.example' }, {
      properties: { industry: 'IT' },
    })).toEqual({ properties: { website: 'https://properties.example', industry: 'IT' } });
  });

  it('preserves a url-only legacy value while updating unrelated properties', () => {
    expect(mergeClientWebsiteUpdate('https://url-only.example', {}, {
      properties: { industry: 'IT' },
    })).toEqual({ properties: { industry: 'IT' } });
  });

  it('synchronizes both copies when url is explicitly set', () => {
    expect(mergeClientWebsiteUpdate('https://old.example', { website: 'https://old.example' }, {
      url: 'https://new.example',
    })).toEqual({ url: 'https://new.example', properties: { website: 'https://new.example' } });
  });

  it('clears both copies when url is explicitly emptied', () => {
    expect(mergeClientWebsiteUpdate('https://old.example', { website: 'https://old.example' }, {
      url: '',
    })).toEqual({ url: '', properties: { website: '' } });
  });

  it('clears both copies when properties.website is explicitly emptied', () => {
    expect(mergeClientWebsiteUpdate('https://old.example', { website: 'https://old.example', industry: 'IT' }, {
      properties: { website: '' },
    })).toEqual({ url: '', properties: { website: '', industry: 'IT' } });
  });

  it('clears both copies when either explicit field is null', () => {
    expect(mergeClientWebsiteUpdate('https://old.example', { website: 'https://old.example' }, {
      url: null,
    })).toEqual({ url: '', properties: { website: '' } });
    expect(mergeClientWebsiteUpdate('https://old.example', { website: 'https://old.example' }, {
      properties: { website: null },
    })).toEqual({ url: '', properties: { website: '' } });
  });

  it('synchronizes both copies when properties.website alone is set', () => {
    expect(mergeClientWebsiteUpdate('', {}, {
      properties: { website: 'https://new.example' },
    })).toEqual({ url: 'https://new.example', properties: { website: 'https://new.example' } });
  });

  it('uses properties.website when both explicit values disagree', () => {
    expect(mergeClientWebsiteUpdate('', {}, {
      url: 'https://url.example', properties: { website: 'https://properties.example' },
    })).toEqual({ url: 'https://properties.example', properties: { website: 'https://properties.example' } });
  });
});

describe('clientWebsiteFieldsForSave', () => {
  it('omits url and website from an unrelated edit even when the stored copies disagree', () => {
    expect(clientWebsiteFieldsForSave(
      { url: '', properties: { website: 'https://saved.example', industry: 'IT' } },
      { url: '', properties: { website: 'https://saved.example', industry: 'Old' } },
    )).toEqual({ changed: false });
  });

  it('includes both fields when the user deliberately clears the website', () => {
    expect(clientWebsiteFieldsForSave(
      { url: '', properties: { website: '' } },
      { url: 'https://saved.example', properties: { website: 'https://saved.example' } },
    )).toEqual({ changed: true, url: '', website: '' });
  });

  it('ignores a url populated from properties.website while the form loads', () => {
    expect(clientWebsiteFieldsForSave(
      { url: 'https://saved.example', properties: { website: 'https://saved.example' } },
      { url: '', properties: { website: 'https://saved.example' } },
    )).toEqual({ changed: false });
  });

  it('treats an unchanged url-only legacy value as unchanged', () => {
    expect(clientWebsiteFieldsForSave(
      { url: 'https://url-only.example', properties: {} },
      { url: 'https://url-only.example', properties: {} },
    )).toEqual({ changed: false });
  });

  it('detects a changed url-only legacy value', () => {
    expect(clientWebsiteFieldsForSave(
      { url: 'https://new.example', properties: {} },
      { url: 'https://old.example', properties: {} },
    )).toEqual({ changed: true, url: 'https://new.example', website: 'https://new.example' });
  });

  it('detects a deliberate clear against the effective original website', () => {
    expect(clientWebsiteFieldsForSave(
      { url: '', properties: { website: '' } },
      { url: '', properties: { website: 'https://saved.example' } },
    )).toEqual({ changed: true, url: '', website: '' });
  });
});
