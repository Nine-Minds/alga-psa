import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  addInteractionMock: vi.fn(),
  publishEventMock: vi.fn(),
  publishWorkflowEventMock: vi.fn(),
  buildInteractionLoggedPayloadMock: vi.fn((payload) => ({ builtPayload: payload })),
  revalidatePathMock: vi.fn(),
  scheduleEntryCreateMock: vi.fn(),
  scheduleEntryUpdateMock: vi.fn(),
  scheduleEntryDeleteMock: vi.fn(),
  scheduleEntryGetByWorkItemMock: vi.fn(),
}));

vi.mock('@alga-psa/shared/models/scheduleEntry', () => ({
  default: {
    create: hoisted.scheduleEntryCreateMock,
    update: hoisted.scheduleEntryUpdateMock,
    delete: hoisted.scheduleEntryDeleteMock,
    getByWorkItem: hoisted.scheduleEntryGetByWorkItemMock,
  },
}));

vi.mock('../models/interactions', () => ({
  default: {
    addInteraction: hoisted.addInteractionMock,
  },
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: hoisted.publishEventMock,
  publishWorkflowEvent: hoisted.publishWorkflowEventMock,
}));

vi.mock('@alga-psa/workflow-streams', () => ({
  buildInteractionLoggedPayload: hoisted.buildInteractionLoggedPayloadMock,
}));

vi.mock('next/cache', () => ({
  revalidatePath: hoisted.revalidatePathMock,
}));

import {
  createInteractionRecord,
  createInteractionScheduleEntry,
  createInteractionWithSideEffects,
  deleteInteractionScheduleEntries,
  syncInteractionScheduleEntries,
} from './interactionCreateHelper';

type Row = Record<string, any>;

class LookupQuery {
  private filters: Row = {};
  private orderColumn: string | null = null;

  constructor(private readonly rows: Row[]) {}

  where(filters: Row | string, value?: unknown): this {
    this.filters = typeof filters === 'string'
      ? { ...this.filters, [filters]: value }
      : { ...this.filters, ...filters };
    return this;
  }

  select(..._columns: string[]): this {
    return this;
  }

  orderBy(column: string): this {
    this.orderColumn = column;
    return this;
  }

  async first(): Promise<Row | undefined> {
    const matches = this.rows.filter((row) =>
      Object.entries(this.filters).every(([key, value]) => row[key.split('.').pop()!] === value),
    );
    if (this.orderColumn) {
      const column = this.orderColumn;
      matches.sort((a, b) => (a[column] || 0) - (b[column] || 0));
    }
    return matches[0];
  }
}

function createLookupTrx(tables: { statuses?: Row[]; contacts?: Row[] }) {
  return ((tableName: 'statuses' | 'contacts') => new LookupQuery(tables[tableName] ?? [])) as any;
}

function interactionInput(overrides: Row = {}) {
  return {
    type_id: 'type-online-meeting',
    title: 'Support review',
    notes: 'Meeting notes',
    user_id: 'user-1',
    contact_name_id: null,
    client_id: 'client-1',
    ticket_id: null,
    duration: null,
    ...overrides,
  };
}

