import { describe, expect, it } from 'vitest';

import {
  findAutoMappingSuggestions,
  isApplicableSuggestion,
  isFillableSuggestion,
  isStrongSuggestion,
  rankSourcesForTarget,
  selectBulkApplicableSuggestions,
  splitFieldNameWords,
} from '../mapping/autoMappingSuggestions';

describe('auto-mapping suggestions', () => {
  it('matches whole words only, so short names never match inside longer ones', () => {
    expect(splitFieldNameWords('occursOn')).toEqual(['occurs', 'on']);
    const suggestions = findAutoMappingSuggestions(
      [{ name: 'cc', type: 'array', constraints: { itemType: 'object' } }],
      [{ path: 'payload.occursOn', type: 'string' }],
      {}
    );
    expect(suggestions).toEqual([]);
  });

  it('drops sources whose type cannot feed the input', () => {
    const suggestions = findAutoMappingSuggestions(
      [{ name: 'tags', type: 'array', constraints: { itemType: 'string' } }],
      [{ path: 'meta.tags', type: 'object' }],
      {}
    );
    expect(suggestions).toEqual([]);
  });

  it('prefers same-name, type-matched sources and marks them strong', () => {
    const [suggestion] = findAutoMappingSuggestions(
      [{ name: 'client_id', type: 'string' }],
      [
        { path: 'payload.client_name', type: 'string' },
        { path: 'vars.clientDetails.client.client_id', type: 'string' },
      ],
      {}
    );
    expect(suggestion).toMatchObject({
      sourcePath: 'vars.clientDetails.client.client_id',
      expression: 'vars.clientDetails.client.client_id',
      confidence: 'exact',
      typeMatched: true,
    });
    expect(isStrongSuggestion(suggestion, { name: 'client_id' })).toBe(true);
    // Same-name text fields are offered but never applied on their own.
    expect(isStrongSuggestion({ ...suggestion, targetField: 'title' }, { name: 'title' })).toBe(false);
  });

  it('suggests unknown-typed sources only on an exact name match, and never as strong', () => {
    const suggestions = findAutoMappingSuggestions(
      [{ name: 'external_ref', type: 'string' }, { name: 'name', type: 'string' }],
      [{ path: 'payload.external_ref' }, { path: 'payload.client_name' }],
      {}
    );
    expect(suggestions.map((s) => [s.targetField, s.sourcePath])).toEqual([['external_ref', 'payload.external_ref']]);
    expect(isStrongSuggestion(suggestions[0], { name: 'external_ref' })).toBe(false);
  });

  it('sends a single id as a one-item list for list inputs, and skips mapped inputs', () => {
    const suggestions = findAutoMappingSuggestions(
      [{ name: 'user_ids', type: 'array', constraints: { itemType: 'string' } }, { name: 'body', type: 'string' }],
      [{ path: 'vars.t.ticket.user_id', type: 'string' }, { path: 'payload.body', type: 'string' }],
      { body: 'x' }
    );
    expect(suggestions).toEqual([]);
    const [listSuggestion] = findAutoMappingSuggestions(
      [{ name: 'user_ids', type: 'array', constraints: { itemType: 'string' } }],
      [{ path: 'vars.t.user_ids', type: 'string' }],
      {}
    );
    expect(listSuggestion.expression).toBe('[vars.t.user_ids]');
  });
});

