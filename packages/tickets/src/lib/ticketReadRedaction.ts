/** Canonical ticket fields exposed by list and smart-search readers. */
const FIELD_ALIASES: Record<string, readonly string[]> = {
  ticket_id: ['ticket_id', 'tickets.ticket_id', 'id'],
  ticket_number: ['ticket_number', 'tickets.ticket_number', 'number'],
  title: ['title', 'tickets.title'],
  url: ['url', 'tickets.url'],
  description: ['description', 'tickets.description', 'attributes.description'],
  attributes: ['attributes', 'tickets.attributes'],
  entered_by: ['entered_by', 'tickets.entered_by'],
  updated_by: ['updated_by', 'tickets.updated_by'],
  closed_by: ['closed_by', 'tickets.closed_by'],
  client_id: ['client_id', 'tickets.client_id'],
  client_name: ['client_name', 'client', 'clients.client_name'],
  contact_name_id: ['contact_name_id', 'tickets.contact_name_id'],
  contact_name: ['contact_name', 'contacts.full_name'],
  board_id: ['board_id', 'tickets.board_id'],
  board_name: ['board', 'board_name', 'boards.board_name'],
  status_id: ['status_id', 'tickets.status_id'],
  status_name: ['status', 'status_name', 'statuses.name'],
  is_closed: ['is_closed', 'tickets.is_closed'],
  category_id: ['category_id', 'tickets.category_id'],
  category_name: ['category_name', 'categories.category_name'],
  subcategory_id: ['subcategory_id', 'tickets.subcategory_id'],
  priority_id: ['priority_id', 'tickets.priority_id'],
  priority_name: ['priority', 'priority_name', 'priorities.priority_name'],
  priority_color: ['priority_color', 'priorities.color'],
  assigned_to: ['assigned_to', 'tickets.assigned_to', 'assignee'],
  assigned_to_name: ['assigned_to_name', 'users.first_name', 'users.last_name'],
  assigned_team_id: ['assigned_team_id', 'tickets.assigned_team_id'],
  assigned_team_name: ['assigned_team_name', 'teams.team_name'],
  entered_by_name: ['entered_by_name'],
  entered_at: ['entered_at', 'tickets.entered_at'],
  updated_at: ['updated_at', 'tickets.updated_at'],
  closed_at: ['closed_at', 'tickets.closed_at'],
  due_date: ['due_date', 'tickets.due_date'],
  location_id: ['location_id', 'tickets.location_id'],
  billing_profile_id: ['billing_profile_id', 'tickets.billing_profile_id'],
  master_ticket_id: ['master_ticket_id', 'tickets.master_ticket_id'],
  itil_impact: ['itil_impact', 'tickets.itil_impact'],
  itil_urgency: ['itil_urgency', 'tickets.itil_urgency'],
  itil_priority_level: ['itil_priority_level', 'tickets.itil_priority_level'],
  response_state: ['response_state', 'tickets.response_state'],
  ticket_origin: ['ticket_origin', 'tickets.ticket_origin'],
  sla_policy_id: ['sla_policy_id', 'tickets.sla_policy_id'],
  sla_started_at: ['sla_started_at', 'tickets.sla_started_at'],
  sla_response_due_at: ['sla_response_due_at', 'tickets.sla_response_due_at'],
  sla_response_at: ['sla_response_at', 'tickets.sla_response_at'],
  sla_response_met: ['sla_response_met', 'tickets.sla_response_met'],
  sla_resolution_due_at: ['sla_resolution_due_at', 'tickets.sla_resolution_due_at'],
  sla_resolution_at: ['sla_resolution_at', 'tickets.sla_resolution_at'],
  sla_resolution_met: ['sla_resolution_met', 'tickets.sla_resolution_met'],
  sla_paused_at: ['sla_paused_at', 'tickets.sla_paused_at'],
  sla_total_pause_minutes: ['sla_total_pause_minutes', 'tickets.sla_total_pause_minutes'],
  tenant: ['tenant', 'tickets.tenant'],
  bundle_child_count: ['bundle_child_count'],
  bundle_open_child_count: ['bundle_open_child_count'],
  bundle_distinct_client_count: ['bundle_distinct_client_count'],
  bundle_master_ticket_number: ['bundle_master_ticket_number'],
  contact_tags: ['contact_tags'],
  client_tags: ['client_tags'],
  additional_agent_count: ['additional_agent_count'],
  additional_agents: ['additional_agents'],
  latest_activity_at: ['latest_activity_at'],
  latest_activity_actor: ['latest_activity_actor'],
  client_logo_url: ['client_logo_url'],
  contact_avatar_url: ['contact_avatar_url'],
  comments: ['comments', 'ticket_comment'],
};

const ALIAS_TO_FIELD = new Map<string, string>();
for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
  ALIAS_TO_FIELD.set(field, field);
  for (const alias of aliases) ALIAS_TO_FIELD.set(alias, field);
}

