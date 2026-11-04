import type { TimeEntrySuggestion } from './deriveSuggestions';

/** Defaults for logging a suggestion (plan D15): start = first touch rounded down to 5 min, end = the
 * later of last touch rounded up to 5 min and start + 15 min. Rounding is on the epoch, which is
 * timezone-invariant for every zone whose offset is a multiple of 5 minutes. */
const FIVE_MIN_MS = 5 * 60 * 1000;
const MIN_SPAN_MS = 15 * 60 * 1000;

export function suggestedEntryTimes(
  suggestion: Pick<TimeEntrySuggestion, 'first_touch' | 'last_touch'>,
): { start: Date; end: Date } {
  const firstMs = new Date(suggestion.first_touch).getTime();
  const lastMs = new Date(suggestion.last_touch).getTime();
  const startMs = Math.floor(firstMs / FIVE_MIN_MS) * FIVE_MIN_MS;
  const roundedLastMs = Math.ceil(lastMs / FIVE_MIN_MS) * FIVE_MIN_MS;
  const endMs = Math.max(roundedLastMs, startMs + MIN_SPAN_MS);
  return { start: new Date(startMs), end: new Date(endMs) };
}

export type SuggestionActivityKind =
  | 'created'
  | 'commented'
  | 'internalNote'
  | 'statusChanged'
  | 'priorityChanged'
  | 'assignmentChanged'
  | 'documentsChanged'
  | 'checklistChanged'
  | 'linksChanged'
  | 'updated';

const KIND_BY_EVENT: Record<string, SuggestionActivityKind> = {
  TICKET_CREATED: 'created',
  TICKET_DUPLICATED_FROM: 'created',
  TICKET_COMMENT_ADDED: 'commented',
  TICKET_COMMENT_UPDATED: 'commented',
  TICKET_MESSAGE_ADDED: 'commented',
  TICKET_CUSTOMER_REPLIED: 'commented',
  TICKET_INTERNAL_NOTE_ADDED: 'internalNote',
  TICKET_STATUS_CHANGED: 'statusChanged',
  TICKET_CLOSED: 'statusChanged',
  TICKET_REOPENED: 'statusChanged',
  TICKET_PRIORITY_CHANGED: 'priorityChanged',
  TICKET_ASSIGNED: 'assignmentChanged',
  TICKET_UNASSIGNED: 'assignmentChanged',
  TICKET_DOCUMENT_ATTACHED: 'documentsChanged',
  TICKET_DOCUMENT_REMOVED: 'documentsChanged',
  TICKET_CHECKLIST_ITEM_COMPLETED: 'checklistChanged',
  TICKET_CHECKLIST_ITEM_UNCOMPLETED: 'checklistChanged',
  TICKET_CHECKLIST_TEMPLATE_APPLIED: 'checklistChanged',
  TICKET_EXTERNAL_LINK_ADDED: 'linksChanged',
  TICKET_EXTERNAL_LINK_UPDATED: 'linksChanged',
  TICKET_EXTERNAL_LINK_REMOVED: 'linksChanged',
};

/** Distinct, display-ready activity kinds for a suggestion's raw audit event types. */
export function suggestionActivityKinds(eventKinds: readonly string[]): SuggestionActivityKind[] {
  const kinds: SuggestionActivityKind[] = [];
  for (const eventType of eventKinds) {
    const kind = KIND_BY_EVENT[eventType] ?? 'updated';
    if (!kinds.includes(kind)) kinds.push(kind);
  }
  return kinds;
}
