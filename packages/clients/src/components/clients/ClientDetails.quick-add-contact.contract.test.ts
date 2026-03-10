/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('client details default-contact creation wiring contract', () => {
  it('T014: ClientDetails keeps add-new contact wired to the current client context', () => {
    const source = read('./ClientDetails.tsx');

    expect(source).toContain('onAddNew={() => setIsQuickAddContactOpen(true)}');
    expect(source).toContain('isOpen={isQuickAddContactOpen}');
    expect(source).toContain('selectedClientId={editedClient.client_id}');
    expect(source).toContain('handleDefaultContactChange(newContact.contact_name_id);');
  });
});
