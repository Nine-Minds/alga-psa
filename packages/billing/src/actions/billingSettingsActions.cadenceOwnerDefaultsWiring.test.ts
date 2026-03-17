import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./billingSettingsActions.ts', import.meta.url), 'utf8');

describe('billingSettingsActions cadence-owner defaults wiring', () => {
  it('extends BillingSettings with recurring cadence rollout metadata', () => {
    expect(source).toContain("type RecurringCadenceRolloutState = 'client_only';");
    expect(source).toContain('defaultRecurringCadenceOwner?: CadenceOwner;');
    expect(source).toContain('recurringCadenceRolloutState?: RecurringCadenceRolloutState;');
    expect(source).toContain('recurringCadenceRolloutMessage?: string;');
  });

  it('returns client cadence defaults and rollout messaging from default and client settings readers', () => {
    expect(source).toContain("const DEFAULT_RECURRING_CADENCE_OWNER: CadenceOwner = 'client';");
    expect(source).toContain("const DEFAULT_RECURRING_CADENCE_ROLLOUT_STATE: RecurringCadenceRolloutState = 'client_only';");
    expect(source).toContain('defaultRecurringCadenceOwner: DEFAULT_RECURRING_CADENCE_OWNER');
    expect(source).toContain('recurringCadenceRolloutState: DEFAULT_RECURRING_CADENCE_ROLLOUT_STATE');
    expect(source).toContain('recurringCadenceRolloutMessage: CONTRACT_CADENCE_ROLLOUT_BLOCK_MESSAGE');
  });

  it('keeps contract cadence blocked on billing-settings update paths during rollout', () => {
    expect(source).toContain('data.defaultRecurringCadenceOwner');
    expect(source).toContain('throw new Error(CONTRACT_CADENCE_ROLLOUT_BLOCK_MESSAGE);');
  });
});
