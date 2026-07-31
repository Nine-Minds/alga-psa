/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('client details default-contact creation wiring contract', () => {
  it('T014: ClientDetails keeps add-new contact wired to the current client context', () => {
    // ClientDetails composes the details tab through ClientDetailsTabContent,
    // handing down the editable client and the default-contact handler.
    const clientDetails = read('./ClientDetails.tsx');
    expect(clientDetails).toContain('editedClient={editedClient}');
    expect(clientDetails).toContain('onDefaultContactChange={handleDefaultContactChange}');

    // The add-new contact dialog wiring now lives in the tab content child, but
    // stays bound to the current client and feeds the default-contact selection.
    const tabContent = read('./ClientDetailsTabContent.tsx');
    expect(tabContent).toContain('onAddNew={() => setIsQuickAddContactOpen(true)}');
    expect(tabContent).toContain('isOpen={isQuickAddContactOpen}');
    expect(tabContent).toContain('selectedClientId={editedClient.client_id}');
    expect(tabContent).toContain('onDefaultContactChange(newContact.contact_name_id);');
  });
});
