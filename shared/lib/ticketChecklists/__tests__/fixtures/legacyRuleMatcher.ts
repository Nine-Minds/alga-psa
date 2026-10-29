import { flattenBlockContentToPlainText } from '@alga-psa/formatting/blocknoteUtils';
/** Frozen #3857 matcher. Test oracle only; never imported by production. */
export type ChecklistKeywordMode = 'any' | 'all';
export type ChecklistKeywordTarget = 'title' | 'description' | 'title_and_description';

/**
 * Matchers of an auto-apply rule. Every matcher is optional: null / empty
 * means "match any", and all matchers combine with AND.
 *
 * "From service request" is stored as its own boolean (`from_service_request`)
 * rather than a sentinel in `ticket_origins`; naming a definition implies it.
 * Service-request tickets carry no ticket_origin value of their own.
 */
export interface ChecklistApplyRuleMatchers {
  board_id: string | null;
  category_id: string | null;
  subcategory_id: string | null;
  priority_id: string | null;
  client_ids?: string[] | null;
  ticket_origins?: string[] | null;
  from_service_request?: boolean | null;
  service_request_definition_id?: string | null;
  keywords?: string[] | null;
  keyword_mode?: ChecklistKeywordMode | null;
  keyword_target?: ChecklistKeywordTarget | null;
}

interface ChecklistTemplateApplyRuleRow extends ChecklistApplyRuleMatchers {
  template_id: string;
}

/** Everything a rule can be evaluated against. */
export interface ChecklistRuleTicketInput {
  board_id?: string | null;
  category_id?: string | null;
  subcategory_id?: string | null;
  priority_id?: string | null;
  client_id?: string | null;
  ticket_origin?: string | null;
  title?: string | null;
  description?: string | null;
  fromServiceRequest: boolean;
  serviceRequestDefinitionId: string | null;
}

function normalizeKeywords(keywords: string[] | null | undefined): string[] {
  return (keywords ?? []).map((k) => k.trim().toLowerCase()).filter((k) => k.length > 0);
}

/**
 * Pure predicate: does this auto-apply rule match this ticket?
 * Null / empty matchers match anything; all matchers combine with AND.
 * Keywords are trimmed + lowercased (empties ignored) and matched as
 * case-insensitive substrings — no regex.
 */
export function ruleMatchesTicket(
  rule: ChecklistApplyRuleMatchers,
  ticket: ChecklistRuleTicketInput
): boolean {
  if (rule.board_id != null && rule.board_id !== ticket.board_id) return false;
  if (rule.category_id != null && rule.category_id !== ticket.category_id) return false;
  if (rule.subcategory_id != null && rule.subcategory_id !== ticket.subcategory_id) return false;
  if (rule.priority_id != null && rule.priority_id !== ticket.priority_id) return false;

  if (rule.client_ids && rule.client_ids.length > 0) {
    if (!ticket.client_id || !rule.client_ids.includes(ticket.client_id)) return false;
  }

  if (rule.ticket_origins && rule.ticket_origins.length > 0) {
    if (!ticket.ticket_origin || !rule.ticket_origins.includes(ticket.ticket_origin)) return false;
  }

  if (rule.from_service_request || rule.service_request_definition_id) {
    if (!ticket.fromServiceRequest) return false;
    if (
      rule.service_request_definition_id &&
      rule.service_request_definition_id !== ticket.serviceRequestDefinitionId
    ) {
      return false;
    }
  }

  const keywords = normalizeKeywords(rule.keywords);
  if (keywords.length > 0) {
    const target = rule.keyword_target ?? 'title_and_description';
    const title = (ticket.title ?? '').toLowerCase();
    const description = (ticket.description ?? '').toLowerCase();
    // Fields are searched separately so a keyword can never match across the
    // title/description boundary.
    const fields =
      target === 'title' ? [title] : target === 'description' ? [description] : [title, description];
    const found = (k: string) => fields.some((f) => f.includes(k));
    const ok = (rule.keyword_mode ?? 'any') === 'all' ? keywords.every(found) : keywords.some(found);
    if (!ok) return false;
  }

  return true;
}


/**
 * Reduce a ticket description to the text the user can see. Rich-text
 * descriptions are BlockNote JSON (string, or already-parsed array/object in
 * jsonb); keyword matching must never run against that raw JSON. Plain /
 * markdown strings pass through unchanged. Returns null when nothing visible.
 */
export function ticketDescriptionToPlainText(value: unknown): string | null {
  let candidate = value;
  if (typeof value === 'string') {
    const raw: string = value;
    const trimmed = raw.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        candidate = JSON.parse(trimmed);
      } catch {
        // Not JSON (e.g. "[x] done"): plain text, unchanged.
        return trimmed === '' ? null : raw;
      }
    } else {
      // Includes plain text that happens to be valid JSON scalars ("123", "null").
      return trimmed === '' ? null : raw;
    }
  }
  const isBlockArray = Array.isArray(candidate);
  const isDoc =
    !!candidate && typeof candidate === 'object' && (candidate as { type?: unknown }).type === 'doc';
  if (!isBlockArray && !isDoc) return null;
  const text = flattenBlockContentToPlainText(candidate);
  return text.trim() === '' ? null : text;
}

/**
 * Tickets have no description column: the text lives in attributes.description
 * (jsonb, normally already parsed; tolerate a JSON string). Returns plain text.
 */
export function ticketDescriptionFromAttributes(attributes: unknown): string | null {
  let attrs = attributes;
  if (typeof attrs === 'string') {
    try {
      attrs = JSON.parse(attrs);
    } catch {
      return null;
    }
  }
  const description = (attrs as { description?: unknown } | null | undefined)?.description;
  return ticketDescriptionToPlainText(description);
}
