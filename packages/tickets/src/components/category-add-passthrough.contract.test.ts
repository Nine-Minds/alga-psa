/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('category picker add-new passthrough contract', () => {
  it('T040: CategoryPicker passes onAddNew through to TreeSelect', () => {
    const source = read('./CategoryPicker.tsx');

    expect(source).toContain('onAddNew?: () => void;');
    expect(source).toContain('onAddNew={onAddNew}');
    // Label is now i18n-backed; TreeSelect renders the leading "+" as a <Plus/> icon.
    expect(source).toContain("addNewLabel={t('categoryPicker.addNew', 'Add new category')}");
  });
});
