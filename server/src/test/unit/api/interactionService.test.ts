import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createInteractionWithSideEffects: vi.fn(),
  createInteractionScheduleEntry: vi.fn(),
  hasPermission: vi.fn(),
  tenantDb: vi.fn(),
  withTransaction: vi.fn(async (_knex: unknown, callback: (trx: unknown) => unknown) => callback({ trx: true })),
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    tenantDb: mocks.tenantDb,
    withTransaction: mocks.withTransaction,
  };
});

vi.mock('@alga-psa/clients/actions/interactionCreateHelper', () => ({
  createInteractionWithSideEffects: mocks.createInteractionWithSideEffects,
  createInteractionScheduleEntry: mocks.createInteractionScheduleEntry,
  resolveScheduleAssignees: (creator: string, requested?: string[]) => requested?.length ? [...new Set(requested)] : [creator],
}));

vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.hasPermission }));

import { InteractionService } from '../../../lib/api/services/InteractionService';

const context = {
  tenant: 'tenant-1',
  userId: 'user-1',
  user: { user_id: 'user-1' },
  db: { raw: vi.fn((sql: string) => sql) } as any,
};

function queryResolving<T>(result: T) {
  const query: any = {
    where: vi.fn(),
    select: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
    count: vi.fn(),
    first: vi.fn(),
    then: (resolve: (value: T) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  query.where.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.offset.mockReturnValue(query);
  query.count.mockReturnValue(query);
  return query;
}

describe('InteractionService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.withTransaction.mockImplementation(async (_knex, callback) => callback({ trx: true }));
    mocks.createInteractionWithSideEffects.mockResolvedValue({
      interaction: { interaction_id: 'interaction-1' },
      publishSideEffects: vi.fn(),
    });
  });

  const scheduleInput = {
    type_id: '11111111-1111-4111-8111-111111111111',
    client_id: '22222222-2222-4222-8222-222222222222',
    start_time: '2026-10-01T12:00:00.000Z',
    create_schedule_entry: true,
  };

  it.each([undefined, [], ['user-1']])('books self without a schedule permission check (%j)', async (ids) => {
    const publish = vi.fn();
    mocks.createInteractionScheduleEntry.mockResolvedValue({ publishScheduleEntryCreated: publish });
    await new InteractionService().create({ ...scheduleInput, schedule_assigned_user_ids: ids }, context);
    expect(mocks.hasPermission).not.toHaveBeenCalled();
    expect(mocks.createInteractionScheduleEntry).toHaveBeenCalledWith({
      tenant: context.tenant,
      trx: { trx: true },
      interaction: { interaction_id: 'interaction-1' },
      assignedUserIds: ['user-1'],
      assignedByUserId: 'user-1',
    });
    expect(publish).toHaveBeenCalledOnce();
    expect(mocks.withTransaction.mock.invocationCallOrder[0]).toBeLessThan(publish.mock.invocationCallOrder[0]);
  });

  it('rejects assigning others before writing when permission is missing', async () => {
    mocks.hasPermission.mockResolvedValue(false);
    await expect(new InteractionService().create({ ...scheduleInput, schedule_assigned_user_ids: ['user-2'] }, context))
      .rejects.toMatchObject({ statusCode: 403, message: 'Permission denied to assign schedule entries to other users.' });
    expect(mocks.hasPermission).toHaveBeenCalledWith(context.user, 'user_schedule', 'update', context.db);
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it('books multiple users with permission in the interaction transaction', async () => {
    mocks.hasPermission.mockResolvedValue(true);
    await new InteractionService().create({ ...scheduleInput, schedule_assigned_user_ids: ['user-2', 'user-3', 'user-2'] }, context);
    expect(mocks.createInteractionScheduleEntry).toHaveBeenCalledWith(expect.objectContaining({
      trx: { trx: true }, assignedUserIds: ['user-2', 'user-3'], assignedByUserId: 'user-1',
    }));
  });

  it('leaves scheduling opt-in even when times and assignees are present', async () => {
    await new InteractionService().create({ ...scheduleInput, create_schedule_entry: false, schedule_assigned_user_ids: ['user-2'] }, context);
    expect(mocks.hasPermission).not.toHaveBeenCalled();
    expect(mocks.createInteractionScheduleEntry).not.toHaveBeenCalled();
  });

  it('rejects booking without a start time before any write', async () => {
    await expect(new InteractionService().create({ ...scheduleInput, start_time: undefined }, context))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it.each(['Users user-2 not found in tenant tenant-1', 'Database unavailable'])('fails the transaction and suppresses publishers on schedule failure: %s', async (message) => {
    const publish = vi.fn();
    mocks.createInteractionWithSideEffects.mockResolvedValue({ interaction: {}, publishSideEffects: publish });
    mocks.createInteractionScheduleEntry.mockRejectedValue(new Error(message));
    const promise = new InteractionService().create(scheduleInput, context);
    if (message.startsWith('Users ')) {
      await expect(promise).rejects.toMatchObject({ statusCode: 400, message: 'One or more assigned users could not be found.' });
    } else {
      await expect(promise).rejects.toThrow(message);
    }
    expect(publish).not.toHaveBeenCalled();
    await expect(mocks.withTransaction.mock.results[0].value).rejects.toThrow();
  });

  it('T011: delegates create to the session-free helper inside a transaction', async () => {
    const publishSideEffects = vi.fn().mockResolvedValue(undefined);
    const created = {
      interaction_id: 'interaction-1',
      opportunity_id: 'opportunity-1',
    };
    mocks.createInteractionWithSideEffects.mockResolvedValue({
      interaction: created,
      publishSideEffects,
    });

    const service = new InteractionService();
    const result = await service.create({
      type_id: '11111111-1111-4111-8111-111111111111',
      client_id: '22222222-2222-4222-8222-222222222222',
      opportunity_id: '33333333-3333-4333-8333-333333333333',
      title: 'Call',
      duration: 15,
      interaction_date: '2026-07-16T14:30:00.000Z',
    }, context);

    expect(mocks.withTransaction).toHaveBeenCalledWith(context.db, expect.any(Function));
    expect(mocks.createInteractionWithSideEffects).toHaveBeenCalledWith({
      tenant: 'tenant-1',
      trx: { trx: true },
      user: context.user,
      interactionData: expect.objectContaining({
        type_id: '11111111-1111-4111-8111-111111111111',
        client_id: '22222222-2222-4222-8222-222222222222',
        opportunity_id: '33333333-3333-4333-8333-333333333333',
        title: 'Call',
        duration: 15,
        user_id: 'user-1',
        interaction_date: new Date('2026-07-16T14:30:00.000Z'),
      }),
    });
    expect(publishSideEffects).toHaveBeenCalledOnce();
    expect(result).toBe(created);
  });

  it('T011: applies list filters and pagination to tenant-scoped queries', async () => {
    const dataQuery = queryResolving([{ interaction_id: 'interaction-1', type_name: 'Call' }]);
    const countQuery = queryResolving(undefined);
    countQuery.first.mockResolvedValue({ count: '1' });
    const table = vi.fn()
      .mockReturnValueOnce(dataQuery)
      .mockReturnValueOnce(countQuery);
    const tenantJoin = vi.fn((_query: unknown) => _query);
    mocks.tenantDb.mockReturnValue({ table, tenantJoin });

    const service = new InteractionService();
    const result = await service.list({
      client_id: 'client-1',
      contact_id: 'contact-1',
      opportunity_id: 'opportunity-1',
      ticket_id: 'ticket-1',
      project_id: 'project-1',
      user_id: 'user-1',
      type_id: 'type-1',
      date_from: '2026-07-01T00:00:00.000Z',
      date_to: '2026-07-31T23:59:59.999Z',
      page: 3,
      page_size: 20,
    }, context);

    expect(mocks.tenantDb).toHaveBeenCalledWith(context.db, 'tenant-1');
    expect(dataQuery.where.mock.calls).toEqual(expect.arrayContaining([
      ['i.client_id', 'client-1'],
      ['i.contact_name_id', 'contact-1'],
      ['i.opportunity_id', 'opportunity-1'],
      ['i.ticket_id', 'ticket-1'],
      ['i.project_id', 'project-1'],
      ['i.user_id', 'user-1'],
      ['i.type_id', 'type-1'],
      ['i.interaction_date', '>=', '2026-07-01T00:00:00.000Z'],
      ['i.interaction_date', '<=', '2026-07-31T23:59:59.999Z'],
    ]));
    expect(dataQuery.limit).toHaveBeenCalledWith(20);
    expect(dataQuery.offset).toHaveBeenCalledWith(40);
    expect(countQuery.where).toHaveBeenCalledWith('i.opportunity_id', 'opportunity-1');
    expect(result).toEqual({
      data: [{ interaction_id: 'interaction-1', type_name: 'call' }],
      total: 1,
    });
  });

  it('T014: returns the union of system and tenant interaction types', async () => {
    const table = vi.fn((name: string) => ({
      select: vi.fn().mockResolvedValue(name === 'system_interaction_types'
        ? [{ type_id: 'system-call', type_name: 'Call', icon: 'phone' }]
        : [{ type_id: 'tenant-demo', type_name: 'Demo', icon: null }]),
    }));
    mocks.tenantDb.mockReturnValue({ table, tenantJoin: vi.fn() });

    const service = new InteractionService();
    const types = await service.listTypes(context);

    expect(table).toHaveBeenCalledWith('system_interaction_types');
    expect(table).toHaveBeenCalledWith('interaction_types');
    expect(types).toEqual([
      { type_id: 'system-call', type_name: 'Call', icon: 'phone', is_system: true },
      { type_id: 'tenant-demo', type_name: 'Demo', icon: null, is_system: false },
    ]);
  });
});
