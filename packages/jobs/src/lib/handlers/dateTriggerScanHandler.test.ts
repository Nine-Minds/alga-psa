import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  getTenantTimezone: vi.fn(),
  emitDateDomainEventOnce: vi.fn(),
  findOccurrences: vi.fn(),
  source: {} as any,
}));

vi.mock('@alga-psa/db', () => ({ createTenantKnex: mocks.createTenantKnex }));
vi.mock('@alga-psa/tenancy/actions/tenant-settings-actions/tenantSettingsActions', () => ({ getTenantTimezone: mocks.getTenantTimezone }));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn() } }));
vi.mock('../dateTriggers/emitOnce', () => ({ emitDateDomainEventOnce: mocks.emitDateDomainEventOnce }));
vi.mock('../dateTriggers/registry', () => ({ dateTriggerSources: [mocks.source] }));

import { createDateTriggerScanHandler } from './dateTriggerScanHandler';

describe('date-trigger-scan handler', () => {
  const knex = { destroy: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createTenantKnex.mockResolvedValue({ knex });
    mocks.getTenantTimezone.mockResolvedValue('Pacific/Kiritimati');
    mocks.findOccurrences.mockResolvedValue([{
      entityId: 'client-1', clientId: 'client-1', occursOn: '2026-09-24', cycleKey: '2026-09-24', payload: {},
    }]);
    mocks.source.id = 'client.anniversary';
    mocks.source.payloadSchemaRef = 'payload.ClientAnniversary.v1';
    mocks.source.domainEvent = { eventType: 'CLIENT_ANNIVERSARY_UPCOMING', windowDays: 30, buildPayload: vi.fn(() => ({ clientId: 'client-1' })) };
    mocks.source.findOccurrences = mocks.findOccurrences;
    mocks.emitDateDomainEventOnce.mockResolvedValue(true);
  });

  it('uses the tenant local date, emits domain events once per occurrence, then launches EE workflows', async () => {
    const launch = vi.fn();
    const handler = createDateTriggerScanHandler(launch, () => new Date('2026-09-24T10:30:00.000Z'));

    await handler({ tenantId: 'tenant-1' });

    expect(mocks.findOccurrences).toHaveBeenCalledWith(knex, 'tenant-1', '2026-09-25', '2026-10-25');
    expect(mocks.emitDateDomainEventOnce).toHaveBeenCalledWith(knex, 'tenant-1', expect.objectContaining({
      eventType: 'CLIENT_ANNIVERSARY_UPCOMING', entityId: 'client-1', cycleKey: '2026-09-24', occursOn: '2026-09-24',
    }));
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1', today: '2026-09-25', timezone: 'Pacific/Kiritimati', now: new Date('2026-09-24T10:30:00.000Z'), knex,
    }));
    expect(knex.destroy).toHaveBeenCalledOnce();
  });

  it('uses the tenant calendar across a DST transition and a UTC-12 boundary', async () => {
    const handler = createDateTriggerScanHandler(undefined, () => new Date('2026-03-08T07:30:00.000Z'), async () => 'America/New_York');
    await handler({ tenantId: 'tenant-1' });
    expect(mocks.findOccurrences).toHaveBeenLastCalledWith(knex, 'tenant-1', '2026-03-08', '2026-04-07');

    mocks.findOccurrences.mockClear();
    const utcMinusTwelve = createDateTriggerScanHandler(undefined, () => new Date('2026-09-24T10:30:00.000Z'), async () => 'Etc/GMT+12');
    await utcMinusTwelve({ tenantId: 'tenant-1' });
    expect(mocks.findOccurrences).toHaveBeenLastCalledWith(knex, 'tenant-1', '2026-09-23', '2026-10-23');
  });

  it('rejects a missing tenant and destroys its connection after a scan failure', async () => {
    const handler = createDateTriggerScanHandler(undefined, () => new Date('invalid'));
    await expect(handler({ tenantId: '' })).rejects.toThrow('Tenant ID is required');
    await expect(handler({ tenantId: 'tenant-1' })).rejects.toThrow('Invalid date-trigger-scan clock value');
    expect(knex.destroy).toHaveBeenCalledOnce();
  });
});
