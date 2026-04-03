import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('contract line cadence_owner compatibility wiring', () => {
  it('T108: mapping actions, legacy mapping writes, and client-line edits keep client cadence defaults explicit', () => {
    const actionsSource = readFileSync(
      resolve(__dirname, '../src/actions/contractLineMappingActions.ts'),
      'utf8',
    );
    const modelSource = readFileSync(
      resolve(__dirname, '../src/models/contractLineMapping.ts'),
      'utf8',
    );
    const clientActionsSource = readFileSync(
      resolve(__dirname, '../../clients/src/actions/clientContractLineActions.ts'),
      'utf8',
    );

    expect(actionsSource).toContain('return normalizeLiveRecurringStorage(line);');
    expect(actionsSource).toContain('cadence_owner: contractRecurringStorage.cadence_owner,');
    expect(modelSource).toContain('return normalizeLiveRecurringStorage(line);');
    expect(modelSource).toContain("cadence_owner: recurringAuthoringPolicy.cadenceOwner,");
    expect(clientActionsSource).toContain(
      "const cadenceOwner = updates.cadence_owner ?? await getExistingCadenceOwner(trx, tenant, clientContractLineId);",
    );
    expect(clientActionsSource).toContain(
      "updateData.cadence_owner =\n        updates.cadence_owner ?? await getExistingCadenceOwner(trx, tenant, clientContractLineId);",
    );
  });
});
