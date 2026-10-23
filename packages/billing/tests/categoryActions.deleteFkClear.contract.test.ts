// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const categoryActions = readRepoFile('packages/billing/src/actions/categoryActions.ts');
const migration = readRepoFile(
  'server/migrations/20260329150000_create_service_request_domain_tables.cjs'
);

// Scope the assertions to the delete action so unrelated helpers can't satisfy
// them accidentally.
const deleteAction = categoryActions.slice(
  categoryActions.indexOf('export const deleteServiceCategory'),
  categoryActions.indexOf('// Removed getTicketCategoriesByBoard')
);

describe('categoryActions.deleteServiceCategory FK-clear contract', () => {
  it('clears the RESTRICTing service_request_definitions reference before deleting the category', () => {
    // The FK in the migration is ON DELETE RESTRICT, so the in-use guard in the
    // comments of the deleted serviceCategoryActions module was wrong.
    expect(migration).toContain(".inTable('service_categories').onDelete('RESTRICT')");

    expect(deleteAction).toContain("'service_request_definitions'");
    expect(deleteAction).toContain('category_id: null, category_name_snapshot: null');
  });

  it('clears the reference before the service_categories row is deleted', () => {
    const clearIndex = deleteAction.indexOf("'service_request_definitions'");
    const deleteIndex = deleteAction.indexOf("'service_categories'", clearIndex);

    expect(clearIndex).toBeGreaterThan(-1);
    expect(deleteIndex).toBeGreaterThan(clearIndex);
  });

  it('keeps the products-only in-use guard and the void return signature', () => {
    expect(deleteAction).toContain("'service_catalog'");
    expect(deleteAction).toContain('Promise<void | ServiceCategoryActionError>');
  });

  it('does not query ticket categories as part of the delete', () => {
    // The old module checked tickets.category_id, but ticket categories live in
    // the `categories` table, not `service_categories`; porting it would block
    // legitimate deletes on a meaningless join.
    expect(deleteAction).not.toContain("'tickets'");
  });

  it('leaves the historical service_request_definition_versions snapshot alone', () => {
    expect(deleteAction).not.toContain("'service_request_definition_versions'");
  });
});

describe('single service-category delete code path', () => {
  it('removes the duplicate serviceCategoryActions module', () => {
    const duplicatePath = path.join(
      repoRoot,
      'packages/billing/src/actions/serviceCategoryActions.ts'
    );
    expect(fs.existsSync(duplicatePath)).toBe(false);
  });

  it('has no remaining importers of serviceCategoryActions', () => {
    const dirs = ['packages', 'server/src'];
    const skipped = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage']);
    const selfPath = path.relative(repoRoot, __filename);
    const offenders: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (skipped.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        const relative = path.relative(repoRoot, full);
        if (relative === selfPath) continue;
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
          if (fs.readFileSync(full, 'utf8').includes('serviceCategoryActions')) {
            offenders.push(relative);
          }
        }
      }
    };

    for (const dir of dirs) {
      walk(path.join(repoRoot, dir));
    }

    expect(offenders).toEqual([]);
  });
});
