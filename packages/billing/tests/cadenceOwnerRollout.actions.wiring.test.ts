import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const contractLineActionSource = readFileSync(
  new URL('../src/actions/contractLineAction.ts', import.meta.url),
  'utf8',
);
const contractLinePresetActionsSource = readFileSync(
  new URL('../src/actions/contractLinePresetActions.ts', import.meta.url),
  'utf8',
);
const contractWizardActionsSource = readFileSync(
  new URL('../src/actions/contractWizardActions.ts', import.meta.url),
  'utf8',
);

describe('cadence owner rollout action wiring', () => {
  it('guards live contract-line and wizard write paths with the shared rollout validator', () => {
    expect(contractLineActionSource).toContain(
      "import { assertSupportedCadenceOwnerDuringRollout } from '@shared/billingClients/cadenceOwnerRollout';",
    );
    expect(contractLineActionSource.match(/assertSupportedCadenceOwnerDuringRollout\(/g)?.length).toBeGreaterThanOrEqual(2);

    expect(contractLinePresetActionsSource).toContain(
      "import { assertSupportedCadenceOwnerDuringRollout } from '@shared/billingClients/cadenceOwnerRollout';",
    );
    expect(contractLinePresetActionsSource.match(/assertSupportedCadenceOwnerDuringRollout\(/g)?.length).toBeGreaterThanOrEqual(4);

    expect(contractWizardActionsSource).toContain(
      "import { assertSupportedCadenceOwnerDuringRollout } from '@shared/billingClients/cadenceOwnerRollout';",
    );
    expect(contractWizardActionsSource.match(/assertSupportedCadenceOwnerDuringRollout\(/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
