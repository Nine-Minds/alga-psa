import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./billingSettingsActions.ts', import.meta.url), 'utf8');

describe('billingSettingsActions cadence-owner defaults wiring', () => {
  it('extends BillingSettings with recurring cadence rollout metadata', () => {
    expect(source).toContain("type RecurringCadenceRolloutState = 'mixed_enabled';");
    expect(source).toContain('defaultRecurringCadenceOwner?: CadenceOwner;');
    expect(source).toContain('recurringCadenceRolloutState?: RecurringCadenceRolloutState;');
    expect(source).toContain('recurringCadenceRolloutMessage?: string;');
  });

  it('returns enabled mixed-cadence metadata from default and client settings readers', () => {
    expect(source).toContain("const DEFAULT_RECURRING_CADENCE_OWNER: CadenceOwner = 'client';");
    expect(source).toContain("const DEFAULT_RECURRING_CADENCE_ROLLOUT_STATE: RecurringCadenceRolloutState = 'mixed_enabled';");
    expect(source).toContain('defaultRecurringCadenceOwner: DEFAULT_RECURRING_CADENCE_OWNER');
    expect(source).toContain('recurringCadenceRolloutState: DEFAULT_RECURRING_CADENCE_ROLLOUT_STATE');
    expect(source).toContain('recurringCadenceRolloutMessage: CONTRACT_CADENCE_ROLLOUT_BLOCK_MESSAGE');
  });

  it('allows contract cadence defaults without throwing on billing-settings update paths', () => {
    expect(source).not.toContain('throw new Error(CONTRACT_CADENCE_ROLLOUT_BLOCK_MESSAGE);');
  });
});
