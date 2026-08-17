import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'prepaidBalanceAlertScanHandler.ts'), 'utf8');

const publishEventMock = vi.fn(async (event: unknown) => undefined);

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: async (event: unknown) => publishEventMock(event),
}));

import { PREPAID_BALANCE_ALERT_SCAN_JOB, prepaidBalanceAlertScanHandler } from './prepaidBalanceAlertScanHandler';

describe('prepaid-balance-alert-scan handler (server-free boundary)', () => {
  it('keeps the handler free of server billing, PostHog, and notification imports', () => {
    expect(source).not.toContain("from '@alga-psa/billing");
    expect(source).not.toContain('featureFlags');
    expect(source).not.toContain('@alga-psa/notifications');
    expect(source).not.toContain('prepaidBalanceAlertEvaluator');
    expect(source).not.toContain('eventBus/subscribers');
    expect(source).toContain("eventType: 'PREPAID_BALANCE_ALERT_SCAN_REQUESTED'");
    expect(source).toContain('publishEvent');
  });

  it('rejects a missing tenant context', async () => {
    await expect(prepaidBalanceAlertScanHandler({} as any)).rejects.toThrow('Tenant ID is required');
    expect(publishEventMock).not.toHaveBeenCalled();
  });

  it('publishes PREPAID_BALANCE_ALERT_SCAN_REQUESTED for a valid tenant', async () => {
    await prepaidBalanceAlertScanHandler({ tenantId: 'tenant-1' });
    expect(publishEventMock).toHaveBeenCalledWith({
      eventType: 'PREPAID_BALANCE_ALERT_SCAN_REQUESTED',
      payload: expect.objectContaining({ tenantId: 'tenant-1' }),
    });
    publishEventMock.mockClear();
  });

  it('forwards an optional client id for targeted scans', async () => {
    await prepaidBalanceAlertScanHandler({ tenantId: 'tenant-1', clientId: 'client-9' });
    expect(publishEventMock).toHaveBeenCalledWith({
      eventType: 'PREPAID_BALANCE_ALERT_SCAN_REQUESTED',
      payload: expect.objectContaining({ tenantId: 'tenant-1', clientId: 'client-9' }),
    });
  });

  it('exposes the canonical job name', () => {
    expect(PREPAID_BALANCE_ALERT_SCAN_JOB).toBe('prepaid-balance-alert-scan');
  });
});