describe('semantic suggestion rules', () => {
  it('never suggests an id for a number input', () => {
    expect(findAutoMappingSuggestions(
      [{ name: 'by', type: 'number' }],
      [{ path: 'payload.assignedByUserId', type: 'string', kind: 'user' }],
      {}
    )).toEqual([]);
  });

  it('never fills a choice list from a loosely named field', () => {
    expect(findAutoMappingSuggestions(
      [{ name: 'response_state', type: 'string', enum: ['awaiting_client', 'awaiting_internal'] }],
      [{ path: 'meta.state', type: 'string' }, { path: 'payload.state', type: 'string' }],
      {}
    )).toEqual([]);
  });

  it('does not treat who acted as the requester, and prefers the ticket contact for a contact input', () => {
    const target = { name: 'contact_id', type: 'string', editor: { kind: 'picker', picker: { resource: 'contact' } } };
    const [suggestion] = findAutoMappingSuggestions(
      [target],
      [
        { path: 'payload.actorContactId', type: 'string', kind: 'contact' },
        { path: 'payload.assignedByUserId', type: 'string', kind: 'user' },
        { path: 'vars.ticketDetails.ticket.contact_name_id', type: 'string', kind: 'contact' },
      ],
      {}
    );
    expect(suggestion).toMatchObject({ sourcePath: 'vars.ticketDetails.ticket.contact_name_id', confidence: 'kind' });
    expect(isApplicableSuggestion(suggestion)).toBe(false);
    // The field's own Fill button applies it (the same kind of record), though bulk apply does not.
    expect(isFillableSuggestion(suggestion, target)).toBe(true);
    // A similar-name guess is only ever a hint, and a same-kind match needs a picker input.
    expect(isFillableSuggestion({ ...suggestion, confidence: 'partial' }, target)).toBe(false);
    expect(isFillableSuggestion(suggestion, { name: 'contact_id', editor: { kind: 'text' } })).toBe(false);
  });

  it('rejects a different kind of record even with the same name', () => {
    expect(findAutoMappingSuggestions(
      [{ name: 'user_id', type: 'string', editor: { picker: { resource: 'user' } } }],
      [{ path: 'vars.contactDetails.contact.user_id', type: 'string', kind: 'contact' }],
      {}
    )).toEqual([]);
  });

  it('keeps similar-name matches for records of a known kind, as hints only', () => {
    const [suggestion] = findAutoMappingSuggestions(
      [{ name: 'user_id', type: 'string', editor: { picker: { resource: 'user' } } }],
      [{ path: 'vars.ticketDetails.ticket.assigned_user_id', type: 'string', kind: 'user' }],
      {}
    );
    expect(suggestion.confidence).not.toBe('exact');
    expect(isApplicableSuggestion(suggestion)).toBe(false);
  });

  it('never hints text the author writes from a same- or similar-named field', () => {
    const suggestions = findAutoMappingSuggestions(
      [
        { name: 'comment', type: 'string' },
        { name: 'title', type: 'string' },
        { name: 'external_label', type: 'string' },
      ],
      [
        { path: 'vars.ticketDetails.latest_comment', type: 'string' },
        { path: 'vars.ticketDetails.ticket.title', type: 'string' },
        { path: 'vars.ticketDetails.label', type: 'string' },
      ],
      {}
    );
    // Not the ticket's latest comment for an assignment comment, not the ticket title for a
    // notification title, and no plain-text match on part of a name.
    expect(suggestions).toEqual([]);
  });
});

describe('rankSourcesForTarget', () => {
  it('ranks same name, then same kind, then similar names, then other fitting fields, with who-acted fields last', () => {
    const ranked = rankSourcesForTarget(
      { name: 'contact_id', type: 'string', editor: { picker: { resource: 'contact' } } },
      [
        { path: 'payload.actorContactId', type: 'string', kind: 'contact' },
        { path: 'payload.assignedByUserId', type: 'string', kind: 'user' },
        { path: 'vars.ticketDetails.ticket.contact_name_id', type: 'string', kind: 'contact' },
        { path: 'vars.contactDetails.contact.contact_id', type: 'string', kind: 'contact' },
        { path: 'payload.count', type: 'number' },
        { path: 'meta.state', type: 'string' },
      ]
    );
    expect(ranked.map((entry) => [entry.source.path, entry.tier])).toEqual([
      ['vars.contactDetails.contact.contact_id', 0],
      ['vars.ticketDetails.ticket.contact_name_id', 1],
      ['payload.actorContactId', 4],
    ]);
  });

  it('offers any value for text inputs and wraps single values for list inputs', () => {
    const textRanked = rankSourcesForTarget({ name: 'body', type: 'string' }, [{ path: 'payload.count', type: 'number' }]);
    expect(textRanked).toHaveLength(1);
    const listRanked = rankSourcesForTarget(
      { name: 'user_ids', type: 'array', constraints: { itemType: 'string' } },
      [{ path: 'vars.t.ticket.assigned_to', type: 'string', kind: 'user' }]
    );
    expect(listRanked[0].expression).toBe('[vars.t.ticket.assigned_to]');
  });

  it('bulk apply fills only empty required inputs, never optional side-effect inputs', () => {
    const targets = [
      { name: 'ticket_id', type: 'string', required: true },
      { name: 'body', type: 'string', required: true },
      { name: 'attachments', type: 'array', constraints: { itemType: 'object' }, required: false },
      { name: 'comment', type: 'string', required: false },
    ];
    const suggestions = findAutoMappingSuggestions(
      targets,
      [
        { path: 'vars.ticketDetails.ticket_id', type: 'string' },
        { path: 'vars.ticketDetails.body', type: 'string' },
        { path: 'vars.ticketDetails.attachments', type: 'array<object>' },
        { path: 'vars.ticketDetails.comment', type: 'string' },
      ],
      {}
    );
    // Optional inputs still get a per-field hint…
    expect(suggestions.map((s) => s.targetField)).toEqual(expect.arrayContaining(['attachments']));
    expect(suggestions.map((s) => s.targetField)).not.toContain('comment');
    // …but bulk apply leaves them, and skips required inputs the author already filled.
    const bulk = selectBulkApplicableSuggestions(suggestions, targets, (name) => name === 'body');
    expect(bulk.map((s) => s.targetField)).toEqual(['ticket_id']);
  });
});
