/**
 * Search vocabulary for the workflow designer: groups of words people use for the same thing in
 * an MSP help desk. Palette search and event search both expand terms through these groups, so
 * "note" finds "Add Ticket Comment" and "reply" finds "Ticket Customer Replied".
 *
 * Keep groups small and domain-specific. Each group lists inflected forms explicitly because the
 * matcher compares whole normalized words, not stems. A word may appear in more than one group.
 */
export const WORKFLOW_SEARCH_SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ['comment', 'comments', 'note', 'notes', 'commented'],
  ['reply', 'replies', 'replied', 'respond', 'responds', 'responded', 'response', 'responses', 'answer', 'answered'],
  ['notify', 'notifies', 'notified', 'notification', 'notifications', 'alert', 'alerts'],
  ['assign', 'assigns', 'assigned', 'assignee', 'assignment', 'owner', 'route', 'routed'],
  ['unassign', 'unassigned', 'unassignment'],
  ['close', 'closes', 'closed', 'resolve', 'resolves', 'resolved', 'resolution'],
  ['reopen', 'reopens', 'reopened'],
  ['email', 'emails', 'mail', 'message', 'messages', 'inbound'],
  ['ticket', 'tickets', 'service ticket', 'service tickets', 'case', 'cases', 'issue', 'issues', 'incident', 'incidents'],
  // ConnectWise wording. Events exist for contracts and assets only, so product/service is not mapped.
  ['contract', 'contracts', 'agreement', 'agreements'],
  ['asset', 'assets', 'configuration', 'configurations'],
  ['client', 'clients', 'customer', 'customers', 'company', 'companies', 'account', 'accounts'],
  ['contact', 'contacts', 'person', 'people', 'end user'],
  ['user', 'users', 'technician', 'technicians', 'tech', 'techs', 'agent', 'agents', 'staff', 'member'],
  ['team', 'teams', 'group', 'groups'],
  ['priority', 'priorities', 'urgency', 'severity', 'urgent', 'critical'],
  ['status', 'statuses', 'state', 'stage'],
  ['board', 'boards', 'queue', 'queues'],
  ['wait', 'waits', 'delay', 'delays', 'pause', 'sleep', 'timer'],
  ['create', 'creates', 'created', 'new', 'add', 'adds', 'added', 'open', 'opened'],
  ['update', 'updates', 'updated', 'edit', 'edited', 'change', 'changes', 'changed', 'modify', 'modified'],
  ['delete', 'deletes', 'deleted', 'remove', 'removes', 'removed'],
  ['find', 'finds', 'search', 'lookup', 'look up', 'get', 'fetch', 'load'],
  ['attachment', 'attachments', 'file', 'files', 'document', 'documents'],
  ['time', 'timesheet', 'timesheets', 'hours', 'entry', 'entries'],
  ['schedule', 'schedules', 'scheduled', 'appointment', 'appointments', 'calendar', 'dispatch'],
  ['project', 'projects', 'task', 'tasks', 'phase', 'phases'],
  ['condition', 'if', 'branch', 'decision'],
  ['loop', 'foreach', 'for each', 'repeat', 'iterate', 'each'],
  ['increment', 'increments', 'incremented', 'counter', 'counters', 'tally', 'tallies', 'count up'],
  ['store', 'stored', 'storage', 'remember', 'save', 'saved', 'persist', 'variable'],
];

const normalizeSearchWord = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const SYNONYMS_BY_WORD: ReadonlyMap<string, readonly string[]> = (() => {
  const map = new Map<string, Set<string>>();
  for (const group of WORKFLOW_SEARCH_SYNONYM_GROUPS) {
    const normalizedGroup = group.map(normalizeSearchWord).filter(Boolean);
    for (const word of normalizedGroup) {
      const entry = map.get(word) ?? new Set<string>();
      normalizedGroup.forEach((member) => entry.add(member));
      map.set(word, entry);
    }
  }
  return new Map(Array.from(map.entries()).map(([word, members]) => [word, Array.from(members)]));
})();

/**
 * Words with the same meaning as `word` (including itself). Multi-word synonyms come back as
 * phrases ("end user"). Unknown words return just themselves.
 */
export const getSearchSynonyms = (word: string): string[] => {
  const normalized = normalizeSearchWord(word);
  if (!normalized) return [];
  return Array.from(new Set([normalized, ...(SYNONYMS_BY_WORD.get(normalized) ?? [])]));
};

/**
 * Extra search text for an item: every synonym of every word in `values`, space-separated. Store it
 * as an item's keywords so plain substring search also finds the item by synonyms.
 */
export const buildSynonymKeywords = (values: Array<string | null | undefined>): string => {
  const keywords = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const normalized = normalizeSearchWord(value);
    if (!normalized) continue;
    keywords.add(normalized);
    for (const word of normalized.split(' ')) {
      for (const synonym of getSearchSynonyms(word)) keywords.add(synonym);
    }
  }
  return Array.from(keywords).join(' ');
};
