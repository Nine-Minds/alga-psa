/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(): string {
  return fs.readFileSync(path.resolve(__dirname, './ApplyTemplateDialog.tsx'), 'utf8');
}

describe('apply template client creation wiring contract', () => {
  it('opens quick-add, upserts the client, and selects it in form data', () => {
    const source = readSource();

    expect(source).toContain('onAddNew={() => setIsQuickAddClientOpen(true)}');
    expect(source).toContain('open: isQuickAddClientOpen,');
    expect(source).toContain('onOpenChange: setIsQuickAddClientOpen,');
    expect(source).toContain(
      '(client) => client.client_id === newClient.client_id,',
    );
    expect(source).toContain('nextClients[existingIndex] = newClient;');
    expect(source).toContain(
      'setFormData((current) => ({ ...current, client_id: newClient.client_id }));',
    );
    expect(source).toContain('skipSuccessDialog: true,');
  });
});
