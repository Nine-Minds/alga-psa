/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('tree select add-new contract', () => {
  it('T038: TreeSelect renders the add-new button and separator when onAddNew is provided', () => {
    const source = read('./TreeSelect.tsx');

    expect(source).toContain('{onAddNew && (');
    expect(source).toContain('border-t border-gray-200');
    expect(source).toContain('<Plus className="h-4 w-4" />');
    expect(source).toContain('<span>{addNewLabel}</span>');
  });

  it('T039: TreeSelect guards the add-new UI behind the optional onAddNew prop', () => {
    const source = read('./TreeSelect.tsx');

    expect(source).toContain('onAddNew?: () => void;');
    expect(source).toContain('{onAddNew && (');
    expect(source).toContain("addNewLabel = '+ Add new'");
  });
});
