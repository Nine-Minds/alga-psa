/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

describe('project quick add client creation wiring contract', () => {
  it('T023: ProjectQuickAdd keeps add-new client wired to QuickAddClient and auto-selects the result', () => {
    const source = read('./ProjectQuickAdd.tsx');

    expect(source).toContain('onAddNew={() => setIsQuickAddClientOpen(true)}');
    expect(source).toContain('open={isQuickAddClientOpen}');
    expect(source).toContain('setClientOptions((prevClients) => {');
    expect(source).toContain('setSelectedClientId(newClient.client_id);');
    expect(source).toContain('setSelectedContactId(null);');
  });
});
