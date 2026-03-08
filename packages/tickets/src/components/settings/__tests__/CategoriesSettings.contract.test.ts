/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('categories settings quick-add refactor contract', () => {
  it('T035: CategoriesSettings uses QuickAddCategory for the add dialog', () => {
    const source = read('../CategoriesSettings.tsx');

    expect(source).toContain("import QuickAddCategory from '../QuickAddCategory';");
    expect(source).toContain('<QuickAddCategory');
    expect(source).toContain('isOpen={showAddEditDialog && !editingCategory}');
  });
});
