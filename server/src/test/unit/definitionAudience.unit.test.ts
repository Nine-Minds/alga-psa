import { describe, expect, it, vi } from 'vitest';
import { isAudienceSatisfied, isEditorAudience } from '../../lib/service-requests/audiencePredicate';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const clause = (path: string, value = id) => ({ path, operator: 'in', value: [value] });
const selected = (...clauses: unknown[]) => ({ join: 'or', clauses });
const requester = { client: { id, tags: [id] }, contact: { id, tags: [id], group: { id } }, user: { id } };

describe('service request audience predicate', () => {
  it('allows everyone and denies an empty selected audience', () => {
    expect(isAudienceSatisfied({ join: 'and', clauses: [] }, requester)).toBe(true);
    expect(isAudienceSatisfied(selected(), requester)).toBe(false);
    expect(isEditorAudience(selected())).toBe(true);
  });
  it.each(['client.id', 'client.tags', 'contact.id', 'contact.tags', 'contact.group.id', 'user.id'])('evaluates %s', (path) => {
    expect(isAudienceSatisfied(selected(clause(path)), requester)).toBe(true);
    expect(isAudienceSatisfied(selected(clause(path, other)), requester)).toBe(false);
  });
  it('combines entries with OR and narrowing with AND', () => {
    const narrowed = { join: 'and', clauses: [clause('client.id'), clause('contact.tags', other)] };
    expect(isAudienceSatisfied(selected(narrowed), requester)).toBe(false);
    expect(isAudienceSatisfied(selected(narrowed, clause('contact.id')), requester)).toBe(true);
    expect(isEditorAudience(selected(narrowed))).toBe(true);
    expect(isAudienceSatisfied(selected(clause('contact.group.id')), { ...requester, contact: null })).toBe(false);
  });
  it('rejects unsupported, malformed and non-editor shapes', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(isAudienceSatisfied(selected(clause('contact.password')), requester)).toBe(false);
    expect(isAudienceSatisfied({ join: 'or', clauses: [{ path: 'contact.id', operator: 'in', value: id }] }, requester)).toBe(false);
    expect(isEditorAudience(selected(clause('user.id')))).toBe(false);
    expect(isEditorAudience(selected({ ...clause('client.id'), value: [id, other] }))).toBe(false);
    expect(isEditorAudience(selected({ path: 'contact.tags', operator: 'in', value: [] }))).toBe(false);
    log.mockRestore();
  });
});
