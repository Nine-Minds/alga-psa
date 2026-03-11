/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('ticketing dashboard category creation wiring contract', () => {
  it('T044: TicketingDashboard keeps add-new category wired to QuickAddCategory', () => {
    const source = read('./TicketingDashboard.tsx');

    expect(source).toContain('onAddNew={() => setIsQuickAddCategoryOpen(true)}');
    expect(source).toContain('isOpen={isQuickAddCategoryOpen}');
    expect(source).toContain('preselectedBoardId={selectedBoard || undefined}');
    expect(source).toContain('setSelectedCategories([newCategory.category_id]);');
  });
});
