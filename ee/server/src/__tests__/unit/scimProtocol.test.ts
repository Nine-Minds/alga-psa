import { describe, expect, it } from 'vitest';

import {
  parsePatchOperations,
  parseScimFilter,
  parseScimUser,
  SCIM_PATCH_SCHEMA,
  SCIM_USER_SCHEMA,
} from '@ee/lib/scim/protocol';
import {
  generateScimToken,
  hashScimToken,
  verifyScimToken,
} from '@ee/lib/scim/credentials';
import {
  SCIM_SERVICE_PROVIDER_CONFIG,
  scimResourceTypes,
} from '@ee/lib/scim/service';

describe('SCIM protocol and credentials', () => {
  it('generates a one-time token whose stored value is a salted hash', () => {
    const generated = generateScimToken();

    expect(generated.plaintext).toMatch(/^alga_scim_[A-Za-z0-9_-]{40,}$/);
    expect(generated.hash).toMatch(/^scrypt\$/);
    expect(generated.hash).not.toContain(generated.plaintext);
    expect(verifyScimToken(generated.plaintext, generated.hash)).toBe(true);
    expect(verifyScimToken(`${generated.plaintext}x`, generated.hash)).toBe(false);
    expect(hashScimToken(generated.plaintext)).not.toBe(generated.hash);
  });

  it('requires a stable externalId and an explicit primary email', () => {
    const user = parseScimUser({
      schemas: [SCIM_USER_SCHEMA],
      externalId: 'entra-object-1',
      userName: 'Ada@Example.com',
      active: true,
      emails: [
        { value: 'alias@example.com', type: 'other' },
        { value: 'Ada@Example.com', type: 'work', primary: true },
      ],
      displayName: 'Ada Lovelace',
      name: { givenName: 'Ada', familyName: 'Lovelace' },
    });

    expect(user).toMatchObject({
      externalId: 'entra-object-1',
      userName: 'Ada@Example.com',
      primaryEmail: 'Ada@Example.com',
      active: true,
    });
  });

  it('accepts only the supported exact filters', () => {
    expect(parseScimFilter('userName eq "ada@example.com"')).toEqual({
      attribute: 'userName',
      value: 'ada@example.com',
    });
    expect(parseScimFilter('externalId eq "object-1"')).toEqual({
      attribute: 'externalId',
      value: 'object-1',
    });
    expect(() => parseScimFilter('displayName co "Ada"')).toThrowError(
      expect.objectContaining({ status: 400, scimType: 'invalidFilter' })
    );
  });

  it('parses Entra-style lifecycle PATCH operations', () => {
    expect(parsePatchOperations({
      schemas: [SCIM_PATCH_SCHEMA],
      Operations: [
        { op: 'Replace', path: 'active', value: false },
      ],
    })).toEqual([
      { op: 'replace', path: 'active', value: false },
    ]);
  });

  it('advertises Users and PATCH while excluding Groups, Bulk, and sorting', () => {
    const resourceTypes = scimResourceTypes('https://example.test/api/scim/v2/connection');

    expect(SCIM_SERVICE_PROVIDER_CONFIG.patch).toEqual({ supported: true });
    expect(SCIM_SERVICE_PROVIDER_CONFIG.bulk).toMatchObject({ supported: false });
    expect(SCIM_SERVICE_PROVIDER_CONFIG.sort).toEqual({ supported: false });
    expect(resourceTypes).toMatchObject({
      totalResults: 1,
      Resources: [{ id: 'User', endpoint: '/Users' }],
    });
    expect(JSON.stringify(resourceTypes)).not.toContain('Group');
  });
});
