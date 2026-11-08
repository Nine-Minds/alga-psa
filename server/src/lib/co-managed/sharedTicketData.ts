import type { CoManagedSharedResource, CoManagedSharedTicketDetails, CoManagedTicketEditorState, CoManagedTicketEditPatch,
  CoManagedDisplayReference } from '@alga-psa/co-managed';
import type { CoManagedTicketScreen } from './sharedTicketDataTypes';

export type { CoManagedTicketScreen, SharedTicketData, SharedTicketDetailsResult, SharedTicketOptionPage } from './sharedTicketDataTypes';
import type { SharedTicketData, SharedTicketDetailsResult, SharedTicketOptionPage } from './sharedTicketDataTypes';

const ref = (value: unknown): CoManagedDisplayReference | undefined =>
  value && typeof value === 'object' && 'id' in value ? value as CoManagedDisplayReference : undefined;

/** Pure assembly of the `TicketDetailsContainer` data shape from already admitted,
 * already redacted co-managed reads. A key is written only when its source was
 * disclosed; nothing is padded with a placeholder identity, and people are carried
 * by display name only. */
export function buildSharedTicketData(input: {
  resource: CoManagedSharedResource;
  screen: CoManagedTicketScreen;
  details: CoManagedSharedTicketDetails;
  editor: CoManagedTicketEditorState;
  statusOptions: SharedTicketOptionPage;
  priorityOptions: SharedTicketOptionPage;
}): SharedTicketDetailsResult {
  const { resource, screen, details, editor } = input;
  const fields = screen.summary.fields, disclosed = details.fields;
  const board = ref(fields.board), status = ref(fields.status), priority = ref(fields.priority);
  const ticket: SharedTicketData['ticket'] = { ticket_id: resource.id, tenant: resource.tenant };
  for (const key of ['ticket_number', 'title', 'is_closed', 'entered_at', 'updated_at', 'closed_at'] as const) {
    if (key in fields) (ticket as Record<string, unknown>)[key] = fields[key];
  }
  if (board) ticket.board_id = board.id;
  if (status) { ticket.status_id = status.id; ticket.status_name = status.name; }
  if (priority) { ticket.priority_id = priority.id; ticket.priority_name = priority.name; }
  const values = editor.values;
  if ('url' in values) ticket.url = values.url;
  if ('response_state' in values) ticket.response_state = values.response_state;
  if ('due_date' in disclosed) ticket.due_date = disclosed.due_date ?? null;
  if ('description' in disclosed) ticket.attributes = { description: disclosed.description ?? null };
  if (disclosed.category !== undefined) ticket.category_id = disclosed.category?.id ?? null;
  if (disclosed.client !== undefined) ticket.client_name = disclosed.client?.name ?? null;
  if (disclosed.requester !== undefined) ticket.contact_name = disclosed.requester?.name ?? null;
  // The customer's own assignee is disclosed by name only; the native screen shows that
  // name read-only and never receives the customer's user identity.
  if (disclosed.customer_assignee !== undefined) ticket.assigned_to_name = disclosed.customer_assignee?.name ?? null;

  const withCurrent = <T extends object>(page: SharedTicketOptionPage, current: { id: string; name: string } | undefined, extra: T) => {
    const options = page.options.map(option => ({ value: option.id, label: option.name, ...extra }));
    return current && !options.some(option => option.value === current.id) ? [{ value: current.id, label: current.name, ...extra }, ...options] : options;
  };
  const boardId = board?.id ?? null;
  const ticketData: SharedTicketData = {
    ticket,
    comments: [],
    documents: [],
    client: disclosed.client?.name != null ? { client_name: disclosed.client.name } : null,
    contacts: [],
    contactInfo: disclosed.requester?.name != null ? { full_name: disclosed.requester.name } : null,
    board: board ? { board_id: board.id, board_name: board.name } : null,
    additionalAgents: [],
    availableAgents: [],
    userMap: {},
    contactMap: {},
    options: {
      status: withCurrent(input.statusOptions, editor.selectedOptions.status_id, { board_id: boardId }),
      priority: withCurrent(input.priorityOptions, editor.selectedOptions.priority_id, {}),
      board: board ? [{ value: board.id, label: board.name ?? '' }] : [],
      agent: [],
    },
    categories: disclosed.category ? [{ category_id: disclosed.category.id, category_name: disclosed.category.name, board_id: boardId }] : [],
    clients: [],
    locations: [],
    agentSchedules: [],
  };
  const baselines: CoManagedTicketEditPatch = {};
  for (const field of editor.editableFields) (baselines as Record<string, unknown>)[field] = values[field] ?? null;
  return {
    resource,
    ticketData,
    screen: {
      side: screen.side, // Per-user authority: a view/oversight assignment can read but its update probe is denied.
      canWrite: screen.canWrite && screen.canUpdate, canEscalate: screen.canEscalate, canHandBack: screen.canHandBack, canRevoke: screen.canRevoke,
      customerName: screen.customerName, sponsorName: screen.sponsorName, destinationName: screen.destinationName,
      revision: screen.summary.revision, // LEVERAGE: friction shared-ticket-sla — SLA display returns with L6b
     
      ...(typeof fields.work_revision === 'number' ? { work_revision: fields.work_revision } : {}),
      ...(typeof fields.responsibility === 'string' ? { responsibility: fields.responsibility as 'customer' | 'msp' } : {}),
    },
    editor: { editableFields: editor.editableFields, baselines },
  };
}
