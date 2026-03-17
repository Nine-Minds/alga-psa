import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('contract wizard cadence_owner wiring', () => {
  it('T106: client wizard actions thread cadence_owner through live-line writes and compatibility reads', () => {
    const source = readFileSync(
      resolve(__dirname, '../src/actions/contractWizardActions.ts'),
      'utf8'
    );

    expect(source.match(/cadence_owner: submission\.cadence_owner \?\? 'client'/g)?.length).toBe(4);
    expect(source).toContain("let cadenceOwner: CadenceOwner = 'client';");
    expect(source).toContain('cadenceOwner = line.cadence_owner ?? cadenceOwner;');
    expect(source).toContain('cadence_owner: cadenceOwner,');
  });

  it('threads cadence_owner through wizard defaults, template snapshots, and fixed-fee UI copy', () => {
    const wizardSource = readFileSync(
      resolve(__dirname, '../src/components/billing-dashboard/contracts/ContractWizard.tsx'),
      'utf8'
    );
    const fixedFeeStepSource = readFileSync(
      resolve(
        __dirname,
        '../src/components/billing-dashboard/contracts/wizard-steps/FixedFeeServicesStep.tsx'
      ),
      'utf8'
    );

    expect(wizardSource).toContain("cadence_owner: 'client'");
    expect(wizardSource).toContain('cadence_owner: snapshot.cadence_owner ?? prev.cadence_owner');
    expect(wizardSource).toContain("cadence_owner: wizardData.cadence_owner ?? 'client'");
    expect(fixedFeeStepSource).toContain('Invoice on client billing schedule');
    expect(fixedFeeStepSource).toContain('Invoice on contract anniversary');
    expect(fixedFeeStepSource).toContain(
      "Choose which schedule defines this recurring line&apos;s service periods."
    );
    expect(fixedFeeStepSource).toContain(
      "updateData({ cadence_owner: value as ContractWizardData['cadence_owner'] })"
    );
  });
});
