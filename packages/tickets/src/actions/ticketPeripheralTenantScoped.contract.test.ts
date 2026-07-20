// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (relativePath: string) => readFileSync(resolve(__dirname, relativePath), 'utf8');

const boardActions = source('board-actions/boardActions.ts');
const exportActions = source('ticketExportActions.ts');
const formActions = source('ticketFormActions.ts');
const importActions = source('ticketImportActions.ts');
const boardStatsStart = boardActions.indexOf('export const getBoardListStats');
const boardStatsEnd = boardActions.indexOf('\nexport const createBoard', boardStatsStart);
const boardStatsSource = boardActions.slice(boardStatsStart, boardStatsEnd);
const boardActionsWithoutStats = `${boardActions.slice(0, boardStatsStart)}${boardActions.slice(boardStatsEnd)}`;

const tenantOwnedRoots = [
  'boards',
  'users',
  'teams',
  'priorities',
  'clients',
  'contacts',
  'statuses',
  'categories',
  'tickets',
  'inbound_ticket_defaults',
  'status_sla_pause_config',
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expectNoDirectTenantRoots(sourceText: string): void {
  for (const table of tenantOwnedRoots) {
    const rootPattern = new RegExp(
      `\\b(?:trx|db|boardTrx)\\s*(?:<[^>]+>)?\\(\\s*['"]${escapeRegExp(table)}(?:\\s+as\\s+\\w+)?['"]\\s*\\)(?!\\s*\\.columnInfo\\(\\))`
    );
    expect(sourceText).not.toMatch(rootPattern);
  }
}

describe('ticket peripheral action tenant-scoped query contract', () => {
  it('routes tenant-owned roots through tenantDb in the owned peripheral action files', () => {
    expect(boardActions).toContain("tenantDb(trx, tenant).table<IBoard>('boards')");
    expect(boardActions).toContain("tenantScopedTable('status_sla_pause_config')");
    expect(exportActions).toContain('const tenantScopedDb = tenantDb(db, tenant)');
    expect(formActions).toContain('tenantDb(trx, tenant).table<Row>(table)');
    expect(importActions).toContain("tenantScopedTable('boards')");
    expect(importActions).toContain("tenantScopedTable('contacts')");
  });

  it('does not leave direct query roots for tenant-owned peripheral tables', () => {
    expectNoDirectTenantRoots(boardActionsWithoutStats);
    expectNoDirectTenantRoots(exportActions);
    expectNoDirectTenantRoots(formActions);
    expectNoDirectTenantRoots(importActions);
  });

  it('keeps aggregate board statistics explicitly tenant-scoped and tenant-joins statuses', () => {
    expect(boardStatsSource).toContain(".where('t.tenant', tenant)");
    expect(boardStatsSource).toContain(".andOn('t.tenant', 's.tenant')");
    expect(boardStatsSource).toContain(".where({ tenant, status_type: 'ticket' })");
    expect(boardStatsSource.match(/\.where\(\{ tenant \}\)/g)).toHaveLength(2);
  });

  it('keeps board schema/reference access outside the tenant facade', () => {
    expect(boardActions).toContain("tenantDb(trx, tenant).table('standard_statuses')");
    expect(boardActions.match(/tenantDb\(trx, tenant\)\.table\('statuses'\)\.columnInfo\(\)/g)).toHaveLength(2);
  });
});
