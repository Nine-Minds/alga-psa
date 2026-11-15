import { describe, expect, it } from 'vitest';
import { resolveClientRelationshipSummary } from '@/lib/co-managed/clientRelationshipSummary';
import { HEADER_CASES, relationship, view } from './fixtures';

describe('resolveClientRelationshipSummary', () => {
  it.each([
    ['no relationship, authorized', HEADER_CASES.noRelationshipAuthorized, 'not_enabled'],
    ['no relationship, unauthorized', HEADER_CASES.noRelationshipUnauthorized, 'not_enabled'],
    ['active', HEADER_CASES.active, 'live'],
    ['ended', HEADER_CASES.ended, 'ended'],
    ['one live + one ended', HEADER_CASES.oneLiveOneEnded, 'live'],
    ['several live', HEADER_CASES.severalLive, 'selection_required'],
    ['cancelled-only', HEADER_CASES.cancelledOnly, 'not_enabled'],
  ] as const)('%s → %s', (_name, input, kind) => {
    expect(resolveClientRelationshipSummary(input).kind).toBe(kind);
  });

  it('is absent without a view', () => {
    expect(resolveClientRelationshipSummary(null).kind).toBe('absent');
    expect(resolveClientRelationshipSummary(undefined).kind).toBe('absent');
  });

  it('needs attention for an inconsistent record with nothing live, ahead of not_enabled', () => {
    expect(resolveClientRelationshipSummary(view({ inconsistent: true })).kind).toBe('attention');
  });

  it('keeps a live relationship ahead of an inconsistent flag', () => {
    const v = view({ inconsistent: true, selectedRelationshipId: 'rel-1', relationships: [relationship()] });
    expect(resolveClientRelationshipSummary(v).kind).toBe('live');
  });

  it('never treats a cancelled-only client as selection_required', () => {
    expect(resolveClientRelationshipSummary(HEADER_CASES.cancelledOnly).kind).not.toBe('selection_required');
  });

  it('is never live for several live relationships, and flags the multiple', () => {
    const phase = resolveClientRelationshipSummary(HEADER_CASES.severalLive);
    expect(phase).toMatchObject({ kind: 'selection_required', multiple: true });
  });

  it('an explicit selection resolves that relationship', () => {
    const phase = resolveClientRelationshipSummary(HEADER_CASES.severalLive, 'rel-2');
    expect(phase.kind).toBe('selection_required'); // the view still demands a selection until reloaded
    const reloaded = view({ selectedRelationshipId: 'rel-2', relationships: HEADER_CASES.severalLive.relationships });
    expect(resolveClientRelationshipSummary(reloaded)).toMatchObject({ kind: 'live', relationship: { relationshipId: 'rel-2' } });
  });

  it('does not derive setup authority: canSetUp does not change the phase', () => {
    expect(resolveClientRelationshipSummary(view({ canSetUp: true })).kind)
      .toBe(resolveClientRelationshipSummary(view({ canSetUp: false })).kind);
  });
});
