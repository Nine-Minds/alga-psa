import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('contact interface parity', () => {
  const sharedInterface = readRepoFile('shared/interfaces/contact.interfaces.ts');
  const typesInterface = readRepoFile('packages/types/src/interfaces/contact.interfaces.ts');

  it('T007: shares canonical email labels and additional email row types across packages', () => {
    expect(sharedInterface).toContain("CONTACT_EMAIL_CANONICAL_TYPES = ['work', 'personal', 'billing', 'other']");
    expect(typesInterface).toContain("CONTACT_EMAIL_CANONICAL_TYPES = ['work', 'personal', 'billing', 'other']");
    expect(sharedInterface).toContain('IContactEmailAddress');
    expect(typesInterface).toContain('IContactEmailAddress');
    expect(sharedInterface).toContain('ContactEmailAddressInput');
    expect(typesInterface).toContain('ContactEmailAddressInput');
    expect(sharedInterface).toContain('additional_email_addresses');
    expect(typesInterface).toContain('additional_email_addresses');
    expect(sharedInterface).toContain('primary_email_canonical_type');
    expect(typesInterface).toContain('primary_email_canonical_type');
    expect(sharedInterface).toContain('primary_email_custom_type');
    expect(typesInterface).toContain('primary_email_custom_type');
  });
});
