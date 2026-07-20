// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../..');
const readRepo = (relativePath: string) => readFileSync(path.join(repoRoot, relativePath), 'utf8');

const projectDetail = readRepo('packages/projects/src/components/ProjectDetail.tsx');
const projectInfo = readRepo('packages/projects/src/components/ProjectInfo.tsx');
const taskForm = readRepo('packages/projects/src/components/TaskForm.tsx');
const timeEntryDialog = readRepo('packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeEntryDialog.tsx');
const clientConfig = readRepo('packages/projects/src/components/ClientPortalConfigEditor.tsx');
const clientSummary = readRepo('packages/client-portal/src/components/projects/ProjectBillingSummarySection.tsx');
const invoicingHub = readRepo('packages/billing/src/components/billing-dashboard/InvoicingHub.tsx');
const customTabs = readRepo('packages/ui/src/components/CustomTabs.tsx');
const flagDocs = readRepo('docs/features/feature-flags.md');

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolutePath);
    return /\.(ts|tsx)$/.test(entry.name) ? [absolutePath] : [];
  });
}

describe('project-billing UI-only feature flag contract', () => {
  it('hides ambient project traces without gating explicit project billing content', () => {
    expect(projectDetail).toContain("useFeatureFlag('project-billing-ui', { defaultValue: false })");
    expect(projectDetail).toContain('canViewBilling && projectBillingUiEnabled');
    expect(projectDetail).toContain("!projectBillingUiEnabled && initialViewMode !== 'billing'");
    expect(projectDetail).toContain('projectBillingUiEnabled && billingOverview?.config');
    expect(projectDetail).toContain('readyEntry && canViewBilling && projectBillingUiEnabled');
    expect(projectDetail).toContain('projectBillingUiEnabled && billingIntegration && (');
    expect(projectDetail).toContain("if (viewMode === 'billing')");
    expect(projectDetail).not.toContain("viewMode === 'billing' && projectBillingUiEnabled");
  });

  it('hides only the Invoicing Hub trigger while preserving its URL-selected content', () => {
    expect(invoicingHub).toContain("useFeatureFlag('project-billing-ui', { defaultValue: false })");
    expect(invoicingHub).toContain("'project-billing'");
    expect(invoicingHub).toContain('hideTrigger: !projectBillingUiEnabled');
    expect(invoicingHub).toContain('<ProjectBillingReviewTab');
    expect(customTabs).toContain('hideTrigger?: boolean;');
    expect(customTabs).toContain("allTabs.filter((tab) => !tab.hideTrigger)");
    expect(customTabs).toContain('allTabs.map((tab, index)');
  });

  it('guards every embedded project-billing trace at its owning client component', () => {
    expect(projectInfo).toContain('projectBillingUiEnabled && billingIntegration && billedSummary');
    expect(taskForm).toContain('projectBillingUiEnabled && billingIntegration && (');
    expect(taskForm).toContain('<billingIntegration.PaymentWarningBanner');
    expect(timeEntryDialog).toContain('projectBillingUiEnabled && hasProjectPaymentWarning');
    expect(clientConfig).toContain('projectBillingUiEnabled && config.show_billing');
    expect(clientConfig).toContain('{projectBillingUiEnabled && (');
    expect(clientSummary).toContain('if (!projectBillingUiEnabled)');
    expect(clientSummary).toContain('if (!projectBillingUiEnabled || !summary || !summary.enabled)');
  });

  it('documents the flag and keeps its runtime key out of backend code', () => {
    expect(flagDocs).toContain('### 11. `project-billing-ui`');
    expect(flagDocs).toContain('Backend actions, APIs, services, events, jobs, invoice behavior, database logic, and authorization are always available');

    const roots = [
      'packages/billing/src',
      'packages/client-portal/src',
      'packages/projects/src',
      'packages/scheduling/src',
      'packages/ui/src',
      'server/src',
    ];
    const matches = roots
      .flatMap((root) => sourceFiles(path.join(repoRoot, root)))
      .filter((file) => readFileSync(file, 'utf8').includes('project-billing-ui'))
      .map((file) => path.relative(repoRoot, file))
      .sort();

    expect(matches).toEqual([
      'packages/billing/src/components/billing-dashboard/InvoicingHub.tsx',
      'packages/client-portal/src/components/projects/ProjectBillingSummarySection.tsx',
      'packages/projects/src/components/ClientPortalConfigEditor.tsx',
      'packages/projects/src/components/ProjectDetail.tsx',
      'packages/projects/src/components/ProjectInfo.tsx',
      'packages/projects/src/components/TaskForm.tsx',
      'packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeEntryDialog.tsx',
    ]);
  });
});
