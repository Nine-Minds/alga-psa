import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const sourcePath = path.resolve(
  __dirname,
  '../../../../../packages/clients/src/components/contacts/ContactDetails.tsx',
);

describe('ContactDetails AlgaDesk product mode contract', () => {
  it('hides documents tab when isAlgaDeskMode is enabled', () => {
    const source = readFileSync(sourcePath, 'utf8');

    expect(source).toContain('isAlgaDeskMode?: boolean;');
    expect(source).toContain('isAlgaDeskMode = false');
    expect(source).toContain("baseTabContent.filter((tab) => tab.id !== 'documents')");
  });
});
