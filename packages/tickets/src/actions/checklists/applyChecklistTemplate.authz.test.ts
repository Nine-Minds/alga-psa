import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { user_id: 'client-user', user_type: 'client', clientId: 'client-1', contact_id: 'contact-1', roles: [{ role_id: 'client-role' }] } as any,
  tickets: {} as Record<string, any>,
  ticketsInOtherTenants: {} as Record<string, any>,
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
            state.events.push('ticket-read');
            return tenant === 'tenant-1' ? state.tickets[predicate.ticket_id] : undefined;
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
    state.tickets = {
      'ticket-1': {
        ticket_id: 'ticket-1', client_id: 'client-1', board_id: 'board-1', contact_name_id: 'contact-1',
        billing_profile_id: null, attributes: {}, assigned_to: null, entered_by: null, assigned_team_id: null,
      },
    };
    state.ticketsInOtherTenants = {
      'cross-tenant-ticket': { ticket_id: 'cross-tenant-ticket', client_id: 'client-1', tenant: 'tenant-2' },
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
    state.tickets['ticket-1'] = { ...state.tickets['ticket-1'], board_id: 'hidden-board' };
    const initialRows = structuredClone(state.rows);
    const initialActivities = structuredClone(state.activities);
    const { applyChecklistTemplate } = await import('./applyChecklistTemplate');

    const result = await applyChecklistTemplate('ticket-1', 'template-1');

    expect(result).toMatchObject({ permissionError: 'Permission denied: Cannot access ticket' });
    expect(state.coarsePermissionChecks).toEqual([['ticket', 'update']]);
    expect(state.events).toEqual(['ticket-read']);
    expect(state.rows).toEqual(initialRows);
    expect(state.activities).toEqual(initialActivities);
  });

  it('conceals hidden, nonexistent, and cross-tenant ticket references identically before template reads', async () => {
    state.tickets['hidden-ticket'] = {
      ...state.tickets['ticket-1'], ticket_id: 'hidden-ticket', board_id: 'hidden-board',
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
    expect(hiddenEvents).toEqual(['ticket-read']);
    expect(nonexistentEvents).toEqual(['ticket-read']);
    expect(state.events).toEqual(['ticket-read']);
    expect(state.ticketsInOtherTenants['cross-tenant-ticket'].tenant).toBe('tenant-2');
    expect(state.rows).toEqual(initialRows);
    expect(state.activities).toEqual(initialActivities);
  });

  it('applies a valid template after authorized ticket access', async () => {
    const { applyChecklistTemplate } = await import('./applyChecklistTemplate');

    const result = await applyChecklistTemplate('ticket-1', 'template-1');

    expect(result).toEqual({ applied: true, itemsAdded: 1 });
    expect(state.rows).toHaveLength(2);
    expect(state.rows[1]).toMatchObject({ ticket_id: 'ticket-1', template_id: 'template-1', item_name: 'Valid item' });
    expect(state.activities).toHaveLength(2);
    expect(state.activities[1]).toMatchObject({ ticketId: 'ticket-1', entityId: 'template-1' });
    expect(state.events).toEqual(['ticket-read', 'template-read']);
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
