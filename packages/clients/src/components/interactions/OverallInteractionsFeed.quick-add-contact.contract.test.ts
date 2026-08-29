/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('overall interactions feed contact creation wiring contract', () => {
  it('T011: the expandable filters keep add-new contact wired to QuickAddContact', () => {
    const source = read('./OverallInteractionsFeed.tsx');

    expect(source).toContain('onAddNew={() => setIsQuickAddContactOpen(true)}');
    expect(source).toContain('isOpen={isQuickAddContactOpen}');
    expect(source).toContain("selectedClientId={selectedClient === 'all' ? undefined : selectedClient}");
    expect(source).toContain('setSelectedContact(newContact.contact_name_id);');
  });

  it('T012: the standalone feed uses DataTable pagination and collapsed filters', () => {
    const source = read('./OverallInteractionsFeed.tsx');

    expect(source).toContain('getInteractionsPage({');
    expect(source).toContain('id="overall-interactions-toggle-filters"');
    expect(source).toContain('id="overall-interactions-expanded-filters"');
    expect(source).toContain('id="overall-interactions-table"');
    expect(source).toContain('pagination');
    expect(source).toContain('totalItems={total}');
    expect(source).not.toContain('max-h-[calc(100vh-300px)]');
  });
});
