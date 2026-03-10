/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('quick add interaction contact creation wiring contract', () => {
  it('T010: QuickAddInteraction wires ContactPicker add-new to QuickAddContact with the selected client id', () => {
    const source = read('./QuickAddInteraction.tsx');

    expect(source).toContain('onAddNew={selectedClientId ? () => setIsQuickAddContactOpen(true) : undefined}');
    expect(source).toContain('isOpen={isQuickAddContactOpen}');
    expect(source).toContain('selectedClientId={selectedClientId}');
  });
});
