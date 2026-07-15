import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const initialGuardMigration = readFileSync(
  new URL('../../../../migrations/20260715090006_guard_project_billing_schedule_status_transitions.cjs', import.meta.url),
  'utf8',
);
const hardeningMigration = readFileSync(
  new URL('../../../../migrations/20260715140000_harden_project_billing_schedule.cjs', import.meta.url),
  'utf8',
);
const modelSource = readFileSync(
  new URL('../../../../../packages/billing/src/models/projectBillingScheduleEntry.ts', import.meta.url),
  'utf8',
);

describe('project billing lifecycle is Citus-safe', () => {
  it('never attempts to install the ordinary transition trigger when Citus is present', () => {
    const citusGuard = initialGuardMigration.indexOf("extname = 'citus'");
    const earlyReturn = initialGuardMigration.indexOf('if (citusRows.length > 0)', citusGuard);
    const triggerDdl = initialGuardMigration.indexOf('CREATE TRIGGER', earlyReturn);
    expect(citusGuard).toBeGreaterThan(-1);
    expect(earlyReturn).toBeGreaterThan(citusGuard);
    expect(triggerDdl).toBeGreaterThan(earlyReturn);
  });

  it('removes legacy trigger enforcement and retains atomic expected-source updates', () => {
    expect(hardeningMigration).toContain('DROP TRIGGER IF EXISTS project_billing_schedule_status_transition_guard');
    expect(modelSource).toContain('isAllowedProjectBillingStatusTransition(from, to)');
    expect(modelSource).toContain('status: from');
    expect(modelSource).toContain('status: to');
  });
});
