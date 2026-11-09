import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  user: { user_id: 'user-1', user_type: 'client', clientId: 'client-a', tenant: 'tenant-1' } as any,
  permissions: { ticketRead: true, settingsRead: false, settingsUpdate: false },
  ticketAllowed: true,
  ticket: { ticket_id: 'ticket-a', client_id: 'client-a' } as any,
  templates: [
    { template_id: 'global', name: 'Global', description: null, client_id: null, is_active: true },
    { template_id: 'own', name: 'Own', description: null, client_id: 'client-a', is_active: true },
    { template_id: 'other', name: 'Other', description: null, client_id: 'client-b', is_active: true },
    { template_id: 'inactive', name: 'Inactive', description: null, client_id: 'client-a', is_active: false },
  ],
  events: [] as string[],
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) => action(state.user, { tenant: 'tenant-1' }, ...args),
  hasPermission: async (_user: any, resource: string, action: string) => {
    if (resource === 'ticket') return action === 'read' && state.permissions.ticketRead;
    return action === 'read' ? state.permissions.settingsRead : state.permissions.settingsUpdate;
  },
}));

vi.mock('@alga-psa/types', () => ({
  isClientUserType: (type: string) => type === 'client',
  isMspPrincipalUserType: (type: string) => type === 'internal',
}));

vi.mock('../../lib/ticketRecordAuthorization', () => ({
  authorizeTicketRecordAccessConcealed: vi.fn(async (input: any) => {
    state.events.push(`authorize:${input.ticketId}:${input.action}`);
    if (!state.ticketAllowed) throw new Error('Permission denied: Cannot access ticket');
    return state.ticket;
  }),
}));

vi.mock('@alga-psa/db', () => {
  const source = (table: string) => {
    const rows = table === 'checklist_templates' ? state.templates
      : table === 'checklist_template_items' ? []
        : table === 'clients' ? state.templates.filter((row) => row.client_id).map((row) => ({ client_id: row.client_id, client_name: `Name ${row.client_id}` }))
          : [];
    const build = (inputRows: any[]) => {
      let conditions: Array<(row: any) => boolean> = [];
      const builder: any = {
        where: (column: any, value?: any) => {
          if (typeof column === 'function') {
            const group: Array<(row: any) => boolean> = [];
            const nested: any = {
              whereNull: (field: string) => { group.push((row: any) => row[field] == null); return nested; },
              orWhere: (field: string, expected: any) => { group.push((row: any) => row[field] === expected); return nested; },
            };
            column(nested);
            conditions.push((row) => group.some((test) => test(row)));
          } else if (typeof column === 'object') {
            conditions.push((row) => Object.entries(column).every(([key, expected]) => row[key] === expected));
          } else {
            conditions.push((row) => row[column] === value);
          }
          return builder;
        },
        whereNull: (column: string) => { conditions.push((row) => row[column] == null); return builder; },
        whereIn: (column: string, values: any[]) => { conditions.push((row) => values.includes(row[column])); return builder; },
        modify: (fn: (query: any) => void) => { fn(builder); return builder; },
        orderBy: () => builder,
        select: () => builder,
        first: async () => { state.events.push(`query:${table}`); return result()[0]; },
        then: (resolve: (value: any[]) => unknown, reject: (error: unknown) => unknown) => {
          state.events.push(`query:${table}`);
          return Promise.resolve(result()).then(resolve, reject);
        },
      };
      const result = () => inputRows.filter((row) => conditions.every((test) => test(row)));
      return builder;
    };
    return build(rows as any[]);
  };
  return {
    createTenantKnex: async () => ({ knex: {} }),
    withTransaction: async (_db: any, work: (trx: any) => Promise<any>) => work({}),
    tenantDb: (_conn: any, _tenant: string) => ({ table: source }),
  };
});

describe('getChecklistTemplates authorization', () => {
  beforeEach(() => {
    state.user = { user_id: 'user-1', user_type: 'client', clientId: 'client-a', tenant: 'tenant-1' };
    state.permissions = { ticketRead: true, settingsRead: false, settingsUpdate: false };
    state.ticketAllowed = true;
    state.ticket = { ticket_id: 'ticket-a', client_id: 'client-a' };
    state.events = [];
  });

  it('requires MSP settings read access before loading the settings list', async () => {
    state.user = { ...state.user, user_type: 'internal' };
    const { getChecklistTemplates } = await import('./checklistTemplateActions');

    await expect(getChecklistTemplates()).rejects.toThrow('Permission denied');
    expect(state.events).toEqual([]);
  });

  it('lists settings templates for an authorized MSP principal', async () => {
    state.user = { ...state.user, user_type: 'internal' };
    state.permissions.settingsRead = true;
    state.permissions.settingsUpdate = true;
    const { getChecklistTemplates } = await import('./checklistTemplateActions');

    expect((await getChecklistTemplates()).map((template) => template.template_id)).toEqual(['global', 'own', 'other']);
  });

  it('requires ticket:read before authorizing or querying ticket picker templates', async () => {
    state.permissions.ticketRead = false;
    state.ticketAllowed = false;
    const { getChecklistTemplatesForTicket } = await import('./checklistTemplateActions');

    await expect(getChecklistTemplatesForTicket('ticket-hidden')).rejects.toThrow('Permission denied');
    expect(state.events).toEqual([]);
  });

  it('authorizes the ticket before resolving clients or selecting templates', async () => {
    state.ticketAllowed = false;
    const { getChecklistTemplatesForTicket } = await import('./checklistTemplateActions');

    await expect(getChecklistTemplatesForTicket('ticket-hidden')).rejects.toThrow('Permission denied');
    expect(state.events).toEqual(['authorize:ticket-hidden:read']);
  });

  it('returns only templates in the authorized ticket and client visibility scopes', async () => {
    const { getChecklistTemplatesForTicket } = await import('./checklistTemplateActions');

    const templates = await getChecklistTemplatesForTicket('ticket-a');
    expect(templates.map((template) => template.template_id)).toEqual(['global', 'own']);
    expect(state.events[0]).toBe('authorize:ticket-a:read');
  });

  it('keeps internal ticket pickers scoped to the ticket client', async () => {
    state.user = { ...state.user, user_type: 'internal' };
    state.ticket = { ticket_id: 'ticket-a', client_id: 'client-b' };
    const { getChecklistTemplatesForTicket } = await import('./checklistTemplateActions');

    const result = await getChecklistTemplatesForTicket('ticket-a');
    expect(result.map((template) => template.template_id)).toEqual(['global', 'other']);
    expect(state.events[0]).toBe('authorize:ticket-a:read');
  });
});
