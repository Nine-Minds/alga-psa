import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('contract line mapping recurring timing audit', () => {
  it('T331: mapping helpers keep cadence_owner explicit and do not infer recurring timing from legacy fixed-config flags', () => {
    const actionsSource = readFileSync(
      resolve(__dirname, '../src/actions/contractLineMappingActions.ts'),
      'utf8',
    );
    const modelSource = readFileSync(
      resolve(__dirname, '../src/models/contractLineMapping.ts'),
      'utf8',
    );

    expect(actionsSource).toContain('cadence_owner: resolveCadenceOwner(line.cadence_owner),');
    expect(actionsSource.match(/cadence_owner: 'client'/g)?.length).toBeGreaterThanOrEqual(2);
    expect(modelSource).toContain('cadence_owner: resolveCadenceOwner(line.cadence_owner),');
    expect(modelSource).toContain("cadence_owner: contractLine.cadence_owner ?? 'client',");

    const mappingAndDisambiguationSource =
      actionsSource.split('/**\n * Retrieve all contract line mappings')[1] ?? actionsSource;

    expect(mappingAndDisambiguationSource).not.toContain('billing_cycle_alignment');
    expect(mappingAndDisambiguationSource).not.toContain('enable_proration');
    expect(modelSource).not.toContain('billing_cycle_alignment');
    expect(modelSource).not.toContain('enable_proration');
  });
});
