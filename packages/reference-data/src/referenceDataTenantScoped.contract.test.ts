import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('reference-data tenant-scoped query contract', () => {
  it('uses structural tenant scoping for priority model roots', () => {
    const source = readFileSync(resolve(__dirname, 'models/priority.ts'), 'utf8');
    expect(source).toContain("table: 'priorities'");
    expect(source).toContain('prioritiesQuery(knexOrTrx, tenant)');
    expect(source).not.toContain(".where({ tenant })");
    expect(source).not.toContain(".where({ priority_id: id, tenant })");
  });

  it('uses structural tenant scoping for board and priority action roots', () => {
    const boardSource = readFileSync(resolve(__dirname, 'actions/boardActions.ts'), 'utf8');
    const prioritySource = readFileSync(resolve(__dirname, 'actions/priorityActions.ts'), 'utf8');

    expect(boardSource).toContain("table: 'boards'");
    expect(prioritySource).toContain('tenantScopedTable(trx,');
    expect(prioritySource).toContain("tenantScopedTable(trx, 'boards', tenant)");
    expect(prioritySource).toContain("tenantScopedTable(trx, 'priorities', tenant)");

    expect(boardSource).not.toContain("trx('boards')");
    expect(prioritySource).not.toContain("trx('boards')");
    expect(prioritySource).not.toContain("trx('priorities')");
    expect(prioritySource).not.toContain(".where('tenant', tenant)");
  });

  it('uses structural tenant scoping for status action roots while leaving inserts direct', () => {
    const source = readFileSync(resolve(__dirname, 'actions/status-actions/statusActions.ts'), 'utf8');

    expect(source).toContain("table: 'statuses'");
    expect(source).toContain('statusesQuery(trx, tenant)');
    expect(source).toContain('statusesQuery(knex, tenant)');
    expect(source).toContain('statusesQuery(trx, tenantId)');

    expect(source).not.toContain("const existingStatus = await trx('statuses')");
    expect(source).not.toContain("const maxOrder = await trx('statuses')");
    expect(source).not.toContain("const existingDefault = await trx('statuses')");
    expect(source).not.toContain("await trx('statuses')");
    expect(source).not.toContain("trx<IStatus>('statuses')\n        .where");
    expect(source).not.toContain(".where('tenant', tenant)");
  });

  it('uses structural tenant scoping for selected reference-data import defaults', () => {
    const source = readFileSync(resolve(__dirname, 'actions/referenceDataActions.ts'), 'utf8');

    expect(source).toContain('tenantScopedTable(trx,');
    expect(source).toContain("tenantScopedTable(trx, 'statuses', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'boards', tenant)");
    expect(source).not.toContain(".where({ tenant, board_id: boardId, status_type: 'ticket' })");
    expect(source).not.toContain(".where({ tenant: tenant, is_default: true })");
  });
});
