import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('template_contract_id provenance type contracts', () => {
  it('T015: shared interfaces document template_contract_id as provenance-only metadata', () => {
    const billingInterfaces = readFileSync(
      resolve(process.cwd(), '../packages/types/src/interfaces/billing.interfaces.ts'),
      'utf8',
    );
    const contractInterfaces = readFileSync(
      resolve(process.cwd(), '../packages/types/src/interfaces/contract.interfaces.ts'),
      'utf8',
    );

    expect(billingInterfaces).toContain('Provenance-only metadata from the source template assignment.');
    expect(billingInterfaces).toContain('template_contract_id?: string | null;');

    expect(contractInterfaces).toContain('Provenance-only metadata for template origin; not a runtime identity key.');
    expect(contractInterfaces.match(/template_contract_id\?: string \| null;/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
