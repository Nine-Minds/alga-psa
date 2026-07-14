import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  addInteractionMock: vi.fn(),
  publishEventMock: vi.fn(),
  publishWorkflowEventMock: vi.fn(),
  buildInteractionLoggedPayloadMock: vi.fn((payload) => ({ builtPayload: payload })),
  revalidatePathMock: vi.fn(),
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
  createInteractionWithSideEffects,
} from './interactionCreateHelper';

type Row = Record<string, any>;

class LookupQuery {
  private filters: Row = {};

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

  async first(): Promise<Row | undefined> {
    return this.rows.find((row) =>
      Object.entries(this.filters).every(([key, value]) => row[key.split('.').pop()!] === value),
    );
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
});
