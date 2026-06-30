import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, '../../../lib/api/services/TicketService.ts');
const source = readFileSync(servicePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('ticket service stats tenant-scoped query contract', () => {
  it('uses structural tenant scoping for ticket aggregate roots', () => {
    const statsSection = sectionBetween('async getTicketStats', '  /**\n   * Apply ticket-specific filters');

    expect(statsSection.match(/tenantScopedTable\(knex, 'tickets as t', context\.tenant\)/g)).toHaveLength(5);
    expect(statsSection).toContain("tenantScopedTable(knex, 'tickets', context.tenant)");
    expect(statsSection).not.toContain(".where('t.tenant', context.tenant)");
    expect(statsSection).not.toContain(".where('tenant', context.tenant)");
  });
});