describe('interactionCreateHelper', () => {
  beforeEach(() => {
    hoisted.addInteractionMock.mockReset();
    hoisted.publishEventMock.mockReset().mockResolvedValue(undefined);
    hoisted.publishWorkflowEventMock.mockReset().mockResolvedValue(undefined);
    hoisted.buildInteractionLoggedPayloadMock.mockClear();
    hoisted.revalidatePathMock.mockReset();
    hoisted.scheduleEntryCreateMock.mockReset().mockImplementation(async (_trx, tenant, entry) => ({
      entry_id: 'schedule-entry-1',
      tenant,
      ...entry,
    }));
    hoisted.scheduleEntryUpdateMock.mockReset();
    hoisted.scheduleEntryDeleteMock.mockReset().mockResolvedValue(true);
    hoisted.scheduleEntryGetByWorkItemMock.mockReset().mockResolvedValue([]);

    hoisted.addInteractionMock.mockImplementation(async (data, tenant, trx) => ({
      interaction_id: 'interaction-1',
      type_name: 'Online Meeting',
      icon: 'video',
      contact_name: null,
      client_name: null,
      user_name: null,
      status_name: 'Open',
      is_status_closed: false,
      ...data,
      tenant,
      _trx: trx,
    }));
  });

  it('resolves the default interaction status when none is provided', async () => {
    const trx = createLookupTrx({
      statuses: [{ tenant: 'tenant-1', is_default: true, status_type: 'interaction', status_id: 'status-default' }],
    });

    await createInteractionRecord({
      tenant: 'tenant-1',
      trx,
      interactionData: interactionInput(),
    });

    expect(hoisted.addInteractionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status_id: 'status-default',
        client_id: 'client-1',
        tenant: 'tenant-1',
      }),
      'tenant-1',
      trx,
    );
  });

  it('resolves client_id from contact_name_id and rejects unresolved contacts', async () => {
    const trx = createLookupTrx({
      statuses: [{ tenant: 'tenant-1', is_default: true, status_type: 'interaction', status_id: 'status-default' }],
      contacts: [{ tenant: 'tenant-1', contact_name_id: 'contact-1', client_id: 'client-from-contact' }],
    });

    await createInteractionRecord({
      tenant: 'tenant-1',
      trx,
      interactionData: interactionInput({ client_id: null, contact_name_id: 'contact-1' }),
    });

    expect(hoisted.addInteractionMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        client_id: 'client-from-contact',
        contact_name_id: 'contact-1',
      }),
      'tenant-1',
      trx,
    );

    const unresolvedTrx = createLookupTrx({
      statuses: [{ tenant: 'tenant-1', is_default: true, status_type: 'interaction', status_id: 'status-default' }],
      contacts: [{ tenant: 'tenant-1', contact_name_id: 'contact-1', client_id: null }],
    });

    await expect(createInteractionRecord({
      tenant: 'tenant-1',
      trx: unresolvedTrx,
      interactionData: interactionInput({ client_id: null, contact_name_id: 'contact-1' }),
    })).rejects.toThrow('Interactions must be linked to a client');
  });

  it('publishes interaction workflow/search events after creation side effects run', async () => {
    const trx = createLookupTrx({
      statuses: [{ tenant: 'tenant-1', is_default: true, status_type: 'interaction', status_id: 'status-default' }],
    });

    const result = await createInteractionWithSideEffects({
      tenant: 'tenant-1',
      trx,
      user: { user_id: 'user-1' },
      interactionData: interactionInput({
        interaction_date: new Date('2026-06-01T15:00:00.000Z'),
      }),
    });

    expect(hoisted.publishWorkflowEventMock).not.toHaveBeenCalled();
    expect(hoisted.publishEventMock).not.toHaveBeenCalled();

    await result.publishSideEffects();

    expect(hoisted.publishWorkflowEventMock).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'INTERACTION_LOGGED',
      ctx: expect.objectContaining({
        tenantId: 'tenant-1',
        actor: { actorType: 'USER', actorUserId: 'user-1' },
      }),
      idempotencyKey: 'interaction_logged:interaction-1:2026-06-01T15:00:00.000Z',
    }));
    expect(hoisted.publishEventMock).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'INTERACTION_CREATED',
      payload: expect.objectContaining({
        tenantId: 'tenant-1',
        interactionId: 'interaction-1',
        clientId: 'client-1',
        userId: 'user-1',
      }),
    }));
  });

  it('revalidates contact and client pages after creation side effects run', async () => {
    const trx = createLookupTrx({
      statuses: [{ tenant: 'tenant-1', is_default: true, status_type: 'interaction', status_id: 'status-default' }],
    });

    const result = await createInteractionWithSideEffects({
      tenant: 'tenant-1',
      trx,
      interactionData: interactionInput(),
    });

    await result.publishSideEffects();

    expect(hoisted.revalidatePathMock).toHaveBeenCalledWith('/msp/contacts/[id]', 'page');
    expect(hoisted.revalidatePathMock).toHaveBeenCalledWith('/msp/clients/[id]', 'page');
  });

  it('falls back to the lowest-order open status when no default is configured', async () => {
    const trx = createLookupTrx({
      statuses: [
        { tenant: 'tenant-1', status_type: 'interaction', status_id: 'status-completed', is_closed: true, order_number: 3 },
        { tenant: 'tenant-1', status_type: 'interaction', status_id: 'status-in-progress', is_closed: false, order_number: 2 },
        { tenant: 'tenant-1', status_type: 'interaction', status_id: 'status-planned', is_closed: false, order_number: 1 },
      ],
    });

    await createInteractionRecord({
      tenant: 'tenant-1',
      trx,
      interactionData: interactionInput(),
    });

    expect(hoisted.addInteractionMock).toHaveBeenCalledWith(
      expect.objectContaining({ status_id: 'status-planned' }),
      'tenant-1',
      trx,
    );
  });

  it('ignores a closed default status so new interactions do not start finished', async () => {
    const trx = createLookupTrx({
      statuses: [
        { tenant: 'tenant-1', status_type: 'interaction', status_id: 'status-completed', is_default: true, is_closed: true, order_number: 3 },
        { tenant: 'tenant-1', status_type: 'interaction', status_id: 'status-planned', is_default: false, is_closed: false, order_number: 1 },
      ],
    });

    await createInteractionRecord({
      tenant: 'tenant-1',
      trx,
      interactionData: interactionInput(),
    });

    expect(hoisted.addInteractionMock).toHaveBeenCalledWith(
      expect.objectContaining({ status_id: 'status-planned' }),
      'tenant-1',
      trx,
    );
  });

  it('throws when the tenant has no open interaction status to fall back to', async () => {
    const trx = createLookupTrx({
      statuses: [
        { tenant: 'tenant-1', status_type: 'interaction', status_id: 'status-completed', is_closed: true, order_number: 3 },
      ],
    });

    await expect(createInteractionRecord({
      tenant: 'tenant-1',
      trx,
      interactionData: interactionInput(),
    })).rejects.toThrow('No default status found for interactions');
  });

  describe('schedule entries', () => {
    const interaction = {
      interaction_id: 'interaction-1',
      title: 'Follow-up call',
      start_time: new Date('2026-06-01T15:00:00.000Z'),
      end_time: new Date('2026-06-01T15:30:00.000Z'),
      duration: 30,
    } as any;

    it('books the interaction on the assignees calendar and publishes after commit', async () => {
      const result = await createInteractionScheduleEntry({
        tenant: 'tenant-1',
        trx: {} as any,
        interaction,
        assignedUserIds: ['user-1'],
        assignedByUserId: 'user-1',
      });

      expect(hoisted.scheduleEntryCreateMock).toHaveBeenCalledWith(
        expect.anything(),
        'tenant-1',
        expect.objectContaining({
          title: 'Follow-up call',
          work_item_type: 'interaction',
          work_item_id: 'interaction-1',
          status: 'scheduled',
          scheduled_start: interaction.start_time,
          scheduled_end: interaction.end_time,
        }),
        { assignedUserIds: ['user-1'], assignedByUserId: 'user-1' },
      );
      expect(hoisted.publishEventMock).not.toHaveBeenCalled();

      await result!.publishScheduleEntryCreated();

      expect(hoisted.publishEventMock).toHaveBeenCalledWith(expect.objectContaining({
        eventType: 'SCHEDULE_ENTRY_CREATED',
        payload: expect.objectContaining({
          tenantId: 'tenant-1',
          entryId: 'schedule-entry-1',
        }),
      }));
    });

    it('derives an end time from the duration when the interaction has none', async () => {
      await createInteractionScheduleEntry({
        tenant: 'tenant-1',
        trx: {} as any,
        interaction: { ...interaction, end_time: undefined, duration: 45 },
        assignedUserIds: ['user-1'],
        assignedByUserId: 'user-1',
      });

      expect(hoisted.scheduleEntryCreateMock).toHaveBeenCalledWith(
        expect.anything(),
        'tenant-1',
        expect.objectContaining({ scheduled_end: new Date('2026-06-01T15:45:00.000Z') }),
        expect.anything(),
      );
    });

    it('skips creation when the interaction has no start time', async () => {
      const result = await createInteractionScheduleEntry({
        tenant: 'tenant-1',
        trx: {} as any,
        interaction: { ...interaction, start_time: undefined },
        assignedUserIds: ['user-1'],
        assignedByUserId: 'user-1',
      });

      expect(result).toBeNull();
      expect(hoisted.scheduleEntryCreateMock).not.toHaveBeenCalled();
    });

    it('removes the linked schedule entries when the interaction is deleted', async () => {
      hoisted.scheduleEntryGetByWorkItemMock.mockResolvedValue([
        { entry_id: 'schedule-entry-1' },
        { entry_id: 'schedule-entry-2' },
      ]);

      const deleted = await deleteInteractionScheduleEntries({} as any, 'tenant-1', 'interaction-1');

      expect(hoisted.scheduleEntryGetByWorkItemMock).toHaveBeenCalledWith(
        expect.anything(),
        'tenant-1',
        'interaction-1',
        'interaction',
      );
      expect(hoisted.scheduleEntryDeleteMock).toHaveBeenCalledTimes(2);
      expect(deleted).toEqual(['schedule-entry-1', 'schedule-entry-2']);
    });

    it('moves and renames the linked schedule entry when the interaction changes', async () => {
      hoisted.scheduleEntryGetByWorkItemMock.mockResolvedValue([{ entry_id: 'schedule-entry-1' }]);

      await syncInteractionScheduleEntries({} as any, 'tenant-1', interaction);

      expect(hoisted.scheduleEntryUpdateMock).toHaveBeenCalledWith(
        expect.anything(),
        'tenant-1',
        'schedule-entry-1',
        {
          title: 'Follow-up call',
          scheduled_start: interaction.start_time,
          scheduled_end: interaction.end_time,
        },
      );
    });

    it('removes the linked schedule entry when the interaction loses its start time', async () => {
      hoisted.scheduleEntryGetByWorkItemMock.mockResolvedValue([{ entry_id: 'schedule-entry-1' }]);

      await syncInteractionScheduleEntries({} as any, 'tenant-1', { ...interaction, start_time: null });

      expect(hoisted.scheduleEntryUpdateMock).not.toHaveBeenCalled();
      expect(hoisted.scheduleEntryDeleteMock).toHaveBeenCalledWith(
        expect.anything(),
        'tenant-1',
        'schedule-entry-1',
      );
    });
  });
});
