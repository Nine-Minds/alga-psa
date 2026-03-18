import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('contract line preset recurring authoring wiring', () => {
  it('T234: preset create and edit surfaces persist explicit recurring timing defaults instead of dropping them at the UI payload seam', () => {
    const dialogSource = readFileSync(
      resolve(__dirname, '../src/components/billing-dashboard/ContractLineDialog.tsx'),
      'utf8',
    );
    const fixedPresetSource = readFileSync(
      resolve(__dirname, '../src/components/billing-dashboard/contract-lines/FixedContractLinePresetConfiguration.tsx'),
      'utf8',
    );

    expect(dialogSource).toContain("billing_timing: planType === 'Fixed' ? billingTiming : 'arrears',");
    expect(dialogSource).toContain("cadence_owner: 'client',");
    expect(dialogSource).toContain("resolveBillingCycleAlignmentForCompatibility({");
    expect(dialogSource).toContain("currentAlignment === 'start'");
    expect(dialogSource).toContain("? 'prorated'");

    expect(fixedPresetSource).toContain("const [billingTiming, setBillingTiming] = useState<'arrears' | 'advance'>('arrears');");
    expect(fixedPresetSource).toContain("setBillingTiming(fetchedPlan.billing_timing ?? 'arrears');");
    expect(fixedPresetSource).toContain('billing_timing: billingTiming,');
    expect(fixedPresetSource).toContain("cadence_owner: plan?.cadence_owner ?? 'client',");
    expect(fixedPresetSource).toContain(
      'This preset defaults to client-schedule cadence during the current rollout.',
    );
  });
});
