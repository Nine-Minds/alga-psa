/** Shared authorization projection for ticket source fields, list aliases and derived values. */
export type TicketFieldProjection = {
  field: string;
  sources: readonly string[];
  aliases: readonly string[];
  neutral?: string | null;
};

export const TICKET_FIELD_PROJECTIONS: readonly TicketFieldProjection[] = [
  { field: 'ticket_id', sources: ['ticket_id'], aliases: ['ticket_id'] },
  { field: 'ticket_number', sources: ['ticket_number'], aliases: ['ticket_number', 'bundle_master_ticket_number'] },
  { field: 'title', sources: ['title', 'tickets.title'], aliases: ['title'], neutral: 'Hidden ticket' },
  { field: 'url', sources: ['url'], aliases: ['url'], neutral: null },
  { field: 'description', sources: ['attributes.description', 'description'], aliases: ['description'], neutral: null },
  { field: 'client_id', sources: ['client_id', 'clients.client_name'], aliases: ['client_name', 'client_tags', 'client_logo_url', 'bundle_distinct_client_count'], neutral: null },
  { field: 'contact_name_id', sources: ['contact_name_id', 'contacts.full_name'], aliases: ['contact_name', 'contact_tags', 'contact_avatar_url'], neutral: null },
  { field: 'status_id', sources: ['status_id', 'statuses.name', 'statuses.is_closed'], aliases: ['status_name', 'is_closed'], neutral: null },
  { field: 'priority_id', sources: ['priority_id', 'priorities.priority_name', 'priorities.color'], aliases: ['priority_name', 'priority_color'], neutral: null },
  { field: 'board_id', sources: ['board_id', 'boards.board_name'], aliases: ['board_name'], neutral: null },
  { field: 'category_id', sources: ['category_id'], aliases: ['category_name'], neutral: null },
  { field: 'assigned_to', sources: ['assigned_to', 'users.first_name', 'users.last_name'], aliases: ['assigned_to_name', 'additional_agents', 'additional_agent_count'], neutral: null },
  { field: 'assigned_team_id', sources: ['assigned_team_id', 'teams.team_name'], aliases: ['assigned_team_name'], neutral: null },
  { field: 'entered_by', sources: ['entered_by', 'users.first_name', 'users.last_name'], aliases: ['entered_by_name'], neutral: null },
  { field: 'updated_by', sources: ['updated_by'], aliases: ['updated_by'], neutral: null },
  { field: 'closed_by', sources: ['closed_by'], aliases: ['closed_by'], neutral: null },
  { field: 'location_id', sources: ['location_id'], aliases: ['location_id'], neutral: null },
  { field: 'subcategory_id', sources: ['subcategory_id'], aliases: ['subcategory_id'], neutral: null },
  { field: 'billing_profile_id', sources: ['billing_profile_id'], aliases: ['billing_profile_id'], neutral: null },
  { field: 'attributes', sources: ['attributes', 'attributes.description'], aliases: ['attributes', 'description'], neutral: null },
  { field: 'entered_at', sources: ['entered_at'], aliases: ['entered_at'], neutral: null },
  { field: 'updated_at', sources: ['updated_at'], aliases: ['updated_at'], neutral: null },
  { field: 'closed_at', sources: ['closed_at'], aliases: ['closed_at'], neutral: null },
  { field: 'due_date', sources: ['due_date'], aliases: ['due_date'], neutral: null },
  { field: 'master_ticket_id', sources: ['master_ticket_id'], aliases: ['master_ticket_id', 'bundle_master_ticket_number'], neutral: null },
  { field: 'itil_impact', sources: ['itil_impact'], aliases: ['itil_impact'], neutral: null },
  { field: 'itil_urgency', sources: ['itil_urgency'], aliases: ['itil_urgency'], neutral: null },
  { field: 'itil_priority_level', sources: ['itil_priority_level'], aliases: ['itil_priority_level'], neutral: null },
  { field: 'response_state', sources: ['response_state'], aliases: ['response_state'], neutral: null },
  { field: 'ticket_origin', sources: ['ticket_origin'], aliases: ['ticket_origin'], neutral: null },
  { field: 'sla_policy_id', sources: ['sla_policy_id'], aliases: ['sla_policy_id'], neutral: null },
  { field: 'sla_started_at', sources: ['sla_started_at'], aliases: ['sla_started_at'], neutral: null },
  { field: 'sla_response_due_at', sources: ['sla_response_due_at'], aliases: ['sla_response_due_at'], neutral: null },
  { field: 'sla_response_at', sources: ['sla_response_at'], aliases: ['sla_response_at'], neutral: null },
  { field: 'sla_response_met', sources: ['sla_response_met'], aliases: ['sla_response_met'], neutral: null },
  { field: 'sla_resolution_due_at', sources: ['sla_resolution_due_at'], aliases: ['sla_resolution_due_at'], neutral: null },
  { field: 'sla_resolution_at', sources: ['sla_resolution_at'], aliases: ['sla_resolution_at'], neutral: null },
  { field: 'sla_resolution_met', sources: ['sla_resolution_met'], aliases: ['sla_resolution_met'], neutral: null },
  { field: 'sla_paused_at', sources: ['sla_paused_at'], aliases: ['sla_paused_at'], neutral: null },
  { field: 'sla_total_pause_minutes', sources: ['sla_total_pause_minutes'], aliases: ['sla_total_pause_minutes'], neutral: null },
  { field: 'bundle_child_count', sources: ['master_ticket_id'], aliases: ['bundle_child_count'], neutral: null },
  { field: 'bundle_open_child_count', sources: ['master_ticket_id', 'closed_at'], aliases: ['bundle_open_child_count'], neutral: null },
  { field: 'bundle_distinct_client_count', sources: ['client_id', 'master_ticket_id'], aliases: ['bundle_distinct_client_count'], neutral: null },
  { field: 'latest_activity_at', sources: ['updated_at', 'comments.created_at'], aliases: ['latest_activity_at'], neutral: null },
  { field: 'latest_activity_actor', sources: ['updated_by', 'entered_by', 'comments.user_id', 'comments.contact_id', 'users.first_name', 'users.last_name', 'contacts.full_name'], aliases: ['latest_activity_actor'], neutral: null },
  { field: 'ticket_tags', sources: ['tag_mappings'], aliases: ['ticketTags', 'ticket_tags'], neutral: null },
  { field: 'tenant', sources: ['tenant'], aliases: ['tenant'], neutral: null },
];

