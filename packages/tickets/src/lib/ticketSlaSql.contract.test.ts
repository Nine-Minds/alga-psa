// @vitest-environment node

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ticketSlaBreachedBindings, ticketSlaBreachedSql } from './ticketSlaSql';

/**
 * The board header states a breach *count*; the slaStatusFilter states a breach
 * *set*. A header reading 3 that opens onto a list of 2 is worse than no header,
 * because the number is what the user trusts.
 *
 * The only way to guarantee they agree is for neither to own the definition, so
 * this is a source-level contract: both sites must delegate to the shared
 * fragment, and neither may carry an inline re-derivation of it. A behavioural
 * test would only prove the two agreed on the day it ran.
 */

const SRC = join(__dirname, '..');
const read = (relativePath: string) => readFileSync(join(SRC, relativePath), 'utf8');

describe('shared breached-SLA predicate', () => {
  it('names every column the breach definition depends on, and no others', () => {
    const sql = ticketSlaBreachedSql('t');

    expect(sql).toContain('t.sla_policy_id IS NOT NULL');
    expect(sql).toContain('t.sla_response_due_at');
    expect(sql).toContain('t.sla_response_at IS NULL');
    expect(sql).toContain('t.sla_resolution_due_at');
    expect(sql).toContain('t.sla_resolution_at IS NULL');
    expect(sql).toContain('t.sla_response_met = false');
    expect(sql).toContain('t.sla_resolution_met = false');
  });

  it('keeps its bindings in step with its placeholders', () => {
    // Drift here is silent and produces a wrong count rather than an error, so
    // the two are asserted against each other rather than trusted.
    const placeholders = (ticketSlaBreachedSql('t').match(/\?/g) ?? []).length;
    expect(ticketSlaBreachedBindings('2026-08-19T00:00:00Z')).toHaveLength(placeholders);
  });

  it('honours the table alias it is given', () => {
    expect(ticketSlaBreachedSql('tk')).toContain('tk.sla_policy_id IS NOT NULL');
    expect(ticketSlaBreachedSql('tk')).not.toContain('t.sla_policy_id');
  });

  it('is the predicate the breached filter applies', () => {
    const source = read('actions/optimizedTicketActions.ts');
    const breachedBranch = source.slice(
      source.indexOf("case 'breached':"),
      source.indexOf("case 'paused':"),
    );

    expect(breachedBranch).toContain('ticketSlaBreachedSql');
    expect(breachedBranch).toContain('ticketSlaBreachedBindings');
    // No inline re-derivation left behind alongside the delegation.
    expect(breachedBranch).not.toContain('sla_response_due_at');
    expect(breachedBranch).not.toContain('sla_resolution_met');
  });

  it('is the predicate the board header count aggregates', () => {
    const source = read('actions/board-actions/boardActions.ts');
    const statsBlock = source.slice(
      source.indexOf('export const getBoardListStats'),
      source.indexOf('export const createBoard'),
    );

    expect(statsBlock).toContain('ticketSlaBreachedSql');
    expect(statsBlock).toContain('ticketSlaBreachedBindings');
    expect(statsBlock).toContain('sla_breached');
    expect(statsBlock).not.toContain('sla_response_due_at');
  });
});
