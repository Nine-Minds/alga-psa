/**
 * Unit tests for the curated ticket diff helper. These run without a DB
 * because the helper is pure for the synchronous overload. They cover
 * the core PRD claims for FR-33/34/35: curated fields only, label
 * resolution, no-op skipping.
 */

import { describe, expect, it } from 'vitest';

import {
  buildCuratedTicketDiff,
  hasCuratedChanges,
  type LabelResolutionMap,
} from '../../../../shared/lib/ticketActivity/curatedTicketDiff';

describe('buildCuratedTicketDiff', () => {
  const baseTicket = {
    ticket_id: 't1',
    tenant: 'tenant',
    title: 'Old title',
    status_id: 'status-old',
    priority_id: 'p-old',
    assigned_to: 'user-old',
    assigned_team_id: null,
    board_id: 'board-old',
    category_id: null,
    subcategory_id: null,
    client_id: 'client-old',
    contact_name_id: null,
    due_date: '2026-06-01',
    response_state: null,
    closed_at: null,
    closed_by: null,
    url: null,
    // Non-curated noise: must not appear in output.
    updated_at: '2026-05-01T00:00:00Z',
    is_closed: false,
    attributes: { foo: 'bar' },
  };

  it('returns empty object when nothing curated changed', () => {
    const out = buildCuratedTicketDiff(baseTicket, {
      // No-op fields
      title: 'Old title',
      status_id: 'status-old',
    });
    expect(out).toEqual({});
    expect(hasCuratedChanges(out)).toBe(false);
  });

  it('captures status change with resolved labels', () => {
    const labels: LabelResolutionMap = {
      status: new Map([
        ['status-old', 'New'],
        ['status-new', 'In Progress'],
      ]),
    };

    const out = buildCuratedTicketDiff(
      baseTicket,
      { status_id: 'status-new' },
      labels,
    );

    expect(out).toEqual({
      status_id: {
        old: 'status-old',
        new: 'status-new',
        oldLabel: 'New',
        newLabel: 'In Progress',
      },
    });
    expect(hasCuratedChanges(out)).toBe(true);
  });

  it('captures multiple curated fields and ignores non-curated ones', () => {
    const out = buildCuratedTicketDiff(baseTicket, {
      title: 'New title',
      priority_id: 'p-new',
      // Non-curated — should be ignored even if present in update payload.
      updated_at: '2099-01-01T00:00:00Z',
      attributes: { other: 'thing' },
      is_closed: true,
    });

    expect(Object.keys(out).sort()).toEqual(['priority_id', 'title']);
    expect(out.title).toEqual({ old: 'Old title', new: 'New title' });
    expect(out.priority_id?.old).toBe('p-old');
    expect(out.priority_id?.new).toBe('p-new');
  });

  it('treats explicit null and "set to null" as a change when current is non-null', () => {
    const out = buildCuratedTicketDiff(baseTicket, {
      assigned_to: null,
    });

    // The helper unconditionally attaches oldLabel/newLabel slots for
    // labelable fields; when no label map was provided they're explicitly
    // null. That's fine — the UI just renders the IDs instead.
    expect(out.assigned_to).toMatchObject({ old: 'user-old', new: null });
    expect(out.assigned_to?.oldLabel).toBeNull();
    expect(out.assigned_to?.newLabel).toBeNull();
  });

  it('skips when current and update both null', () => {
    const out = buildCuratedTicketDiff(baseTicket, {
      assigned_team_id: null,
    });
    expect(out.assigned_team_id).toBeUndefined();
  });

  it('returns empty when current ticket is missing', () => {
    const out = buildCuratedTicketDiff(undefined, {
      status_id: 'status-new',
    });
    expect(out).toEqual({});
  });

  it('skips fields not present in the update payload', () => {
    const out = buildCuratedTicketDiff(baseTicket, {
      title: 'New title',
    });
    // status_id differs in baseTicket but is not in update — should not appear.
    expect(out.status_id).toBeUndefined();
    expect(out.title).toBeTruthy();
  });

  it('normalizes Date instances for due_date', () => {
    const newDate = new Date('2026-06-15T00:00:00Z');
    const out = buildCuratedTicketDiff(
      { ...baseTicket, due_date: '2026-06-01' },
      { due_date: newDate as unknown as string },
    );
    expect(out.due_date?.old).toBe('2026-06-01');
    expect(out.due_date?.new).toBe(newDate.toISOString());
  });
});
