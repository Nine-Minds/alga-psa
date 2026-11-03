/** Explicit ticket fields that are part of the client portal contract. */
export interface ClientTicketProjection {
  ticket_id: string;
  ticket_number: string;
  title: string;
  url?: string | null;
  board_id?: string | null;
  client_id?: string | null;
  contact_name_id?: string | null;
  status_id?: string | null;
  category_id?: string | null;
  subcategory_id?: string | null;
  entered_at?: string | null;
  updated_at?: string | null;
  closed_at?: string | null;
  due_date?: string | null;
  response_state?: string | null;
  priority_id?: string | null;
  status_name?: string | null;
  priority_name?: string | null;
  priority_color?: string | null;
  board_name?: string | null;
  category_name?: string | null;
  assigned_to_name?: string | null;
  assigned_team_name?: string | null;
  additional_agent_count?: number;
  additional_agents?: Array<{ name: string; role: string }>;
  attributes?: { description?: unknown } | null;
  ticket_origin?: string;
  has_original_email?: boolean;
  can_interact?: boolean;
  [key: string]: unknown;
}

export function projectClientTicket(row: Record<string, any>, includeDescription = false): ClientTicketProjection {
  const projected: ClientTicketProjection = {
    ticket_id: row.ticket_id,
    ticket_number: row.ticket_number,
    title: row.title,
    url: row.url ?? null,
    board_id: row.board_id ?? null,
    client_id: row.client_id ?? null,
    contact_name_id: row.contact_name_id ?? null,
    status_id: row.status_id ?? null,
    category_id: row.category_id ?? null,
    subcategory_id: row.subcategory_id ?? null,
    entered_at: row.entered_at instanceof Date ? row.entered_at.toISOString() : row.entered_at ?? null,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at ?? null,
    closed_at: row.closed_at instanceof Date ? row.closed_at.toISOString() : row.closed_at ?? null,
    due_date: row.due_date ?? null,
    response_state: row.response_state ?? null,
    priority_id: row.priority_id ?? null,
    status_name: row.status_name ?? null,
    priority_name: row.priority_name ?? null,
    priority_color: row.priority_color ?? null,
    board_name: row.board_name ?? null,
    category_name: row.category_name ?? null,
    assigned_to_name: row.assigned_to_name ?? null,
    assigned_team_name: row.assigned_team_name ?? null,
    additional_agent_count: row.additional_agent_count ?? 0,
    additional_agents: (row.additional_agents ?? []).map((person: any) => ({ name: person.name, role: 'staff' })),
  };
  if (includeDescription) {
    projected.attributes = row.attributes && typeof row.attributes === 'object'
      ? { description: row.attributes.description }
      : null;
  }
  return projected;
}
