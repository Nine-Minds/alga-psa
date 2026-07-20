// @vitest-environment node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) => readFileSync(path.resolve(__dirname, relativePath), 'utf8');

const warningAction = read('../src/actions/projectBillingWarningActions.ts');
const warningBanner = read('../src/components/project-billing/ProjectPaymentWarningBanner.tsx');
const projectDetail = read('../../projects/src/components/ProjectDetail.tsx');
const taskForm = read('../../projects/src/components/TaskForm.tsx');
const timeEntryDialog = read('../../scheduling/src/components/time-management/time-entry/time-sheet/TimeEntryDialog.tsx');
const mspProjectBillingProvider = read('../../msp-composition/src/projects/MspProjectBillingIntegrationProvider.tsx');
const mspSchedulingProvider = read('../../msp-composition/src/scheduling/MspSchedulingCrossFeatureProvider.tsx');
const portalAction = read('../../client-portal/src/actions/client-portal-actions/client-project-billing.ts');

describe('explicit project payment prerequisite warning contract', () => {
  it('renders nothing without a warning', () => {
    expect(warningBanner).toContain('if (!warning) return null;');
  });

  it('derives warnings only from explicitly flagged, linked, unpaid invoices', () => {
    expect(warningAction).toContain(".andWhere('entry.requires_payment_before_work', true)");
    expect(warningAction).toContain(".join('invoices as invoice'");
    expect(warningAction).toContain(".whereNot('invoice.status', 'paid')");
  });

  it('keeps invoice identifiers behind billing read permission', () => {
    expect(warningAction).toContain("hasPermission(user, 'billing', 'read'");
    expect(warningAction).toContain('has_billing_details: false');
    expect(warningAction).toContain('has_billing_details: true');
  });

  it('warns on project, task, and time-entry surfaces without blocking selection', () => {
    // Feature packages must not import billing; the banner is injected from the
    // composition layer through the projects / scheduling integration contexts.
    expect(projectDetail).toContain('<billingIntegration.PaymentWarningBanner');
    expect(taskForm).toContain('<billingIntegration.PaymentWarningBanner');
    expect(mspProjectBillingProvider).toContain('PaymentWarningBanner: ProjectPaymentWarningBanner');
    expect(mspSchedulingProvider).toContain('getProjectTaskPaymentWarning,');
    expect(timeEntryDialog).toContain('getProjectTaskPaymentWarning');
    expect(timeEntryDialog).toContain('`${id}-project-payment-warning`');
    expect(timeEntryDialog).toContain('hasProjectPaymentWarning');
    expect(timeEntryDialog).not.toContain('disabled={hasProjectPaymentWarning}');
  });

  it('requires client billing permission before returning portal project billing details', () => {
    expect(portalAction).toContain('hasClientBillingReadPermission');
    expect(portalAction).toContain("permissionError('Unauthorized to access project billing data')");
  });
});