function paths(field: string): string[] {
  return field.toLowerCase().replace(/\["?([^\]"']+)"?\]/g, '.$1').split('.').filter(Boolean);
}

function matches(pattern: string, candidate: string): boolean {
  const p = paths(pattern);
  const c = paths(candidate);
  if (p.length === 1 && p[0] === '*') return true;
  // Unqualified names match their source regardless of a table qualifier.
  // A parent path matches every descendant; a wildcard matches one path segment.
  const suffixMatch = (longer: string[], shorter: string[]) => {
    if (shorter.length > longer.length) return false;
    const offset = longer.length - shorter.length;
    return shorter.every((part, index) => part === '*' || part === longer[offset + index]);
  };
  const prefixMatch = (parent: string[], child: string[]) => parent.length <= child.length &&
    parent.every((part, index) => part === '*' || part === child[index]);
  return suffixMatch(p, c) || suffixMatch(c, p) || prefixMatch(p, c) || prefixMatch(c, p);
}

export function isTicketFieldHidden(redactions: readonly string[], projection: TicketFieldProjection): boolean {
  if (projection.field === 'attributes') {
    return redactions.some((redaction) => ['attributes', 'ticket.attributes', 'tickets.attributes'].includes(redaction.toLowerCase()));
  }
  const names = [projection.field, ...projection.sources, ...projection.aliases];
  return redactions.some((redaction) => {
    if (!redaction) return false;
    const field = redaction.toLowerCase();
    return names.some((name) => matches(field, name) || matches(name, field) || matches(field, `tickets.${name}`) || matches(field, `ticket.${name}`));
  });
}

export function hiddenTicketFields(redactions: readonly string[]): Set<string> {
  const resourceWide = redactions.some((redaction) => ['ticket', 'tickets', 'ticket.*', 'tickets.*'].includes(redaction.toLowerCase()));
  const matched = TICKET_FIELD_PROJECTIONS.filter((projection) => resourceWide || isTicketFieldHidden(redactions, projection));
  const hidden = new Set(matched.flatMap(({ field, sources, aliases }) => [field, ...sources, ...aliases]));
  if (resourceWide) hidden.add('ticket_id');
  return hidden;
}

/** Resolve policy names once against the ticket's actual custom-attribute keys.
 * Unqualified custom keys are supported; names that are neither known ticket
 * fields nor present custom keys are rejected so callers cannot return data
 * after silently dropping an unrecognized policy instruction.
 */
export function interpretTicketRedactions(
  redactions: readonly string[],
  attributes: Record<string, unknown> | null | undefined
): { hiddenFields: Set<string>; hiddenAttributes: Set<string> } {
  const hiddenFields = hiddenTicketFields([]);
  const hiddenAttributes = new Set<string>();
  for (const raw of redactions) {
    if (typeof raw !== 'string' || raw.trim() === '') throw new Error('Unsupported empty ticket redaction');
    const name = raw.trim();
    const attributeName = name.replace(/^(?:tickets?|attributes)\./i, '').toLowerCase();
    const attributeKeys = Object.keys(attributes ?? {});
    const attributeKey = attributeKeys.find((key) => key.toLowerCase() === attributeName);
    const customAttributePath = /^(?:tickets?\.)?attributes\./i.test(name) && attributeKey !== undefined && attributeName !== 'description';
    const fieldMatch = TICKET_FIELD_PROJECTIONS.some((projection) =>
      !(customAttributePath && projection.field === 'attributes') && isTicketFieldHidden([name], projection));
    if (fieldMatch) {
      for (const field of hiddenTicketFields([name])) hiddenFields.add(field);
    } else if (attributeKey) {
      hiddenAttributes.add(attributeKey);
    } else {
      throw new Error(`Unsupported ticket redaction: ${name}`);
    }
  }
  return { hiddenFields, hiddenAttributes };
}

export function redactTicketAttributes(
  attributes: Record<string, unknown> | null | undefined,
  redactions: readonly string[]
): Record<string, unknown> | null {
  if (!attributes) return attributes ?? null;
  const { hiddenFields, hiddenAttributes } = interpretTicketRedactions(redactions, attributes);
  if (hiddenFields.has('attributes')) return null;
  return Object.fromEntries(Object.entries(attributes).filter(([key]) => !hiddenAttributes.has(key)));
}

function setPathValue(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = paths(path);
  let current = target;
  for (const part of parts.slice(0, -1)) {
    const next = current[part];
    if (!next || typeof next !== 'object') return;
    current = next as Record<string, unknown>;
  }
  if (parts.length) current[parts.at(-1)!] = value;
}

/** Applies the same semantic projection after list enrichment has attached derived fields. */
export function projectTicketRow<T extends Record<string, unknown>>(row: T, redactions: readonly string[]): T | null {
  const resourceWide = redactions.some((redaction) => ['ticket', 'tickets', 'ticket.*', 'tickets.*'].includes(redaction.toLowerCase()));
  const projected: Record<string, unknown> = { ...row };
  for (const projection of TICKET_FIELD_PROJECTIONS) {
    if (!(resourceWide || isTicketFieldHidden(redactions, projection))) continue;
    if (projection.field === 'ticket_id') return null;
    for (const alias of projection.aliases) {
      if (alias.includes('.')) setPathValue(projected, alias, projection.neutral ?? null);
      else projected[alias] = projection.neutral ?? null;
    }
    projected[projection.field] = projection.neutral ?? null;
  }
  return projected as T;
}
