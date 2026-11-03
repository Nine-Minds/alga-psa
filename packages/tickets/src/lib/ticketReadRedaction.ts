/** Canonical ticket read fields and the aliases used by ticket policy rules. */
const FIELD_ALIASES: Record<string, string[]> = {
  title: ['title', 'tickets.title'],
  description: ['description', 'tickets.description', 'attributes.description'],
  client_name: ['client_name', 'client', 'clients.client_name'],
  contact_name: ['contact_name', 'contacts.full_name'],
  assigned_to_name: ['assigned_to_name', 'assigned_to', 'users.first_name', 'users.last_name'],
  assigned_team_name: ['assigned_team_name', 'assigned_team_id', 'teams.team_name'],
  entered_at: ['entered_at', 'tickets.entered_at'],
  updated_at: ['updated_at', 'tickets.updated_at'],
  closed_at: ['closed_at', 'tickets.closed_at'],
  due_date: ['due_date', 'tickets.due_date'],
  status_name: ['status', 'status_name', 'statuses.name'],
  priority_name: ['priority', 'priority_name', 'priorities.priority_name'],
  board_name: ['board', 'board_name', 'boards.board_name'],
};

export function ticketReadFieldHidden(redactedFields: readonly string[], field: string): boolean {
  const aliases = FIELD_ALIASES[field] ?? [field, `tickets.${field}`];
  const normalized = new Set(redactedFields.map((value) => value.toLowerCase()));
  return normalized.has('*') || normalized.has('fields') || aliases.some((alias) => normalized.has(alias));
}

/** Conservative payload projection: any redaction drops comments and derived activity text. */
export function redactTicketReadPayload<T extends Record<string, any>>(value: T, redactedFields: readonly string[]): T {
  if (redactedFields.length === 0) return value;
  const result: Record<string, any> = { ...value };
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (ticketReadFieldHidden(redactedFields, field)) {
      if (field === 'title') result.title = 'Restricted ticket';
      else if (field === 'description') {
        if (result.attributes && typeof result.attributes === 'object') result.attributes = { ...result.attributes, description: null };
        result.description = null;
      } else {
        result[field] = null;
      }
      for (const alias of aliases) if (alias in result && alias !== field) result[alias] = null;
      if (field === 'client_name') {
        result.client_id = null;
        result.client_logo_url = null;
      }
      if (field === 'contact_name') {
        result.contact_name_id = null;
        result.contact_avatar_url = null;
      }
      if (field === 'assigned_to_name') {
        result.assigned_to = null;
        result.additional_agents = [];
        result.additional_agent_count = 0;
      }
      if (field === 'assigned_team_name') result.assigned_team_id = null;
      if (field === 'status_name') {
        result.status_id = null;
        result.is_closed = null;
      }
      if (field === 'priority_name') result.priority_id = null;
      if (field === 'board_name') result.board_id = null;
    }
  }
  if (redactedFields.length > 0) {
    result.comments = [];
    result.latest_activity_actor = null;
    result.latest_activity_at = null;
    result.__ticket_read_has_redactions = true;
  }
  return result as T;
}
