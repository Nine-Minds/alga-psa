import { describe, it, expect, vi, beforeEach } from 'vitest';

const { publishEventMock } = vi.hoisted(() => ({ publishEventMock: vi.fn(async (_e: any) => undefined) }));
vi.mock('@alga-psa/event-bus/publishers', () => ({ publishEvent: publishEventMock }));
vi.mock('../../actions/timeEntryHelpers', () => ({ getClientIdForWorkItem: vi.fn() }));
vi.mock('../../actions/timeEntryDelegationAuth', () => ({ assertCanActOnBehalf: vi.fn() }));
vi.mock('../../actions/timeEntryChangeRequestActions', () => ({ markTimeEntryChangeRequestsHandled: vi.fn() }));
vi.mock('../contractLineDisambiguation', () => ({ resolveContractLineSelection: vi.fn() }));

import { EventSchemas } from '@alga-psa/event-schemas';
import { publishPersistedTimeEntryEvents, buildPrepaidBlockUsageChangedPayload } from '../timeEntryWriteCore';

/** Wrap like EventBus.publish does before `eventSchema.parse(fullEvent)`. */
const asBusEvent = (payload: unknown) => ({
  id: '6f1d1a3e-0000-4000-8000-000000000001',
  eventType: 'PREPAID_BLOCK_USAGE_CHANGED' as const,
  timestamp: new Date().toISOString(),
  payload,
});

describe('PREPAID_BLOCK_USAGE_CHANGED payload', () => {
  beforeEach(() => publishEventMock.mockClear());

  it('is accepted by the event schema the EventBus enforces on publish', () => {
    const payload = buildPrepaidBlockUsageChangedPayload('tenant-1', { clientId: 'client-1', contractLineId: 'line-1' });
    expect(() => EventSchemas.PREPAID_BLOCK_USAGE_CHANGED.parse(asBusEvent(payload))).not.toThrow();
  });

  it('publishes a schema-valid payload from the real post-commit publisher', async () => {
    await publishPersistedTimeEntryEvents({
      searchEvent: { eventType: 'TIME_ENTRY_UPDATED', payload: { tenantId: 'tenant-1' } },
      prepaidBlockUsage: { clientId: 'client-1', contractLineId: 'line-1' },
    } as any);
    const call = publishEventMock.mock.calls.find((c) => c[0].eventType === 'PREPAID_BLOCK_USAGE_CHANGED');
    expect(call).toBeDefined();
    const parsed = EventSchemas.PREPAID_BLOCK_USAGE_CHANGED.parse(asBusEvent(call![0].payload));
    expect(parsed.payload).toMatchObject({ tenantId: 'tenant-1', clientId: 'client-1', contractLineId: 'line-1' });
    expect(typeof parsed.payload.occurredAt).toBe('string');
  });
});
