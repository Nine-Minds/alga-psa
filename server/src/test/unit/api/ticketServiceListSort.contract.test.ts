/**
 * Contract for the `GET /api/v1/tickets` sort/fields allowlists.
 *
 * `paginationQuerySchema` only checks that `sort` is a string, so before the
 * allowlist an unknown value was interpolated straight into `orderBy('t.<value>')`
 * and surfaced as a Postgres error (500) rather than a validation error (400).
 * These tests pin the allowlist, the legacy created_at alias, the 400, and the
 * `latest_activity_at` field selection (including that it stays out of the
 * mobile_list preset, whose payload must not change).
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

import { ValidationError } from 'server/src/lib/api/middleware/apiMiddleware';
import {
  TicketService,
  TICKET_LIST_API_SORT_KEYS,
  resolveTicketListApiSort,
} from 'server/src/lib/api/services/TicketService';

const source = readFileSync(
  resolve(__dirname, '../../../lib/api/services/TicketService.ts'),
  'utf8',
);

/** The join aliases `TicketService.list` actually declares. */
const ALLOWED_ALIASES = ['t.', 'comp.', 'stat.', 'pri.'];

function normalizeFields(fields?: string[]): string[] | null {
  return (new TicketService() as any).normalizeTicketListFields(fields);
}

describe('ticket list API sort allowlist', () => {
  it('maps every allowed sort key to SQL under a declared join alias', () => {
    expect(TICKET_LIST_API_SORT_KEYS.length).toBeGreaterThan(0);

    for (const key of TICKET_LIST_API_SORT_KEYS) {
      const { field, spec } = resolveTicketListApiSort(key);
      expect(field, key).toBe(key);

      if (spec.activity) {
        // latest_activity_at resolves to the shared activity expression at call
        // time (portal-safe variant for client contexts), so it carries no column.
        expect(spec.column, key).toBeUndefined();
        continue;
      }

      expect(spec.column, key).toBeTruthy();
      expect(ALLOWED_ALIASES.some((alias) => spec.column!.startsWith(alias)), spec.column).toBe(
        true,
      );
    }
  });

  it('keeps the keys existing API callers already use', () => {
    // Removing any of these is a breaking change for current integrations.
    expect(TICKET_LIST_API_SORT_KEYS).toEqual(
      expect.arrayContaining([
        'ticket_number',
        'title',
        'entered_at',
        'updated_at',
        'closed_at',
        'due_date',
        'client_name',
        'status_name',
        'priority_name',
        'latest_activity_at',
      ]),
    );
  });

  it('keeps created_at working as an alias for entered_at', () => {
    // `tickets` has no created_at column; the API has always accepted the name.
    const { field, spec } = resolveTicketListApiSort('created_at');
    expect(field).toBe('entered_at');
    expect(spec).toEqual({ column: 't.entered_at' });
  });

  it('orders latest_activity_at by an expression rather than a column', () => {
    expect(resolveTicketListApiSort('latest_activity_at').spec).toEqual({ activity: true });
  });

  it('rejects an unknown sort key with a 400, not a database error', () => {
    let thrown: unknown;
    try {
      resolveTicketListApiSort('drop_table');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ValidationError);
    expect((thrown as ValidationError).statusCode).toBe(400);
    expect((thrown as Error).message).toContain('drop_table');
    // The message names the supported values so callers can self-correct.
    expect((thrown as Error).message).toContain('latest_activity_at');
    expect((thrown as Error).message).toContain('created_at');
  });

  it('rejects an injection attempt in sort rather than interpolating it', () => {
    expect(() => resolveTicketListApiSort('entered_at desc; drop table tickets')).toThrow(
      ValidationError,
    );
    expect(() => resolveTicketListApiSort('(select 1)')).toThrow(ValidationError);
  });

  it('never builds an ORDER BY from the raw request value', () => {
    // The regression this allowlist exists for: `orderBy(\`t.${sortField}\`)`.
    expect(source).not.toContain('orderBy(`t.${mappedSortField}`');
    expect(source).toContain('resolveTicketListApiSort(sortField)');
  });

  it('breaks ties on ticket_id so pages stay stable', () => {
    expect(source).toContain("dataQuery.orderBy('t.ticket_id', 'desc')");
  });
});

describe('ticket list API field allowlist', () => {
  it('accepts latest_activity_at as a requested field', () => {
    expect(normalizeFields(['latest_activity_at'])).toEqual(['latest_activity_at']);
    expect(normalizeFields(['ticket_id', 'latest_activity_at'])).toEqual([
      'ticket_id',
      'latest_activity_at',
    ]);
  });

  it('leaves the mobile_list preset payload unchanged', () => {
    const expanded = normalizeFields(['mobile_list']);
    expect(expanded).not.toContain('latest_activity_at');
    expect(expanded).toEqual([
      'ticket_id',
      'ticket_number',
      'title',
      'status_id',
      'status_name',
      'status_is_closed',
      'priority_name',
      'assigned_to_name',
      'client_name',
      'contact_name',
      'updated_at',
      'entered_at',
      'closed_at',
      'tags',
      'master_ticket_id',
      'bundle_master_ticket_number',
      'bundle_child_count',
    ]);
  });

  it('still rejects an unknown field with a 400', () => {
    expect(() => normalizeFields(['last_activity'])).toThrow(ValidationError);
  });

  it('returns null when no fields are requested (full payload)', () => {
    expect(normalizeFields(undefined)).toBeNull();
    expect(normalizeFields([])).toBeNull();
  });
});
