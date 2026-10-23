/**
 * Plain-language names for workflow fields that have no description in their schema, so every
 * field list reads the same way: "Client name (client_name)", "Client name (clientName)",
 * "Ticket number (ticket_number)", "URL (url)".
 */

const ACRONYMS = new Set(['id', 'ids', 'url', 'uri', 'html', 'api', 'ip', 'sla', 'utc', 'iso', 'csv', 'pdf', 'sms']);

/** "clientName" / "client_name" → "Client name"; "contact_id" → "Contact ID"; "url" → "URL". */
export const humanizeWorkflowFieldName = (name: string): string => {
  const words = name
    .replace(/\[-?\d*\]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => (ACRONYMS.has(word.toLowerCase()) ? word.toUpperCase() : word.toLowerCase()));
  if (words.length === 0) return name;
  const [first, ...rest] = words;
  const head = first === first.toUpperCase() ? first : first.charAt(0).toUpperCase() + first.slice(1);
  return [head, ...rest].join(' ');
};

/** The last name in a path: "ticket.comments[0].note" → "note". */
export const lastWorkflowFieldName = (path: string): string =>
  path.replace(/\[-?\d*\]/g, '').split('.').filter(Boolean).pop() ?? path;

/**
 * A field's label: its schema description when there is one, otherwise its humanized name, with
 * the path after it for people who know the data.
 */
export const formatWorkflowFieldLabel = (description: string | undefined, path: string): string => {
  const name = description?.trim() || humanizeWorkflowFieldName(lastWorkflowFieldName(path));
  return path ? `${name} (${path})` : name;
};

/** "ticket-priority" → "ticket priority": a record kind as words. */
export const humanizeWorkflowRecordKind = (kind: string): string => kind.replace(/[-_]+/g, ' ').trim();

/** Whether a word takes "an" (an opportunity, an asset) rather than "a". */
export const takesAnArticle = (word: string): boolean => /^[aeiou]/i.test(word.trim());
