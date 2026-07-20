import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const invoiceGeneration = readFileSync(
  new URL('../../../../../packages/billing/src/actions/invoiceGeneration.ts', import.meta.url),
  'utf8',
);
const invoiceModification = readFileSync(
  new URL('../../../../../packages/billing/src/actions/invoiceModification.ts', import.meta.url),
  'utf8',
);
const creditActions = readFileSync(
  new URL('../../../../../packages/billing/src/actions/creditActions.ts', import.meta.url),
  'utf8',
);

function section(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('project invoice lifecycle contracts', () => {
  it('T012: standalone generation stamps project_id and persists charge + optimistic entry transition together', () => {
    const action = section(invoiceGeneration, 'export const generateProjectInvoice', 'export const generateInvoice');
    const invoiceCreate = invoiceGeneration.slice(
      invoiceGeneration.indexOf('export const createInvoiceFromBillingResult'),
    );
    const schedulePersistence = section(invoiceGeneration, 'async function persistProjectScheduleCharges', 'async function ensureProjectScheduleExportServices');

    expect(action).toContain("project.invoice_mode !== 'standalone'");
    expect(action).toContain('billingEngine.calculateProjectBilling(projectId, entryIds)');
    expect(action).toContain('{ projectId },');
    expect(invoiceCreate).toContain('...(options.projectId ? { project_id: options.projectId } : {})');
    expect(invoiceCreate).toContain('const projectScheduleCharges = billingResult.charges.filter(isProjectScheduleCharge);');
    expect(invoiceCreate).toContain('await persistProjectScheduleCharges(');
    expect(invoiceCreate).toContain('trx,');
    expect(schedulePersistence).toContain("table('invoice_charges').insert");
    expect(schedulePersistence).toContain("projectCharge.schedule_entry_id,");
    expect(schedulePersistence).toContain("'approved',");
    expect(schedulePersistence).toContain("'invoiced',");
    expect(schedulePersistence).toContain('invoice_id: invoiceId');
    expect(schedulePersistence).toContain('invoice_charge_id: itemId');
    expect(schedulePersistence).toContain('trx,');
  });

  it('T019: finalization issues project-earmarked deposit credit and application prefers the matching project', () => {
    const issueCredit = section(invoiceModification, 'async function issueProjectDepositCreditsForInvoice', 'async function rollbackProjectDepositCreditsForInvoice');
    const finalize = section(invoiceModification, 'export const finalizeInvoice', 'export const unfinalizeInvoice');

    expect(issueCredit).toContain("'config.deposit_treatment': 'credit'");
    expect(issueCredit).toContain("type: 'credit_issuance'");
    expect(issueCredit).toContain("project_billing_credit_kind: 'project_deposit'");
    expect(issueCredit).toContain('project_id: projectId');
    expect(issueCredit).toContain("tenantScopedTable(trx, tenant, 'credit_tracking').insert");
    expect(finalize).toContain('issueProjectDepositCreditsForInvoice(');

    expect(creditActions).toContain(".select('credit_applied', 'currency_code', 'project_id')");
    expect(creditActions).toContain("metadata.project_billing_credit_kind === 'project_deposit'");
    expect(creditActions).toContain('.filter(({ projectId }) => !projectId || projectId === invoiceProjectId)');
    expect(creditActions).toContain('left.projectId === invoiceProjectId ? 0 : 1');
  });

  it('T023: unfinalize preserves project linkage and caps while hard delete releases them exactly once', () => {
    const rollback = section(invoiceModification, 'async function releaseProjectBillingForDeletedInvoice', 'type ProjectDepositCreditEvent');
    const unfinalize = section(invoiceModification, 'export const unfinalizeInvoice', 'export const updateInvoiceManualItems');
    const hardDelete = invoiceModification.slice(
      invoiceModification.indexOf('export const hardDeleteInvoice'),
    );

    expect(rollback).toContain(".where({ invoice_id: invoiceId, status: 'invoiced' })");
    expect(rollback).toContain("'invoiced',");
    expect(rollback).toContain("'approved',");
    expect(rollback).toContain('invoice_id: null');
    expect(rollback).toContain('invoice_charge_id: null');
    expect(rollback).toContain('metadata.project_billing_cap_rolled_back === true');
    expect(rollback).toContain('ProjectBillingCapUsage.getForUpdate(delta.configId, trx)');
    expect(rollback).toContain('{ billed: -billedRollback, writtenDown: -writtenDownRollback }');
    expect(rollback).toContain('project_billing_cap_rolled_back: true');
    expect(invoiceModification).toContain("for (const tableName of ['project_materials', 'ticket_materials'])");
    expect(invoiceModification).toContain('.where({ billed_invoice_id: invoiceId, is_billed: true })');
    expect(invoiceModification).toContain('billed_invoice_id: null');
    expect(invoiceModification).toContain('billed_at: null');
    expect(unfinalize).not.toContain('releaseProjectBillingForDeletedInvoice');
    expect(unfinalize).not.toContain('releaseMaterialsForDeletedInvoice');
    expect(hardDelete).toContain('await releaseProjectBillingForDeletedInvoice(trx, tenant, invoiceId);');
    expect(hardDelete).toContain('await releaseMaterialsForDeletedInvoice(trx, tenant, invoiceId);');
  });
});
