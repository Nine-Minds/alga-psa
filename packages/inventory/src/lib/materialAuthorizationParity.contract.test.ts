/**
 * Source-contract tests (T007/T008 static half): the material mutation wrappers and the
 * inventory master-data actions must keep their permission gates, and every material
 * entry point must delegate to the canonical service (F048-F050). The behavioral halves
 * run in materials.test.ts against the real DB.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

describe('material action wrappers delegate to the canonical service with permission gates', () => {
  it('tickets wrapper gates on ticket:read/update and delegates', () => {
    const src = read('../../../tickets/src/actions/materialCatalogActions.ts');
    expect(src).toContain("hasPermission(user, 'ticket', 'read')");
    expect(src).toContain("hasPermission(user, 'ticket', 'update')");
    expect(src).toMatch(/addMaterial\(/);
    expect(src).toMatch(/deleteMaterial\(/);
    expect(src).not.toMatch(/trx\('ticket_materials'\)\s*\.insert/);
  });

  it('projects wrapper gates on project:read/update and delegates', () => {
    const src = read('../../../projects/src/actions/materialCatalogActions.ts');
    expect(src).toContain("hasPermission(user, 'project', 'read')");
    expect(src).toContain("hasPermission(user, 'project', 'update')");
    expect(src).toMatch(/addMaterial\(/);
    expect(src).toMatch(/deleteMaterial\(/);
    expect(src).not.toMatch(/trx\('project_materials'\)\s*\.insert/);
  });

  it('billing wrapper keeps billing:* gates and delegates', () => {
    const src = read('../../../billing/src/actions/materialActions.ts');
    expect(src).toContain("hasPermission(user, 'billing', 'create')");
    expect(src).toContain("hasPermission(user, 'billing', 'delete')");
    expect(src).toMatch(/addMaterial\(/);
    expect(src).not.toMatch(/recordStockConsumption/); // consumption belongs to the canonical layer now
  });

  it('REST API TicketService delegates to the canonical service (F051)', () => {
    const src = read('../../../../server/src/lib/api/services/TicketService.ts');
    expect(src).toMatch(/addMaterial\(/);
    expect(src).toContain('MaterialValidationError');
    expect(src).toContain('InsufficientStockError');
    expect(src).not.toMatch(/knex\('ticket_materials'\)\s*\.insert/);
  });
});

describe('inventory master-data actions keep their seeded permission gates (F053-F055)', () => {
  it.each([
    ['vendorActions.ts', 'vendor'],
    ['transferActions.ts', 'stock_transfer'],
    ['stockLocationActions.ts', 'stock_location'],
  ])('%s gates on %s', (file, resource) => {
    const src = read(`../actions/${file}`);
    expect(src).toContain(`hasPermission(user, '${resource}', action)`);
  });
});
