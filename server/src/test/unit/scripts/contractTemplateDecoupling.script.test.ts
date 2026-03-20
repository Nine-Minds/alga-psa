import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('contract-template-decoupling script normalization', () => {
  it('T014: script is audit-only and does not backfill template provenance or preserve fallback clone semantics', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'scripts/contract-template-decoupling.ts'),
      'utf8',
    );

    expect(source).toContain('audit-only');
    expect(source).not.toMatch(/template_contract_id\s*=\s*contract\.contract_id/);
    expect(source).not.toMatch(/template_contract_id\s*\?\?\s*.*contract_id/);
    expect(source).not.toContain('cloneTemplateContractLine');
    expect(source).not.toContain(".update({\n          template_contract_id");
  });
});
