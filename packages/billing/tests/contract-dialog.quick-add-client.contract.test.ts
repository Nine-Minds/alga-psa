/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(): string {
  return fs.readFileSync(
    path.resolve(__dirname, '../src/components/billing-dashboard/contracts/ContractDialog.tsx'),
    'utf8',
  );
}

describe('contract dialog client creation wiring contract', () => {
  it('opens quick-add, upserts and selects its client, and clears submitted errors', () => {
    const source = readSource();

    expect(source).toContain('onAddNew={() => setIsQuickAddClientOpen(true)}');
    expect(source).toContain('open: isQuickAddClientOpen,');
    expect(source).toContain('onOpenChange: setIsQuickAddClientOpen,');
    expect(source).toContain('skipSuccessDialog: true,');
    expect(source).toContain(
      '(client) => client.client_id === newClient.client_id,',
    );
    expect(source).toContain('nextClients[existingIndex] = newClient;');
    expect(source).toContain('setClientId(newClient.client_id);');
    expect(source).toContain(`setClientId(newClient.client_id);
          clearErrorIfSubmitted();`);
  });
});
