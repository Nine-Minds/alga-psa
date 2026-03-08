/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('projects contact filter creation wiring contract', () => {
  it('T013: Projects keeps the contact filter add-new action wired to QuickAddContact', () => {
    const source = read('./Projects.tsx');

    expect(source).toContain('onAddNew={() => setIsQuickAddContactOpen(true)}');
    expect(source).toContain('isOpen={isQuickAddContactOpen}');
    expect(source).toContain('selectedClientId={filterClientId || undefined}');
    expect(source).toContain('setFilterContactId(newContact.contact_name_id);');
  });
});
