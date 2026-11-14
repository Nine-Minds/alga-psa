import { describe, expect, it } from 'vitest';
import { resolveOfflineGraceMinutes } from '../../../lib/integrations/unifi/alerts/reconciliationFetcher';

describe('UniFi offline alert configuration', () => {
  it('uses the default grace and accepts a configured zero-minute grace', () => {
    expect(resolveOfflineGraceMinutes({})).toBe(5);
    expect(resolveOfflineGraceMinutes({ offlineGraceMinutes: 0 })).toBe(0);
    expect(resolveOfflineGraceMinutes({ offlineGraceMinutes: '12' })).toBe(12);
    expect(resolveOfflineGraceMinutes({ offlineGraceMinutes: 'invalid' })).toBe(5);
  });
});
