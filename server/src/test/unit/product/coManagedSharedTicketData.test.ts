import { expect, it } from 'vitest';
import { buildSharedTicketData } from '../../../lib/co-managed/sharedTicketData';

const resource = { tenant: 'customer-tenant', relationshipId: 'relationship', kind: 'ticket' as const, id: 'ticket' };
const ref = (kind: string, id: string, name: string) => ({ tenant: 'customer-tenant', kind, id, name });
const screen = (fields: Record<string, unknown> = {}) => ({
  summary: { resource, revision: 4, fields: { ticket_number: 'T-1', title: 'Printer', is_closed: false, work_revision: 2, responsibility: 'msp',
    board: ref('board', 'board-1', 'Help desk'), status: ref('status', 'status-1', 'Open'), priority: ref('priority', 'priority-1', 'High'), ...fields } },
  sla: {}, side: 'sponsor' as const, customerName: 'Customer IT', sponsorName: 'MSP', destinationName: 'Escalations',
  canWrite: true, canUpdate: true, canEscalate: false, canHandBack: true, canRevoke: false,
}) as any;
const editor = (over: Record<string, unknown> = {}) => ({ resource, editableFields: ['title', 'status_id', 'description'],
  values: { title: 'Printer', status_id: 'status-1', priority_id: 'priority-1', url: null, response_state: null, description: 'doc' },
  selectedOptions: { status_id: { id: 'status-1', name: 'Open' }, priority_id: { id: 'priority-1', name: 'High' } }, ...over }) as any;
const page = (...names: string[]) => ({ options: names.map(name => ({ id: `id-${name}`, name })), nextAfterId: null });
const full = { description: 'doc', requester: { name: 'Casey' }, client: { name: 'Acme' }, category: { id: 'cat', name: 'Hardware' },
  due_date: '2026-11-01T09:00:00.000Z', customer_assignee: { name: 'Ada' } };

it('assembles the native ticket data shape from disclosed fields only', () => {
  const result = buildSharedTicketData({ resource, screen: screen(), details: { resource, revision: 4, fields: full }, editor: editor(),
    statusOptions: { options: [{ id: 'status-1', name: 'Open' }, { id: 'status-2', name: 'Closed' }], nextAfterId: null }, priorityOptions: page('High') });
  expect(result.ticketData.ticket).toMatchObject({ ticket_id: 'ticket', tenant: 'customer-tenant', title: 'Printer', board_id: 'board-1', status_id: 'status-1',
    status_name: 'Open', priority_name: 'High', attributes: { description: 'doc' }, category_id: 'cat', client_name: 'Acme', contact_name: 'Casey',
    due_date: '2026-11-01T09:00:00.000Z' });
  expect(result.ticketData).toMatchObject({ comments: [], documents: [], contacts: [], additionalAgents: [], availableAgents: [], userMap: {}, contactMap: {},
    clients: [], locations: [], agentSchedules: [], client: { client_name: 'Acme' }, contactInfo: { full_name: 'Casey' },
    board: { board_id: 'board-1', board_name: 'Help desk' }, categories: [{ category_id: 'cat', category_name: 'Hardware', board_id: 'board-1' }] });
  expect(result.ticketData.options.board).toEqual([{ value: 'board-1', label: 'Help desk' }]);
  expect(result.ticketData.options.status.map(option => option.label)).toEqual(['Open', 'Closed']);
  // The customer's assignee is shown by name; its user identity never reaches the screen.
  expect(result.ticketData.ticket.assigned_to_name).toBe('Ada');
  expect(result.ticketData.ticket).not.toHaveProperty('assigned_to');
  expect(result.screen).toMatchObject({ side: 'sponsor', canWrite: true, canHandBack: true, work_revision: 2, responsibility: 'msp', customerName: 'Customer IT' });
  expect(result.editor).toEqual({ editableFields: ['title', 'status_id', 'description'], baselines: { title: 'Printer', status_id: 'status-1', description: 'doc' } });
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
});

it('never pads undisclosed fields and keeps the current choice selectable', () => {
  const sparse = { ...screen(), summary: { resource, revision: 4, fields: { ticket_number: 'T-1', status: ref('status', 'status-1', 'Open') } } };
  const result = buildSharedTicketData({ resource, screen: sparse,
    details: { resource, revision: 4, fields: {} }, editor: editor({ editableFields: [], values: { status_id: 'status-1' } }),
    statusOptions: page('Closed'), priorityOptions: page() });
  const { ticket, ...rest } = result.ticketData;
  for (const key of ['title', 'board_id', 'priority_id', 'attributes', 'category_id', 'client_name', 'contact_name', 'due_date', 'url']) expect(ticket).not.toHaveProperty(key);
  expect(rest).toMatchObject({ client: null, contactInfo: null, board: null, categories: [] });
  expect(rest.options.board).toEqual([]);
  expect(rest.options.status.map(option => option.value)).toEqual(['status-1', 'id-Closed']);
  expect(ticket).not.toHaveProperty('assigned_to_name');
  expect(result.editor.baselines).toEqual({});
});

it('distinguishes a disclosed empty value (null) from an undisclosed one (absent)', () => {
  const result = buildSharedTicketData({ resource, screen: screen(), editor: editor(),
    details: { resource, revision: 4, fields: { description: null, requester: null, client: null, category: null, due_date: null, customer_assignee: null } },
    statusOptions: page(), priorityOptions: page() });
  expect(result.ticketData.ticket).toMatchObject({ attributes: { description: null }, category_id: null, client_name: null, contact_name: null, due_date: null });
  expect(result.ticketData.ticket.assigned_to_name).toBeNull();
});

it('is read-only for a viewer whose update probe is denied even when the relationship can write', () => {
  const viewer = { ...screen(), canWrite: true, canUpdate: false };
  const result = buildSharedTicketData({ resource, screen: viewer, details: { resource, revision: 4, fields: full }, editor: editor({ editableFields: [] }),
    statusOptions: page('Closed'), priorityOptions: page() });
  expect(result.screen.canWrite).toBe(false);
});
