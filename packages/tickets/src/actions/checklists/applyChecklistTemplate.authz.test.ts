import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { user_id: 'client-user', user_type: 'client', clientId: 'client-1', contact_id: 'contact-1', roles: [{ role_id: 'client-role' }] } as any,
  ticketsByTenant: {} as Record<string, Record<string, any>>,
  template: { template_id: 'template-1', name: 'Valid checklist', client_id: 'client-1' } as any,
  templateItems: [{ item_name: 'Valid item', description: null, is_required: true }],
  rows: [] as any[],
  activities: [] as any[],
  events: [] as string[],
  coarsePermissionChecks: [] as Array<[string, string]>,
  coarsePermissionAllowed: true,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) => action(state.user, { tenant: 'tenant-1' }, ...args),
  hasPermission: vi.fn(async (_user: any, resource: string, action: string) => {
    state.coarsePermissionChecks.push([resource, action]);
    return state.coarsePermissionAllowed;
  }),
}));

vi.mock('../../lib/clientPortalVisibility.server', () => ({
  getClientContactVisibilityContext: async () => ({
    effectiveTicketScope: 'client',
    ticketScope: 'client',
    contactId: 'contact-1',
    clientId: 'client-1',
    visibleBoardIds: ['board-1'],
    isClientAdmin: false,
    visibilityGroupId: null,
  }),
}));

vi.mock('@alga-psa/authorization/bundles/service', () => ({
  resolveBundleNarrowingRulesForEvaluation: async () => [],
}));

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
  tenantDb: (_conn: any, tenant: string) => ({
    table: (table: string) => {
      let predicate: Record<string, any> = {};
      const builder: any = {
        where: (where: Record<string, any>) => { predicate = where; return builder; },
        first: async () => {
          if (table === 'tickets') {
            state.events.push(`ticket-read:${tenant}`);
            return state.ticketsByTenant[tenant]?.[predicate.ticket_id];
          }
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
        select: () => builder,
        orderBy: () => builder,
        then: (resolve: any, reject: any) => Promise.resolve(
          table === 'checklist_template_items' ? state.templateItems : []
        ).then(resolve, reject),
        insert: async (rows: any[]) => { state.rows.push(...rows); },
      };
      return builder;
    },
  }),
}));

