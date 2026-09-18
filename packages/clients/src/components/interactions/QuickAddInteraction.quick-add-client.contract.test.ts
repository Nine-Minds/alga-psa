/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(): string {
  return fs.readFileSync(path.resolve(__dirname, './QuickAddInteraction.tsx'), 'utf8');
}

describe('quick add interaction client creation wiring contract', () => {
  it('routes picked and created clients through contact-resetting selection', () => {
    const source = readSource();

    expect(source).toContain('onSelect={handleClientSelect}');
    expect(source).toContain('onAddNew={() => setIsQuickAddClientOpen(true)}');
    expect(source).toContain('if (nextClientId !== selectedClientId) {');
    expect(source).toContain("setSelectedContactId('');");
    expect(source).toContain('open={isQuickAddClientOpen}');
    expect(source).toContain('onOpenChange={setIsQuickAddClientOpen}');
    expect(source).toContain(
      '(client) => client.client_id === newClient.client_id,',
    );
    expect(source).toContain('nextClients[existingIndex] = newClient;');
    expect(source).toContain('handleClientSelect(newClient.client_id);');
    expect(source).toContain('skipSuccessDialog');
  });

  it('supports standalone creation with client and contact selection', () => {
    const source = readSource();

    expect(source).toContain('entityId?: string;');
    expect(source).toContain('const isStandaloneCreate = !isEditMode && !entityId;');
    expect(source).toContain('if (isEditMode || isStandaloneCreate) {');
    expect(source).toContain('{isStandaloneCreate && (');
    expect(source).toContain('if (isStandaloneCreate && !selectedClientId) {');
    expect(source).toContain('interactionData.client_id = selectedClientId');
  });
});
