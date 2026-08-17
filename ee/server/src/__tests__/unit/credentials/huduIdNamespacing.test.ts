/**
 * Hudu credential row id namespacing: `hudu:{company_id}:{password_id}`.
 * These ids round-trip through the source's build/parse functions and reject
 * malformed shapes fail-closed (a bad id can never be interpreted as a native
 * credential id).
 */

import { describe, expect, it } from 'vitest';
import {
  buildHuduCredentialId,
  HUDU_CREDENTIAL_ID_PREFIX,
  isHuduCredentialId,
  parseHuduCredentialId,
} from '@ee/lib/credentials/huduSource';

describe('Hudu credential id namespacing', () => {
  it('builds the namespaced id from company and password ids', () => {
    expect(buildHuduCredentialId(101, 42)).toBe('hudu:101:42');
    expect(buildHuduCredentialId('101', '42')).toBe('hudu:101:42');
    expect(HUDU_CREDENTIAL_ID_PREFIX).toBe('hudu:');
  });

  it('round-trips through parse', () => {
    expect(parseHuduCredentialId('hudu:101:42')).toEqual({ companyId: '101', passwordId: '42' });
  });

  it('recognizes namespaced ids and rejects native (uuid) ids', () => {
    expect(isHuduCredentialId('hudu:101:42')).toBe(true);
    expect(isHuduCredentialId('11111111-1111-1111-1111-111111111111')).toBe(false);
    expect(isHuduCredentialId('')).toBe(false);
  });

  it('rejects malformed ids fail-closed', () => {
    expect(() => parseHuduCredentialId('hudu:101')).toThrow(/Malformed/);
    expect(() => parseHuduCredentialId('hudu::42')).toThrow(/Malformed/);
    expect(() => parseHuduCredentialId('hudu:101:42:extra')).toThrow(/Malformed/);
    expect(() => parseHuduCredentialId('alga:101:42')).toThrow(/Malformed/);
    expect(() => parseHuduCredentialId('')).toThrow(/Malformed/);
  });
});