export interface TicketReadMask {
  /** Canonical policy fields; aliases have already been folded together. */
  fields: ReadonlySet<string>;
  /** Wildcards and unknown names cannot be projected safely, so omit the resource. */
  dropResource: boolean;
  /** Derived activity, bundle, comment, tag, and enrichment fields are suppressed on any redaction. */
  redactDerived: boolean;
}

export function ticketReadMask(redactedFields: readonly string[]): TicketReadMask {
  const fields = new Set<string>();
  let dropResource = false;
  for (const raw of redactedFields) {
    if (typeof raw !== 'string' || !raw.trim()) {
      dropResource = true;
      continue;
    }
    const value = raw.trim().toLowerCase();
    if (value === '*' || value === 'fields' || value === 'ticket' || value === 'tickets') {
      dropResource = true;
      continue;
    }
    // Attributes are open-ended JSON. Any key-level restriction hides the full JSON value.
    if (value === 'attributes' || value === 'tickets.attributes' || value.startsWith('attributes.') || value.startsWith('tickets.attributes.')) {
      fields.add('attributes');
      continue;
    }
    const canonical = ALIAS_TO_FIELD.get(value);
    if (!canonical) {
      dropResource = true;
      continue;
    }
    fields.add(canonical);
  }
  if (fields.has('ticket_id')) dropResource = true;
  return { fields, dropResource, redactDerived: redactedFields.length > 0 };
}

export function ticketReadFieldHidden(redactedFields: readonly string[], field: string): boolean {
  const mask = ticketReadMask(redactedFields);
  if (mask.dropResource || mask.fields.has(field)) return true;
  const related: Record<string, readonly string[]> = {
    client_id: ['client_name'],
    client_name: ['client_id'],
    contact_name_id: ['contact_name'],
    contact_name: ['contact_name_id'],
    assigned_to: ['assigned_to_name'],
    assigned_to_name: ['assigned_to'],
    entered_by: ['entered_by_name'],
    entered_by_name: ['entered_by'],
    assigned_team_id: ['assigned_team_name'],
    assigned_team_name: ['assigned_team_id'],
    status_id: ['status_name'],
    status_name: ['status_id'],
    is_closed: ['status_name'],
    priority_id: ['priority_name'],
    priority_name: ['priority_id'],
    priority_color: ['priority_name', 'priority_id'],
    board_id: ['board_name'],
    board_name: ['board_id'],
    description: ['attributes'],
    attributes: ['description'],
  };
  return (related[field] ?? []).some((name) => mask.fields.has(name));
}

export function ticketRedactionKey(redactedFields: readonly string[]): string {
  const mask = ticketReadMask(redactedFields);
  return JSON.stringify([mask.dropResource, [...mask.fields].sort()]);
}

/** Result payload defense in depth. Database readers use the same mask before selecting values. */
export function redactTicketReadPayload<T extends Record<string, any>>(value: T, redactedFields: readonly string[]): T {
  const mask = ticketReadMask(redactedFields);
  if (mask.dropResource) return {} as T;
  if (redactedFields.length === 0) return value;
  const result: Record<string, any> = { ...value };
  const effectiveFields = new Set(mask.fields);
  for (const field of Object.keys(FIELD_ALIASES)) {
    if (ticketReadFieldHidden(redactedFields, field)) effectiveFields.add(field);
  }
  for (const field of effectiveFields) {
    if (field === 'title') result.title = 'Restricted ticket';
    else if (field === 'description' || field === 'attributes') {
      result.description = null;
      result.attributes = null;
    } else if (field === 'client_name') {
      result.client_name = null;
      result.client_id = null;
      result.client_logo_url = null;
    } else if (field === 'contact_name') {
      result.contact_name = null;
      result.contact_name_id = null;
      result.contact_avatar_url = null;
    } else if (field === 'assigned_to' || field === 'entered_by') {
      result[field] = null;
      result[field === 'assigned_to' ? 'assigned_to_name' : 'entered_by_name'] = null;
    } else if (field === 'assigned_team_id') {
      result.assigned_team_id = null;
      result.assigned_team_name = null;
    } else {
      result[field] = null;
    }
  }
  for (const field of Object.keys(result)) {
    const canonical = ALIAS_TO_FIELD.get(field.toLowerCase());
    if (!canonical || !ticketReadFieldHidden(redactedFields, canonical)) continue;
    result[field] = canonical === 'title' ? 'Restricted ticket' : null;
  }
  if (mask.redactDerived) {
    result.bundle_child_count = null;
    result.bundle_open_child_count = null;
    result.bundle_distinct_client_count = null;
    result.bundle_master_ticket_number = null;
    result.comments = [];
    result.latest_activity_actor = null;
    result.latest_activity_at = null;
    result.contact_tags = [];
    result.client_tags = [];
    result.additional_agents = [];
    result.additional_agent_count = 0;
    result.__ticket_read_has_redactions = true;
  }
  return result as T;
}
