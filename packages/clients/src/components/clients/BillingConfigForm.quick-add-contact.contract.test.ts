/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('billing config contact creation wiring contract', () => {
  it('T015: BillingConfigForm keeps add-new contact wired to QuickAddContact', () => {
    const source = read('./BillingConfigForm.tsx');

    expect(source).toContain('onAddNew={() => setIsQuickAddContactOpen(true)}');
    expect(source).toContain('isOpen={isQuickAddContactOpen}');
    expect(source).toContain('selectedClientId={clientId}');
    expect(source).toContain("handleSelectChange('billing_contact_id')(newContact.contact_name_id);");
    expect(source).toContain("handleSelectChange('billing_email')('');");
  });
});
