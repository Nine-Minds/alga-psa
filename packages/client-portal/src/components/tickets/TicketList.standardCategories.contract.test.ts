/* @vitest-environment node */

/**
 * T109 — F057 of `ee/plans/2026-11-21-itil-remediation` (`category-filters`).
 *
 * The portal ticket filter lists every category of the tenant, so after D9 it would show one entry
 * per ITIL board's copy of each standard category. It goes through the same shared helper as the
 * MSP list, which is what this asserts: the behaviour of the helper itself is covered by
 * `server/src/test/integration/itilCategoryFilters.integration.test.ts` (T107).
 *
 * Switched from the `dedupeStandardCategoriesForFilter` wrapper to `standardCategoryFilterOptions`
 * directly (same helper, same de-duplication) so the screen also keeps the alias map: a ticket's
 * own `category_id`/`subcategory_id` can name a board's copy the de-duplicated list no longer
 * carries, and `formatCategoryLabel` needs the alias to resolve it instead of reporting it unknown
 * (the list/detail mismatch a browser check found on a second ITIL board).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { standardCategoryFilterOptions } from '@alga-psa/shared/lib/tickets/standardCategoryFilterOptions';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('client portal ticket filter categories', () => {
  it('T109: the portal filter de-duplicates standard categories through the shared helper', () => {
    const source = read('./TicketList.tsx');
    expect(source).toContain(
      "import { standardCategoryFilterOptions } from '@alga-psa/shared/lib/tickets/standardCategoryFilterOptions';"
    );
    expect(source).toContain('standardCategoryFilterOptions(categories)');
    expect(source).toContain('setCategories(dedupedCategories.categories)');
    expect(source).toContain('setCategoryAliases(dedupedCategories.aliases)');
  });

  it('T109: the row label resolves a ticket\'s own category through the alias map', () => {
    const source = read('./TicketList.tsx');
    expect(source).toContain('formatCategoryLabel(record, categories, categoryAliases)');
  });

  it('T109: one entry per standard category, every own category kept', () => {
    const rows = [
      { category_id: 'a1', board_id: 'b1', parent_category: null, standard_category_id: 's1' },
      { category_id: 'a2', board_id: 'b2', parent_category: null, standard_category_id: 's1' },
      { category_id: 'c1', board_id: 'b1', parent_category: 'a1', standard_category_id: 's2' },
      { category_id: 'c2', board_id: 'b2', parent_category: 'a2', standard_category_id: 's2' },
      { category_id: 'own', board_id: 'b3', parent_category: null, standard_category_id: null },
    ];

    const { categories: kept, aliases } = standardCategoryFilterOptions(rows);
    expect(kept.map((row) => row.category_id)).toEqual(['a1', 'c1', 'own']);
    expect(kept.find((row) => row.category_id === 'c1')!.parent_category).toBe('a1');
    expect(aliases).toEqual({ a2: 'a1', c2: 'c1' });
  });
});
