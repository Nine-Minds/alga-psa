import { describe, expect, it } from 'vitest';
import { isEmailInboundProductCode } from '../productAccess';

describe('inbound email product access', () => {
  it.each(['psa', 'algadesk'])('still accepts %s', (code) => {
    expect(isEmailInboundProductCode(code)).toBe(true);
  });

  it('accepts co_managed workspaces so replies to their notifications are received', () => {
    expect(isEmailInboundProductCode('co_managed')).toBe(true);
  });

  it('treats a missing product code as legacy psa', () => {
    expect(isEmailInboundProductCode(undefined)).toBe(true);
    expect(isEmailInboundProductCode(null)).toBe(true);
  });

  it.each(['enterprise', 'PSA', '', 'co-managed'])('still rejects unknown product code %j', (code) => {
    expect(isEmailInboundProductCode(code)).toBe(false);
  });
});
