import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../../../..');
const planRoot = path.join(
  repoRoot,
  'ee',
  'docs',
  'plans',
  '2026-03-18-service-driven-invoicing-cutover',
);

const runbook = fs.readFileSync(path.join(planRoot, 'RUNBOOK.md'), 'utf8');

describe('service-driven invoicing cutover runbook', () => {
  it('T084: backfill and replenishment commands are documented with enough detail to initialize service-driven invoicing in a local or staging tenant', () => {
    expect(runbook).toContain('## Cutover Sequence');
    expect(runbook).toContain('## Migration Checklist');
    expect(runbook).toContain('## Coverage Assessment Entry Point');
    expect(runbook).toContain('## Backfill Entry Point');
    expect(runbook).toContain('## Regeneration Entry Point');
    expect(runbook).toContain("pnpm exec tsx <<'TS'");
    expect(runbook).toContain("import { assessRecurringServicePeriodGenerationCoverage } from './shared/billingClients/recurringServicePeriodGenerationHorizon.ts';");
    expect(runbook).toContain("import { backfillRecurringServicePeriods } from './shared/billingClients/backfillRecurringServicePeriods.ts';");
    expect(runbook).toContain("import { regenerateRecurringServicePeriods } from './shared/billingClients/regenerateRecurringServicePeriods.ts';");
  });

  it('T085: reverse/delete repair workflow is documented for service-driven recurring invoices', () => {
    expect(runbook).toContain('## Reverse/Delete Repair Notes');
    expect(runbook).toContain('If a recurring invoice was deleted during cutover testing and the due row did not come back:');
    expect(runbook).toContain('confirm `invoice_id`, `invoice_charge_id`, and `invoice_charge_detail_id` were cleared');
    expect(runbook).toContain('confirm `lifecycle_state = \'locked\'`');
    expect(runbook).toContain("capture the recurring row's `schedule_key`, `period_key`, `invoice_id`, and `executionIdentityKey`");
    expect(runbook).toContain('rerun the due-work reader to confirm the same execution window is visible again when it should be invoiceable');
  });
});
