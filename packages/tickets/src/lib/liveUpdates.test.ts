import { beforeEach, describe, expect, it, vi } from 'vitest';

const publishMock = vi.fn();
const disconnectMock = vi.fn();
const getRedisClientMock = vi.fn(async () => ({
  publish: publishMock,
  disconnect: disconnectMock,
}));
const getRedisConfigMock = vi.fn(() => ({ prefix: 'alga-psa:' }));

vi.mock('@alga-psa/event-bus', () => ({
  getRedisClient: () => getRedisClientMock(),
  getRedisConfig: () => getRedisConfigMock(),
}));

import { diffTicketFields, getTicketUpdateChannel, publishTicketUpdate } from './liveUpdates';

describe('live ticket update helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LIVE_TICKET_UPDATES_DISABLED;
  });

  it('T001: diffTicketFields returns only changed field names and handles null + JSONB equality', () => {
    const currentRow = {
      title: 'Original',
      status_id: 'status-1',
      assigned_to: null,
      attributes: {
        severity: 'high',
        flags: ['vip', 'paged'],
        nested: {
          source: 'email',
          active: true,
        },
      },
    };

    const updatedFields = diffTicketFields(currentRow, {
      title: 'Original',
      status_id: 'status-2',
      assigned_to: 'user-2',
      attributes: {
        nested: {
          active: true,
          source: 'email',
        },
        flags: ['vip', 'paged'],
        severity: 'high',
      },
    });

    expect(updatedFields).toEqual(['status_id', 'assigned_to']);
  });

  it('T002: publishTicketUpdate publishes the expected payload to the tenant ticket channel', async () => {
    await publishTicketUpdate({
      tenantId: 'tenant-1',
      ticketId: 'ticket-9',
      updatedFields: ['status_id', 'priority_id'],
      updatedBy: {
        userId: 'user-1',
        displayName: 'Pat Agent',
      },
      updatedAt: '2026-05-07T12:00:00.000Z',
    });

    expect(publishMock).toHaveBeenCalledWith(
      getTicketUpdateChannel('tenant-1', 'ticket-9'),
      JSON.stringify({
        updatedFields: ['status_id', 'priority_id'],
        updatedBy: {
          userId: 'user-1',
          displayName: 'Pat Agent',
        },
        updatedAt: '2026-05-07T12:00:00.000Z',
      })
    );
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  it('T003: publishTicketUpdate swallows Redis publish errors', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    publishMock.mockRejectedValueOnce(new Error('redis is down'));

    await expect(
      publishTicketUpdate({
        tenantId: 'tenant-1',
        ticketId: 'ticket-9',
        updatedFields: ['status_id'],
        updatedBy: {
          userId: 'user-1',
          displayName: 'Pat Agent',
        },
        updatedAt: '2026-05-07T12:00:00.000Z',
      })
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      '[publishTicketUpdate] Failed to publish live ticket update:',
      expect.any(Error)
    );
    expect(disconnectMock).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });
});
