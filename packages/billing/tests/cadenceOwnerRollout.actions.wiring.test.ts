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
const contractLineServiceSource = readFileSync(
  new URL('../../../server/src/lib/api/services/ContractLineService.ts', import.meta.url),
  'utf8',
);
const contractLineSchemasSource = readFileSync(
  new URL('../../../server/src/lib/api/schemas/contractLineSchemas.ts', import.meta.url),
  'utf8',
);
const financialSchemasSource = readFileSync(
  new URL('../../../server/src/lib/api/schemas/financialSchemas.ts', import.meta.url),
  'utf8',
);
const serverContractLineRepositorySource = readFileSync(
  new URL('../../../server/src/lib/repositories/contractLineRepository.ts', import.meta.url),
  'utf8',
);
const recurringAuthoringPolicySource = readFileSync(
  new URL('../../../shared/billingClients/recurringAuthoringPolicy.ts', import.meta.url),
  'utf8',
);

describe('cadence owner rollout action wiring', () => {
  it('T063: removes the dead rollout validator from authoring write paths and shared schemas', () => {
    expect(contractLineActionSource).not.toContain('assertSupportedCadenceOwnerDuringRollout');
    expect(contractLinePresetActionsSource).not.toContain('assertSupportedCadenceOwnerDuringRollout');
    expect(contractWizardActionsSource).not.toContain('assertSupportedCadenceOwnerDuringRollout');
    expect(contractLineServiceSource).not.toContain('assertSupportedCadenceOwnerDuringRollout');
    expect(contractLineSchemasSource).not.toContain('getCadenceOwnerRolloutValidationMessage');
    expect(financialSchemasSource).not.toContain('getCadenceOwnerRolloutValidationMessage');
  });

  it('keeps cadence defaults explicit at write boundaries instead of hiding them in the shared authoring policy', () => {
    expect(recurringAuthoringPolicySource).toContain('defaultCadenceOwner?: CadenceOwner | null;');
    expect(recurringAuthoringPolicySource).not.toContain(
      'input.cadenceOwner ?? input.fallbackCadenceOwner ?? DEFAULT_RECURRING_AUTHORING_CADENCE_OWNER',
    );
    expect(contractLineActionSource).toContain('defaultCadenceOwner: DEFAULT_RECURRING_AUTHORING_CADENCE_OWNER');
    expect(contractLinePresetActionsSource).toContain('safePresetData.cadence_owner = safePresetData.cadence_owner ?? DEFAULT_RECURRING_AUTHORING_CADENCE_OWNER;');
    expect(contractWizardActionsSource).toContain('defaultCadenceOwner: DEFAULT_RECURRING_AUTHORING_CADENCE_OWNER');
    expect(serverContractLineRepositorySource).toContain(
      'fallbackCadenceOwner: existingTemplateLine?.cadence_owner ?? DEFAULT_RECURRING_AUTHORING_CADENCE_OWNER',
    );
    expect(serverContractLineRepositorySource).toContain(
      'fallbackCadenceOwner: existingLine?.cadence_owner ?? DEFAULT_RECURRING_AUTHORING_CADENCE_OWNER',
    );
  });
});
