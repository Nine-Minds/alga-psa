/* @vitest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readEeQueueSource(): string {
  return fs.readFileSync(
    path.resolve(__dirname, '../../../../../ee/server/src/components/settings/integrations/EntraReconciliationQueue.tsx'),
    'utf8'
  );
}

describe('entra reconciliation queue contact creation wiring contract', () => {
  it('T017: EntraReconciliationQueue keeps add-new contact wired to QuickAddContact', () => {
    const source = readEeQueueSource();

    expect(source).toContain('onAddNew={() => setQuickAddItem(item)}');
    expect(source).toContain('isOpen={quickAddItem !== null}');
    expect(source).toContain('selectedClientId={quickAddItem?.clientId || null}');
    expect(source).toContain('[quickAddItem.queueItemId]: newContact.contact_name_id,');
  });
});
