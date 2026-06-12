/* @vitest-environment node */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../../../..');

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

const createDialogs = [
  'packages/tickets/src/components/QuickAddTicket.tsx',
  'packages/clients/src/components/clients/QuickAddClient.tsx',
  'packages/clients/src/components/contacts/QuickAddContact.tsx',
  'packages/clients/src/components/interactions/QuickAddInteraction.tsx',
  'packages/projects/src/components/ProjectQuickAdd.tsx',
  'packages/assets/src/components/QuickAddAsset.tsx',
];

describe('create dialog a11y source wiring', () => {
  it('keeps create dialogs on the shared focus-trapped Dialog path', () => {
    for (const path of createDialogs) {
      const source = read(path);
      expect(source, path).toContain('<Dialog');
      expect(source, path).not.toContain('disableFocusTrap');
    }
  });

  it('keeps create dialogs form-backed for keyboard submit', () => {
    for (const path of createDialogs) {
      expect(read(path), path).toContain('<form');
    }
  });
});
