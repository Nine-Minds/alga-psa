import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../../../..');
const planRoot = path.join(
  repoRoot,
  'ee',
  'docs',
  'plans',
  '2026-03-18-recurring-invoicing-hard-cutover',
);

const architecture = fs.readFileSync(path.join(planRoot, 'ARCHITECTURE.md'), 'utf8');
const runbook = fs.readFileSync(path.join(planRoot, 'RUNBOOK.md'), 'utf8');

describe('recurring invoicing hard cutover docs', () => {
  it('T072: hard-cutover runbook explains the final recurring model without treating compatibility due-work rows as normal behavior', () => {
    expect(runbook).toContain('## Final Recurring Mental Model');
    expect(runbook).toContain('Compatibility due-work rows are removed from steady-state recurring execution.');
    expect(runbook).toContain('missing recurring service-period materialization is a repair state, not a fallback-ready invoice row');
    expect(runbook).toContain('recurring_service_periods');
  });

  it('T073: final recurring architecture notes keep client_billing_cycles limited to cadence infrastructure and optional historical context', () => {
    expect(architecture).toContain('## Retained Role Of `client_billing_cycles`');
    expect(architecture).toContain('client cadence administration and anchor management');
    expect(architecture).toContain('source-rule input when `cadence_owner = client`');
    expect(architecture).toContain('optional historical or read-side context');
    expect(architecture).toContain('recurring due-work substrate');
  });

  it('documents recurring service-period storage as required schema instead of rollout-era optional schema', () => {
    expect(architecture).toContain('## Required Schema Posture');
    expect(architecture).toContain('recurring-service-period storage as required schema, not rollout-era optional schema');
    expect(architecture).toContain('missing service-period rows are diagnosed as data repair work');
    expect(architecture).toContain('code must not catch missing table or missing column errors');
  });

  it('T074: the codebase documents an explicit deprecation posture for invoices.billing_cycle_id in recurring code', () => {
    expect(architecture).toContain('## `invoices.billing_cycle_id` Deprecation Posture');
    expect(architecture).toContain('it is passive historical or client-context metadata only');
    expect(architecture).toContain('no live recurring path may use it to decide what recurring work exists');
    expect(architecture).toContain('later physical removal can happen after historical read-side cleanup is complete');
  });

  it('documents the historical read-side fallback strategy without reintroducing live recurring bridge logic', () => {
    expect(architecture).toContain('## Historical Read-Side Strategy');
    expect(architecture).toContain('treat it as `financial_document_fallback`');
    expect(architecture).toContain('surface `missing_source_context`');
    expect(architecture).toContain('do not synthesize new recurring due work from `client_billing_cycles`');
    expect(runbook).toContain('## Historical Incomplete Linkage');
    expect(runbook).toContain('keep the invoice readable as a historical financial document');
    expect(runbook).toContain('do not treat `billing_cycle_id` as a replacement execution key');
  });
});
