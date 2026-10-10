import type { IComment, ITicket, ITimeEntry } from '@alga-psa/types';

/**
 * Realistic domain fixtures for the emitter contract cases. Builders are fed values read off
 * these typed domain objects (never a hand-written payload literal), so a builder input type that
 * stops matching the domain model fails `typecheck` here.
 *
 * Identifiers are UUIDs, like production rows.
 */

export const IDS = {
  tenant: 'a1b2c3d4-0000-4000-8000-000000000001',
  ticket: '11111111-1111-4111-8111-111111111111',
  otherTicket: '11111111-1111-4111-8111-222222222222',
  childTicket: '11111111-1111-4111-8111-333333333333',
  childTicket2: '11111111-1111-4111-8111-444444444444',
  user: '22222222-2222-4222-8222-222222222222',
  assignee: '22222222-2222-4222-8222-333333333333',
  previousAssignee: '22222222-2222-4222-8222-444444444444',
  contact: '66666666-6666-4666-8666-666666666666',
  comment: '33333333-3333-4333-8333-333333333333',
  statusOpen: '77777777-7777-4777-8777-000000000001',
  statusInProgress: '77777777-7777-4777-8777-000000000002',
  statusClosed: '77777777-7777-4777-8777-000000000003',
  board: '88888888-8888-4888-8888-000000000001',
  otherBoard: '88888888-8888-4888-8888-000000000002',
  priority: '99999999-9999-4999-8999-000000000001',
  otherPriority: '99999999-9999-4999-8999-000000000002',
  client: 'cccccccc-cccc-4ccc-8ccc-000000000001',
  team: 'dddddddd-dddd-4ddd-8ddd-000000000001',
  timeEntry: 'eeeeeeee-eeee-4eee-8eee-000000000001',
} as const;

export const NOW = '2026-07-16T12:00:00.000Z';
export const EARLIER = '2026-07-16T09:00:00.000Z';

export const ticket: ITicket = {
  tenant: IDS.tenant,
  ticket_id: IDS.ticket,
  ticket_number: 'TIC-000123',
  title: 'Printer offline on the second floor',
  url: null,
  board_id: IDS.board,
  client_id: IDS.client,
  contact_name_id: IDS.contact,
  status_id: IDS.statusOpen,
  category_id: null,
  subcategory_id: null,
  entered_by: IDS.user,
  updated_by: null,
  closed_by: null,
  assigned_to: IDS.assignee,
  entered_at: EARLIER,
  updated_at: null,
  closed_at: null,
  attributes: null,
  priority_id: IDS.priority,
  itil_priority_level: 3,
  response_state: null,
};

export const closedTicket: ITicket = {
  ...ticket,
  status_id: IDS.statusClosed,
  closed_by: IDS.user,
  closed_at: NOW,
  is_closed: true,
};

export const publicAgentComment: IComment = {
  tenant: IDS.tenant,
  comment_id: IDS.comment,
  ticket_id: IDS.ticket,
  user_id: IDS.user,
  author_type: 'internal',
  note: 'We are looking into it.',
  is_internal: false,
  created_at: NOW,
};

export const internalNote: IComment = { ...publicAgentComment, is_internal: true, note: 'Checked the print server.' };

export const contactReply: IComment = {
  ...publicAgentComment,
  user_id: null,
  contact_id: IDS.contact,
  author_type: 'contact',
  note: 'Still not printing.',
};

export const ticketTimeEntry: ITimeEntry = {
  tenant: IDS.tenant,
  entry_id: IDS.timeEntry,
  work_item_id: IDS.ticket,
  work_item_type: 'ticket',
  start_time: '2026-07-16T10:00:00.000Z',
  end_time: '2026-07-16T10:45:00.000Z',
  created_at: NOW,
  updated_at: NOW,
  billable_duration: 45,
  notes: 'Replaced toner',
  user_id: IDS.user,
  approval_status: 'DRAFT',
};
