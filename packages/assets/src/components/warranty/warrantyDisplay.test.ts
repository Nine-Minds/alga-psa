import { describe, expect, it } from 'vitest';
import { canStartWarrantyClaim, classifyWarrantyEnd, humanizeRmaStatus } from './warrantyDisplay';

describe('classifyWarrantyEnd', () => {
  it('classifies none, expired, expiring and active', () => {
    expect(classifyWarrantyEnd(null, '2026-10-25')).toBe('none');
    expect(classifyWarrantyEnd('2026-10-24', '2026-10-25')).toBe('expired');
    expect(classifyWarrantyEnd('2026-10-25', '2026-10-25')).toBe('expiring');
    expect(classifyWarrantyEnd('2026-11-24', '2026-10-25')).toBe('expiring');
    expect(classifyWarrantyEnd('2026-11-25', '2026-10-25')).toBe('active');
  });
});

describe('canStartWarrantyClaim', () => {
  const base = { can_create_claim: true, ownership: 'client' as const, stock_tracked: false, open_claim: null };
  it('allows a permitted client-owned untracked asset without an open claim', () => {
    expect(canStartWarrantyClaim(base)).toBe(true);
  });
  it('refuses without permission, for msp ownership, stock tracking, or an open claim', () => {
    expect(canStartWarrantyClaim({ ...base, can_create_claim: false })).toBe(false);
    expect(canStartWarrantyClaim({ ...base, ownership: 'msp' })).toBe(false);
    expect(canStartWarrantyClaim({ ...base, stock_tracked: true })).toBe(false);
    expect(canStartWarrantyClaim({ ...base, open_claim: {} })).toBe(false);
  });
});

describe('humanizeRmaStatus', () => {
  it('replaces underscores', () => expect(humanizeRmaStatus('sent_to_vendor')).toBe('sent to vendor'));
});