describe('applyChecklistTemplate record authorization', () => {
  beforeEach(() => {
    state.user = { user_id: 'client-user', user_type: 'client', clientId: 'client-1', contact_id: 'contact-1', roles: [{ role_id: 'client-role' }] };
    state.ticketsByTenant = {
      'tenant-1': {
        'ticket-1': {
          ticket_id: 'ticket-1', client_id: 'client-1', board_id: 'board-1', contact_name_id: 'contact-1',
          billing_profile_id: null, attributes: {}, assigned_to: null, entered_by: null, assigned_team_id: null,
        },
      },
      'tenant-2': {
        'cross-tenant-ticket': {
          ticket_id: 'cross-tenant-ticket', tenant: 'tenant-2', client_id: 'client-1', board_id: 'board-1',
          contact_name_id: 'contact-1', billing_profile_id: null, attributes: {}, assigned_to: null,
          entered_by: null, assigned_team_id: null,
        },
      },
    };
    state.template = { template_id: 'template-1', name: 'Valid checklist', client_id: 'client-1' };
    state.templateItems = [{ item_name: 'Valid item', description: null, is_required: true }];
    state.rows = [{ ticket_id: 'other-ticket', item_name: 'Existing row' }];
    state.activities = [{ ticket_id: 'other-ticket', eventType: 'existing activity' }];
    state.events = [];
    state.coarsePermissionChecks = [];
    state.coarsePermissionAllowed = true;
  });

  it('requires coarse ticket:update permission before record authorization', async () => {
    state.coarsePermissionAllowed = false;
    const { applyChecklistTemplate } = await import('./applyChecklistTemplate');

    const result = await applyChecklistTemplate('ticket-1', 'template-1');

    expect(result).toMatchObject({ permissionError: 'Permission denied: Cannot update ticket checklist' });
    expect(state.coarsePermissionChecks).toEqual([['ticket', 'update']]);
    expect(state.events).toEqual([]);
  });

  it('denies a client with coarse ticket:update when record access fails without changing data', async () => {
    state.ticketsByTenant['tenant-1']['ticket-1'] = {
      ...state.ticketsByTenant['tenant-1']['ticket-1'], board_id: 'hidden-board',
    };
    const initialRows = structuredClone(state.rows);
    const initialActivities = structuredClone(state.activities);
    const { applyChecklistTemplate } = await import('./applyChecklistTemplate');

    const result = await applyChecklistTemplate('ticket-1', 'template-1');

    expect(result).toMatchObject({ permissionError: 'Permission denied: Cannot access ticket' });
    expect(state.coarsePermissionChecks).toEqual([['ticket', 'update']]);
    expect(state.events).toEqual(['ticket-read:tenant-1']);
    expect(state.rows).toEqual(initialRows);
    expect(state.activities).toEqual(initialActivities);
  });

  it('conceals hidden, nonexistent, and cross-tenant ticket references identically before template reads', async () => {
    state.ticketsByTenant['tenant-1']['hidden-ticket'] = {
      ...state.ticketsByTenant['tenant-1']['ticket-1'], ticket_id: 'hidden-ticket', board_id: 'hidden-board',
    };
    const { applyChecklistTemplate } = await import('./applyChecklistTemplate');
    const initialRows = structuredClone(state.rows);
    const initialActivities = structuredClone(state.activities);

    const hidden = await applyChecklistTemplate('hidden-ticket', 'template-1');
    const hiddenEvents = [...state.events];
    state.events = [];
    const nonexistent = await applyChecklistTemplate('nonexistent-ticket', 'template-1');
    const nonexistentEvents = [...state.events];
    state.events = [];
    const crossTenant = await applyChecklistTemplate('cross-tenant-ticket', 'template-1');

    expect(hidden).toEqual({ permissionError: 'Permission denied: Cannot access ticket' });
    expect(nonexistent).toEqual(hidden);
    expect(crossTenant).toEqual(hidden);
    expect(hiddenEvents).toEqual(['ticket-read:tenant-1']);
    expect(nonexistentEvents).toEqual(['ticket-read:tenant-1']);
    expect(state.events).toEqual(['ticket-read:tenant-1']);
    expect(state.rows).toEqual(initialRows);
    expect(state.activities).toEqual(initialActivities);
  });

  it('resolves the otherwise-visible cross-tenant ticket when the real authorizer uses its owning tenant', async () => {
    const { authorizeTicketRecordAccessConcealed } = await import('../../lib/ticketRecordAuthorization');

    const ticket = await authorizeTicketRecordAccessConcealed({
      trx: {} as any,
      tenant: 'tenant-2',
      user: state.user,
      ticketId: 'cross-tenant-ticket',
      action: 'update',
    });

    expect(ticket).toMatchObject({
      ticket_id: 'cross-tenant-ticket', tenant: 'tenant-2', client_id: 'client-1',
      board_id: 'board-1', contact_name_id: 'contact-1',
    });
    expect(state.events).toEqual(['ticket-read:tenant-2']);
  });

  it('applies a valid template after authorized ticket access', async () => {
    const { applyChecklistTemplate } = await import('./applyChecklistTemplate');

    const result = await applyChecklistTemplate('ticket-1', 'template-1');

    expect(result).toEqual({ applied: true, itemsAdded: 1 });
    expect(state.rows).toHaveLength(2);
    expect(state.rows[1]).toMatchObject({ ticket_id: 'ticket-1', template_id: 'template-1', item_name: 'Valid item' });
    expect(state.activities).toHaveLength(2);
    expect(state.activities[1]).toMatchObject({ ticketId: 'ticket-1', entityId: 'template-1' });
    expect(state.events).toEqual(['ticket-read:tenant-1', 'template-read']);
  });

  it('preserves the distinct template/client mismatch outcome', async () => {
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
