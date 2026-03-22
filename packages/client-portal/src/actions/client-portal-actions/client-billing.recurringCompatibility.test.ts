import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('client portal contract-line recurrence compatibility wiring', () => {
  it('normalizes partially migrated recurring fields in the client portal contract-line reader', () => {
    const source = readFileSync(resolve(__dirname, './client-billing.ts'), 'utf8');

    expect(source).toContain("import { normalizeLiveRecurringStorage } from '@alga-psa/shared/billingClients/recurrenceStorageModel';");
    expect(source).toContain('return plan ? normalizeLiveRecurringStorage(plan) : null;');
  });
});
