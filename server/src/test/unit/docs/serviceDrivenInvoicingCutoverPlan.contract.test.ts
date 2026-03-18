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
  it('documents recurring service-period maintenance entrypoints and validation commands', () => {
    expect(runbook).toContain('# Service-Driven Invoicing Cutover Runbook');
    expect(runbook).toContain('## Quick Diagnosis');
    expect(runbook).toContain('missing_service_period_materialization');
    expect(runbook).toContain('## Coverage Assessment Entry Point');
    expect(runbook).toContain('assessRecurringServicePeriodGenerationCoverage');
    expect(runbook).toContain('## Backfill Entry Point');
    expect(runbook).toContain('backfillRecurringServicePeriods');
    expect(runbook).toContain('## Regeneration Entry Point');
    expect(runbook).toContain('regenerateRecurringServicePeriods');
    expect(runbook).toContain('DB_HOST=127.0.0.1 DB_PORT=57433');
    expect(runbook).toContain('## Reverse/Delete Repair Notes');
    expect(runbook).toContain("lifecycle_state = 'locked'");
  });
});
