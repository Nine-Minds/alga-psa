/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('quick add ticket category creation wiring contract', () => {
  it('T042: QuickAddTicket merges a created category into local state and auto-selects it', () => {
    const source = read('./QuickAddTicket.tsx');

    expect(source).toContain('setCategories((prevCategories) => {');
    expect(source).toContain('setSelectedCategories([newCategory.category_id]);');
    expect(source).toContain('clearErrorIfSubmitted();');
    expect(source).toContain('setIsQuickAddCategoryOpen(false);');
  });
});
