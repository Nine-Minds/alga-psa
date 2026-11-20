import { describe, expect, it } from 'vitest';
import { audienceGuide, withIdpKind } from '@/components/settings/mcp/idpAudience';

const R = 'https://psa.example.com/api/mcp';
const form = (kind: string, audience: string) => ({ kind, audience, entraTenantId: 't' });

describe('audienceGuide', () => {
  it('suggests a value only for Google, where the agent chooses the audience', () => {
    expect(audienceGuide('google', R).suggested).toBe(R);
    expect(audienceGuide('microsoft', R).suggested).toBe('');
    expect(audienceGuide('custom', R).suggested).toBe('');
  });
});

describe('withIdpKind', () => {
  it('pre-fills Google from an empty audience', () => {
    expect(withIdpKind(form('microsoft', ''), 'google', R)).toEqual(form('google', R));
  });
  it('drops the Google pre-fill when moving to a provider with no suggestion', () => {
    expect(withIdpKind(form('google', R), 'microsoft', R).audience).toBe('');
    expect(withIdpKind(form('google', R), 'custom', R).audience).toBe('');
  });
  it('never overwrites a value the admin typed', () => {
    expect(withIdpKind(form('microsoft', 'abc'), 'google', R).audience).toBe('abc');
    expect(withIdpKind(form('custom', R), 'google', R).audience).toBe(R);
    expect(withIdpKind(form('custom', R), 'microsoft', R).audience).toBe(R);
  });
});
