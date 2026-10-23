import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auditLogMock, createTenantKnexMock } = vi.hoisted(() => ({
  auditLogMock: vi.fn(),
  createTenantKnexMock: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: unknown[]) => createTenantKnexMock(...args),
  auditLog: (...args: unknown[]) => auditLogMock(...args),
}));

import {
  checkAuthVerificationLimit,
  checkPasswordResetLimit,
  checkPortalInvitationLimit,
  checkRegistrationLimit,
  formatRateLimitError,
  logSecurityEvent,
} from './rateLimiting';

// The limiters are module singletons, so every test uses its own key.
let seq = 0;
const key = () => `key-${++seq}-${Date.now()}`;

beforeEach(() => {
  auditLogMock.mockReset();
  createTenantKnexMock.mockReset().mockResolvedValue({ knex: { fake: true } });
});

describe('limits', () => {
  it('password reset allows three requests per address, then blocks with a wait', async () => {
    const email = `${key()}@example.com`;
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await checkPasswordResetLimit(email));
    expect(results.slice(0, 3).map((r) => r.success)).toEqual([true, true, true]);
    expect(results.slice(0, 3).map((r) => r.remainingPoints)).toEqual([2, 1, 0]);
    expect(results[3].success).toBe(false);
    expect(results[3].msBeforeNext).toBeGreaterThan(0);
    expect(await formatRateLimitError(results[3].msBeforeNext)).toBe('Too many attempts. Please try again in 15 minutes.');
  });

  it('password reset counts the address case-insensitively', async () => {
    const base = key();
    await checkPasswordResetLimit(`${base}@Example.com`.toUpperCase());
    await checkPasswordResetLimit(`${base}@example.com`);
    const third = await checkPasswordResetLimit(`${base}@EXAMPLE.COM`);
    expect(third).toMatchObject({ success: true, remainingPoints: 0 });
    expect((await checkPasswordResetLimit(`${base}@example.com`)).success).toBe(false);
  });

  it('registration allows five per address', async () => {
    const email = `${key()}@example.com`;
    for (let i = 0; i < 5; i++) expect((await checkRegistrationLimit(email)).success).toBe(true);
    expect((await checkRegistrationLimit(email)).success).toBe(false);
  });

  it('auth verification allows five per identifier', async () => {
    const id = key();
    for (let i = 0; i < 5; i++) expect((await checkAuthVerificationLimit(id)).success).toBe(true);
    expect((await checkAuthVerificationLimit(id)).success).toBe(false);
  });

  it('portal invitations allow three per user', async () => {
    const id = key();
    for (let i = 0; i < 3; i++) expect((await checkPortalInvitationLimit(id)).success).toBe(true);
    expect((await checkPortalInvitationLimit(id)).success).toBe(false);
  });

  it('keeps separate buckets per key', async () => {
    const a = key(); const b = key();
    for (let i = 0; i < 3; i++) await checkPortalInvitationLimit(a);
    expect((await checkPortalInvitationLimit(a)).success).toBe(false);
    expect((await checkPortalInvitationLimit(b)).success).toBe(true);
  });
});

describe('formatRateLimitError', () => {
  it('rounds the wait up to whole minutes and pluralizes', async () => {
    expect(await formatRateLimitError(undefined)).toBe('Too many attempts. Please try again later.');
    expect(await formatRateLimitError(0)).toBe('Too many attempts. Please try again later.');
    expect(await formatRateLimitError(30_000)).toBe('Too many attempts. Please try again in 1 minute.');
    expect(await formatRateLimitError(60_001)).toBe('Too many attempts. Please try again in 2 minutes.');
    expect(await formatRateLimitError(5 * 60_000)).toBe('Too many attempts. Please try again in 5 minutes.');
  });
});

describe('logSecurityEvent', () => {
  it('writes an audit row on the tenant connection with the tenant in the details', async () => {
    await logSecurityEvent('t1', 'password_reset_requested', { recordId: 'u1', ip: '10.0.0.1' });
    expect(createTenantKnexMock).toHaveBeenCalledWith('t1');
    expect(auditLogMock).toHaveBeenCalledWith({ fake: true }, {
      operation: 'password_reset_requested',
      tableName: 'audit_log',
      recordId: 'u1',
      changedData: {},
      details: { recordId: 'u1', ip: '10.0.0.1', tenant: 't1' },
    });
  });

  it('falls back to audit_log and unknown when the event names no table or record', async () => {
    await logSecurityEvent('t1', 'login_blocked', {});
    expect(auditLogMock.mock.calls[0][1]).toMatchObject({ tableName: 'audit_log', recordId: 'unknown' });
  });
});
