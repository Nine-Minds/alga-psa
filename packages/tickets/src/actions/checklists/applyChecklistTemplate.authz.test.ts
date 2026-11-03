import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { user_id: 'client-user', user_type: 'client', clientId: 'client-1' } as any,
  ticket: { ticket_id: 'ticket-1', client_id: 'client-1' },
  template: { template_id: 'template-1', name: 'Valid checklist', client_id: 'client-1' } as any,
  templateItems: [{ item_name: 'Valid item', description: null, is_required: true }],
  rows: [] as any[],
  activities: [] as any[],
  canAccess: false,
  events: [] as string[],
  coarsePermissionChecks: [] as Array<[string, string]>,
}));

const authorizeTicketRecordAccessConcealed = vi.fn(async (input: any) => {
  state.events.push('authorize');
  if (!state.canAccess) throw new Error('Permission denied: Cannot access ticket');
  return state.ticket;
});

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) => action(state.user, { tenant: 'tenant-1' }, ...args),
  hasPermission: vi.fn(async (_user: any, resource: string, action: string) => {
    state.coarsePermissionChecks.push([resource, action]);
    return true;
  }),
}));

vi.mock('../../lib/ticketRecordAuthorization', () => ({ authorizeTicketRecordAccessConcealed }));

vi.mock('@alga-psa/shared/lib/ticketActivity', () => ({
  TICKET_ACTIVITY_ACTOR: { USER: 'user' },
  TICKET_ACTIVITY_ENTITY: { CHECKLIST_ITEM: 'checklist_item' },
  TICKET_ACTIVITY_EVENT: { CHECKLIST_TEMPLATE_APPLIED: 'checklist_template_applied' },
  TICKET_ACTIVITY_SOURCE: { UI: 'ui', SYSTEM: 'system' },
  writeTicketActivity: vi.fn(async (_trx: any, activity: any) => {
    state.activities.push(activity);
  }),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: {} }),
  withTransaction: async (_db: any, work: any) => work({}),
  tenantDb: (_conn: any, _tenant: string) => ({
    table: (table: string) => {
      let predicate: Record<string, any> = {};
      const builder: any = {
        where: (where: Record<string, any>) => { predicate = where; return builder; },
        first: async () => {
          if (table === 'tickets') return state.ticket;
          if (table === 'checklist_templates') {
            state.events.push('template-read');
            return state.template;
          }
          if (table === 'ticket_checklist_items') {
            return state.rows.find((row) => row.ticket_id === predicate.ticket_id && row.template_id === predicate.template_id);
          }
          if (table === 'ticket_checklist_items:max') return { max: state.rows.length - 1 };
          return undefined;
        },
        max: () => ({
          first: async () => ({ max: state.rows.filter((row) => row.ticket_id === predicate.ticket_id).length - 1 }),
        }),
        orderBy: () => builder,
        then: (resolve: any, reject: any) => Promise.resolve(state.templateItems).then(resolve, reject),
        insert: async (rows: any[]) => { state.rows.push(...rows); },
      };
      return builder;
    },
  }),
}));

describe('applyChecklistTemplate record authorization', () => {
  beforeEach(() => {
    state.user = { user_id: 'client-user', user_type: 'client', clientId: 'client-1' };
    state.ticket = { ticket_id: 'ticket-1', client_id: 'client-1' };
    state.template = { template_id: 'template-1', name: 'Valid checklist', client_id: 'client-1' };
    state.templateItems = [{ item_name: 'Valid item', description: null, is_required: true }];
    state.rows = [{ ticket_id: 'other-ticket', item_name: 'Existing row' }];
    state.activities = [{ ticket_id: 'other-ticket', eventType: 'existing activity' }];
    state.canAccess = false;
    state.events = [];
    state.coarsePermissionChecks = [];
    authorizeTicketRecordAccessConcealed.mockClear();
  });

  it('denies a client with coarse ticket:update but no ticket access without changing checklist rows or activity', async () => {
    const initialRows = structuredClone(state.rows);
    const initialActivities = structuredClone(state.activities);
    const { applyChecklistTemplate } = await import('./applyChecklistTemplate');

    const result = await applyChecklistTemplate('ticket-1', 'template-1');

    expect(result).toMatchObject({ permissionError: 'Permission denied: Cannot access ticket' });
    expect(state.coarsePermissionChecks).toEqual([['ticket', 'update']]);
    expect(authorizeTicketRecordAccessConcealed).toHaveBeenCalledWith(expect.objectContaining({
      ticketId: 'ticket-1', action: 'update', tenant: 'tenant-1', trx: expect.anything(),
    }));
    expect(state.events).toEqual(['authorize']);
    expect(state.rows).toEqual(initialRows);
    expect(state.activities).toEqual(initialActivities);
  });

  it('applies a valid template after authorized ticket access', async () => {
    state.canAccess = true;
    const { applyChecklistTemplate } = await import('./applyChecklistTemplate');

    const result = await applyChecklistTemplate('ticket-1', 'template-1');

    expect(result).toEqual({ applied: true, itemsAdded: 1 });
    expect(state.rows).toHaveLength(2);
    expect(state.rows[1]).toMatchObject({ ticket_id: 'ticket-1', template_id: 'template-1', item_name: 'Valid item' });
    expect(state.activities).toHaveLength(2);
    expect(state.activities[1]).toMatchObject({ ticketId: 'ticket-1', entityId: 'template-1' });
    expect(state.events).toEqual(['authorize', 'template-read']);
  });

  it('preserves the distinct template/client mismatch outcome', async () => {
    state.canAccess = true;
    state.template = { ...state.template, client_id: 'another-client' };
    const initialRows = structuredClone(state.rows);
    const initialActivities = structuredClone(state.activities);
    const { applyChecklistTemplate } = await import('./applyChecklistTemplate');

    const result = await applyChecklistTemplate('ticket-1', 'template-1');

    expect(result).toMatchObject({ actionError: 'template-client-mismatch' });
    expect(state.rows).toEqual(initialRows);
    expect(state.activities).toEqual(initialActivities);
  });
});
