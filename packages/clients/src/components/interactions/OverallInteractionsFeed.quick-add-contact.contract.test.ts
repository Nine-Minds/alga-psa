/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('overall interactions feed contact creation wiring contract', () => {
  it('T011: OverallInteractionsFeed keeps add-new contact wired to QuickAddContact', () => {
    const source = read('./OverallInteractionsFeed.tsx');

    expect(source).toContain('onAddNew={() => setIsQuickAddContactOpen(true)}');
    expect(source).toContain('isOpen={isQuickAddContactOpen}');
    expect(source).toContain('selectedClientId={selectedClientValue ?? undefined}');
    expect(source).toContain('setSelectedContact(newContact.contact_name_id);');
  });
});
