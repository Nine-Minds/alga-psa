import { describe, expect, it } from 'vitest';
import { ExternalLinkValidationError, validateLinkTarget } from '../externalLinkPersistence';

describe('validateLinkTarget', () => {
  it('accepts the built-in hudu system with an explicit http(s) url', () => {
    const result = validateLinkTarget([], { system: 'hudu', external_id: ' 42 ', url: 'https://docs.example.com/a/42' });
    expect(result).toMatchObject({ system: 'hudu', external_id: '42', realm: null, url: 'https://docs.example.com/a/42' });
  });

  it('requires a url for hudu (no urlTemplate), so a link is always clickable', () => {
    expect(() => validateLinkTarget([], { system: 'hudu', external_id: '42' })).toThrow(ExternalLinkValidationError);
  });

  it('rejects a blank external id, an unknown system and an unsafe url', () => {
    expect(() => validateLinkTarget([], { system: 'hudu', external_id: '  ', url: 'https://a.example.com' })).toThrowError(/External ID/);
    expect(() => validateLinkTarget([], { system: 'custom:nope', external_id: '1', url: 'https://a.example.com' })).toThrowError(/Unknown external system/);
    expect(() => validateLinkTarget([], { system: 'hudu', external_id: '1', url: 'javascript:alert(1)' })).toThrowError(/URL/);
  });
});
