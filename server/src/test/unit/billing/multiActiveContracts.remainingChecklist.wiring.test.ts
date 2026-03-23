import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readRepo = (relativePath: string): string =>
  readFileSync(resolve(__dirname, '../../../../../', relativePath), 'utf8');

describe('multi-active remaining checklist wiring coverage', () => {
  it('T055: integration coverage exercises both wizard and quick-add/action creation paths for the same client', () => {
    const source = readRepo('server/src/test/integration/billing/contractPurchaseOrderSupport.integration.test.ts');
    expect(source).toContain("it('T055: wizard and quick-add/action paths can both create active contracts for the same client'");
    expect(source).toContain('createClientContractFromWizard({');
    expect(source).toContain('createContract({');
    expect(source).toContain('assignContractToClient(');
    expect(source).toContain('activeAssignments.length).toBeGreaterThanOrEqual(2)');
  });

  it('T056/T057/T058/T059: clients billing UI and contract-line flows stay assignment-identity scoped', () => {
    const contractLinesUiSource = readRepo('packages/clients/src/components/clients/ContractLines.tsx');
    const billingConfigurationSource = readRepo('packages/clients/src/components/clients/BillingConfiguration.tsx');
    const overlapMatrixSource = readRepo('packages/clients/src/components/clients/ClientServiceOverlapMatrix.tsx');
    const clientLineActionsSource = readRepo('packages/clients/src/actions/clientContractLineActions.ts');
    const clientLineModelSource = readRepo('packages/clients/src/models/clientContractLine.ts');

    expect(contractLinesUiSource).toContain('value: assignment.client_contract_id!');
    expect(contractLinesUiSource).toContain('client_contract_id: selectedClientContractId');
    expect(billingConfigurationSource).toContain('assignment.client_contract_id === prevSelected');
    expect(overlapMatrixSource).toContain('client_contract_line_id');
    expect(clientLineActionsSource).toContain('ensureAssignmentScopedIdentity');
    expect(clientLineActionsSource).toContain('Contract line mutation is ambiguous for assignment');
    expect(clientLineActionsSource).toContain("concat('contract-', cc.client_contract_id, '-', cl.contract_line_id) as client_contract_line_id");
    expect(clientLineModelSource).toContain("concat('contract-', cc.client_contract_id, '-', cl.contract_line_id) as client_contract_line_id");
  });

  it('T060/T061: recurring selection and invoice reads remain assignment-scoped for independent invoiceability', () => {
    const billingAndTaxSource = readRepo('packages/billing/src/actions/billingAndTax.ts');
    const invoiceGenerationSource = readRepo('packages/billing/src/actions/invoiceGeneration.ts');
    const invoiceQueriesSource = readRepo('packages/billing/src/actions/invoiceQueries.ts');

    expect(billingAndTaxSource).toContain('clientContractId: row.client_contract_id ?? row.contract_id ?? null');
    expect(billingAndTaxSource).toContain('purchaseOrderScopeKey: row.client_contract_id ?? null');
    expect(invoiceGenerationSource).toContain('calculateBillingForSelectionInput');
    expect(invoiceGenerationSource).toContain('getSingleClientContractIdFromCharges');
    expect(invoiceQueriesSource).toContain("'invoices.client_contract_id': contractId");
  });

  it('T065: BillingCycles summary rendering keeps sibling active assignments visible', () => {
    const source = readRepo('packages/billing/src/components/billing-dashboard/BillingCycles.tsx');
    expect(source).toContain('const existingAssignments = clientContractsMap[contract.client_id] ?? [];');
    expect(source).toContain('existingAssignments.push({');
    expect(source).toContain('No active assignments');
    expect(source).toContain('Assignment {assignment.clientContractId.slice(0, 8)}');
  });

  it('T066: bucket ambiguity failures include actionable assignment context', () => {
    const serviceSource = readRepo('packages/billing/src/services/bucketUsageService.ts');
    const testSource = readRepo('server/src/test/unit/billing/bucketUsageService.periods.test.ts');
    expect(serviceSource).toContain('Ambiguous bucket usage assignment resolution for client');
    expect(serviceSource).toContain('Matched assignments: ${clientPlan.client_contract_id}, ${conflictingClientPlan.client_contract_id}.');
    expect(testSource).toContain('Matched assignments: assignment-1, assignment-2');
    expect(testSource).toContain('Provide explicit assignment identity before bucket billing.');
  });

  it('T067: recurring preview rendering includes assignment context for same-named contracts', () => {
    const automaticInvoicesSource = readRepo('packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx');
    expect(automaticInvoicesSource).toContain('const getRecurringAssignmentContext =');
    expect(automaticInvoicesSource).toContain('Assignment line');
    expect(automaticInvoicesSource).toContain('contract-assignment-context-');
  });

  it('T068/T070: wizard and clients assignment writes share create semantics while mixed-currency policy remains explicitly tested', () => {
    const wizardSource = readRepo('packages/billing/src/actions/contractWizardActions.ts');
    const clientActionsSource = readRepo('packages/clients/src/actions/clientContractActions.ts');
    const clientModelSource = readRepo('packages/clients/src/models/clientContract.ts');
    const mixedCurrencyIntegrationSource = readRepo('server/src/test/integration/multiCurrencyGaps.integration.test.ts');

    expect(wizardSource).toContain('createClientContractAssignment(trx, tenant, {');
    expect(clientActionsSource).toContain('createClientContractAssignment(trx, tenant, {');
    expect(clientModelSource).toContain('createClientContractAssignment(db, tenant, {');
    expect(mixedCurrencyIntegrationSource).toContain("expect(warningOrError?.message).toContain('currency');");
  });

  it('T069: activation/reactivation logic remains free of sibling-active singleton blockers', () => {
    const contractActionsSource = readRepo('packages/billing/src/actions/contractActions.ts');
    const sharedContractsSource = readRepo('shared/billingClients/contracts.ts');
    expect(contractActionsSource).toContain("Cannot manually change the status of an expired contract. To reactivate, extend the contract end date.");
    expect(sharedContractsSource).not.toContain('hasActiveContractForClient');
    expect(sharedContractsSource).not.toContain('another active contract');
  });

  it('T072: reporting/export assignment-safe coverage and wording updates are present', () => {
    const reportUiSource = readRepo('packages/billing/src/components/billing-dashboard/reports/ContractReports.tsx');
    const auditCoverageSource = readRepo('packages/billing/tests/multiActiveContracts.reportingExportAudit.wiring.test.ts');
    expect(reportUiSource).toContain('Active assignments');
    expect(auditCoverageSource).toContain('T048: keeps audited report and accounting PO surfaces assignment-scoped');
    expect(auditCoverageSource).toContain('T048: confirms audited files do not include singleton active-contract selectors');
  });
});
