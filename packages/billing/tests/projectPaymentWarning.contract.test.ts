// @vitest-environment node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) => readFileSync(path.resolve(__dirname, relativePath), 'utf8');

const warningAction = read('../src/actions/projectBillingWarningActions.ts');
const projectDetail = read('../../projects/src/components/ProjectDetail.tsx');
const taskForm = read('../../projects/src/components/TaskForm.tsx');
const timeEntryDialog = read('../../scheduling/src/components/time-management/time-entry/time-sheet/TimeEntryDialog.tsx');
const portalAction = read('../../client-portal/src/actions/client-portal-actions/client-project-billing.ts');

describe('explicit project payment prerequisite warning contract', () => {
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
    expect(projectDetail).toContain('<ProjectPaymentWarningBanner');
    expect(taskForm).toContain('<ProjectPaymentWarningBanner');
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
