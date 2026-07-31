/**
 * T068 (sink half) — writeHuduPasswordRevealAudit writes through the repo's
 * audit_logs util with who/when/which only: it sets the app.current_tenant
 * GUC transaction-locally (the audit_logs trigger stamps tenant from it, and
 * auditLog SKIPS when it is unset), and the payload never carries a value-
 * bearing field. Failures propagate so the caller can fail closed.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const auditLogMock = vi.fn();

vi.mock('server/src/lib/logging/auditLog', () => ({
  auditLog: auditLogMock,
}));

async function importSubject() {
  return import('@ee/lib/integrations/hudu/revealAudit');
}

const TENANT = 'tenant-hudu-1';
const CLIENT_ID = '11111111-1111-1111-1111-111111111111';

const rawMock = vi.fn();
const trx = { raw: rawMock } as never;
const knex = {
  transaction: vi.fn(async (fn: (t: never) => Promise<void>) => fn(trx)),
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  auditLogMock.mockResolvedValue(undefined);
  rawMock.mockResolvedValue(undefined);
});

describe('writeHuduPasswordRevealAudit', () => {
  it('sets the tenant GUC transaction-locally, then writes who/when/which via auditLog', async () => {
    const { writeHuduPasswordRevealAudit } = await importSubject();
    await writeHuduPasswordRevealAudit(knex, TENANT, {
      userId: 'user-1',
      clientId: CLIENT_ID,
      huduPasswordId: 42,
      huduCompanyId: '101',
    });

    expect(rawMock).toHaveBeenCalledWith('select set_config(?, ?, true)', ['app.current_tenant', TENANT]);
    expect(rawMock.mock.invocationCallOrder[0]).toBeLessThan(auditLogMock.mock.invocationCallOrder[0]);

    expect(auditLogMock).toHaveBeenCalledTimes(1);
    const [trxArg, payload] = auditLogMock.mock.calls[0];
    expect(trxArg).toBe(trx);
    expect(payload).toEqual({
      userId: 'user-1',
      operation: 'hudu_password_reveal',
      tableName: 'clients',
      recordId: CLIENT_ID,
      changedData: {},
      details: {
        integration: 'hudu',
        tenant: TENANT,
        hudu_password_id: '42',
        hudu_company_id: '101',
        revealed_at: expect.any(String),
      },
    });
    expect(new Date(payload.details.revealed_at).toISOString()).toBe(payload.details.revealed_at);

    // The payload carries no value-bearing key anywhere.
    const keys = [...Object.keys(payload), ...Object.keys(payload.details), ...Object.keys(payload.changedData)];
    for (const key of keys) {
      expect(key.toLowerCase()).not.toMatch(/password$|otp|secret|value|totp/);
    }
  });

  it('propagates audit failures so the reveal fails closed', async () => {
    const { writeHuduPasswordRevealAudit } = await importSubject();
    auditLogMock.mockRejectedValue(new Error('Failed to write audit log'));

    await expect(
      writeHuduPasswordRevealAudit(knex, TENANT, {
        userId: 'user-1',
        clientId: CLIENT_ID,
        huduPasswordId: 42,
        huduCompanyId: '101',
      })
    ).rejects.toThrow('Failed to write audit log');
  });
});
