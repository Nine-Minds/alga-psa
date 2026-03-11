/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('quick add asset client creation wiring contract', () => {
  it('T026: QuickAddAsset keeps add-new client wired to QuickAddClient and auto-selects it', () => {
    const source = read('./QuickAddAsset.tsx');

    expect(source).toContain('onAddNew={() => setIsQuickAddClientOpen(true)}');
    expect(source).toContain('open={isQuickAddClientOpen}');
    expect(source).toContain('setClients((prevClients) => {');
    expect(source).toContain('setSelectedClientId(newClient.client_id);');
    expect(source).toContain('clearErrorIfSubmitted();');
  });
});
