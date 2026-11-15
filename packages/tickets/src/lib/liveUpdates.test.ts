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

import {
  diffTicketFields,
  getTicketUpdateChannel,
  publishTicketUpdate,
  resetTicketUpdatePublisherClientForTests,
  setTicketUpdateEventBusLoaderForTests,
} from './liveUpdates';

describe('live ticket update helpers', () => {
  beforeEach(async () => {
    await resetTicketUpdatePublisherClientForTests();
    vi.clearAllMocks();
    setTicketUpdateEventBusLoaderForTests(async () => ({
      getRedisClient: () => getRedisClientMock(),
    }));
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
    expect(disconnectMock).not.toHaveBeenCalled();
  });

  it('T003: publishTicketUpdate reuses the Redis publisher client across successful publishes', async () => {
    await publishTicketUpdate({
      tenantId: 'tenant-1',
      ticketId: 'ticket-9',
      updatedFields: ['status_id'],
      updatedBy: {
        userId: 'user-1',
        displayName: 'Pat Agent',
      },
      updatedAt: '2026-05-07T12:00:00.000Z',
    });

    await publishTicketUpdate({
      tenantId: 'tenant-1',
      ticketId: 'ticket-9',
      updatedFields: ['priority_id'],
      updatedBy: {
        userId: 'user-1',
        displayName: 'Pat Agent',
      },
      updatedAt: '2026-05-07T12:01:00.000Z',
    });

    expect(getRedisClientMock).toHaveBeenCalledTimes(1);
    expect(publishMock).toHaveBeenCalledTimes(2);
    expect(disconnectMock).not.toHaveBeenCalled();
  });

  it('T004: publishTicketUpdate swallows Redis publish errors and resets the cached client', async () => {
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

    await publishTicketUpdate({
      tenantId: 'tenant-1',
      ticketId: 'ticket-9',
      updatedFields: ['priority_id'],
      updatedBy: {
        userId: 'user-1',
        displayName: 'Pat Agent',
      },
      updatedAt: '2026-05-07T12:01:00.000Z',
    });

    expect(getRedisClientMock).toHaveBeenCalledTimes(2);

    warnSpy.mockRestore();
  });

  it('T056: publishTicketUpdate payload contains only field names and update metadata', async () => {
    await publishTicketUpdate({
      tenantId: 'tenant-1',
      ticketId: 'ticket-9',
      updatedFields: ['title'],
      updatedBy: {
        userId: 'user-1',
        displayName: 'Pat Agent',
      },
      updatedAt: '2026-05-07T12:00:00.000Z',
    });

    const [, payloadJson] = publishMock.mock.calls.at(-1) ?? [];
    const payload = JSON.parse(payloadJson);

    expect(payload).toEqual({
      updatedFields: ['title'],
      updatedBy: {
        userId: 'user-1',
        displayName: 'Pat Agent',
      },
      updatedAt: '2026-05-07T12:00:00.000Z',
    });
    expect(payload).not.toHaveProperty('remoteValue');
    expect(payload).not.toHaveProperty('title');
    expect(JSON.stringify(payload)).not.toContain('Original');
    expect(JSON.stringify(payload)).not.toContain('Resolved');
  });
  it('publishes a qualified MSP actor with a null local user and rejects mixed/cross-owner identities', async () => {
    const tenantId = '00000000-0000-4000-8000-000000000001';
    const actorReference = { ownerTenantId: tenantId, referenceId: '00000000-0000-4000-8000-000000000002',
      tenantId: '00000000-0000-4000-8000-000000000003', userId: '00000000-0000-4000-8000-000000000004',
      displayName: 'Morgan', organizationName: 'Partner' };
    const params = { tenantId, ticketId: 'ticket-1', updatedFields: ['title'], updatedAt: '2026-09-06T20:00:00.000Z',
      updatedBy: { userId: null, displayName: 'Ignored unqualified label', actorReference } };
    await publishTicketUpdate(params);
    expect(JSON.parse(publishMock.mock.calls[0][1]).updatedBy)
      .toEqual({ userId: null, displayName: 'Morgan (Partner)', actorReference });
    publishMock.mockClear();
    await expect(publishTicketUpdate({ ...params, updatedBy: { ...params.updatedBy, userId: actorReference.userId } } as any))
      .rejects.toThrow('Invalid ticket live update actor');
    await expect(publishTicketUpdate({ ...params, tenantId: actorReference.tenantId }))
      .rejects.toThrow('Invalid ticket live update actor');
    expect(publishMock).not.toHaveBeenCalled();
  });

});
