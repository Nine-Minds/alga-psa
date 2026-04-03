import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(process.cwd(), '..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function expectStaticTitle(relativePath: string, title: string): void {
  const content = read(relativePath);
  expect(content).toMatch(/export const metadata/);
  expect(content).toContain(`title: '${title}'`);
}

function expectDynamicTitle(relativePath: string, title: string): void {
  const content = read(relativePath);
  expect(content).toMatch(/generateMetadata/);
  expect(content).toContain(`title: '${title}'`);
}

function pageHasMetadata(relativePath: string): boolean {
  const pageContent = read(relativePath);
  if (/export const metadata|export async function generateMetadata|export function generateMetadata|export \{ default, metadata \}/.test(pageContent)) {
    return true;
  }

  const layoutPath = path.join(path.dirname(relativePath), 'layout.tsx');
  if (!fs.existsSync(path.join(repoRoot, layoutPath))) {
    return false;
  }

  const layoutContent = read(layoutPath);
  return /export const metadata|export async function generateMetadata|export function generateMetadata|export \{ default, metadata \}/.test(layoutContent);
}

function collectPages(rootRelativePath: string): string[] {
  const rootPath = path.join(repoRoot, rootRelativePath);
  const pagePaths: string[] = [];

  function walk(currentPath: string): void {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
        continue;
      }

      if (entry.name === 'page.tsx') {
        pagePaths.push(path.relative(repoRoot, entryPath));
      }
    }
  }

  walk(rootPath);
  return pagePaths.sort();
}

describe('route title metadata coverage', () => {
  it('T001: root layout returns title template metadata', () => {
    const content = read('server/src/app/layout.tsx');
    expect(content).toContain("template: '%s | Alga PSA'");
    expect(content).toContain("default: 'Alga PSA'");
  });

  it('T002: MSP layout exports the Alga PSA title template', () => {
    const content = read('server/src/app/msp/layout.tsx');
    expect(content).toContain("template: '%s | Alga PSA'");
    expect(content).toContain("default: 'Dashboard | Alga PSA'");
  });

  it('T003: Client Portal layout exports the client portal title template', () => {
    const content = read('server/src/app/client-portal/layout.tsx');
    expect(content).toContain("template: '%s | Client Portal'");
    expect(content).toContain("default: 'Dashboard | Client Portal'");
  });

  it('T004: Auth layout exports the Alga PSA auth title template', () => {
    const content = read('server/src/app/auth/layout.tsx');
    expect(content).toContain("template: '%s | Alga PSA'");
    expect(content).toContain("default: 'Sign In | Alga PSA'");
  });

  it('T005: Static layout exports the Alga PSA default title', () => {
    const content = read('server/src/app/static/layout.tsx');
    expect(content).toContain("title: 'Alga PSA'");
  });

  it('T006: static MSP routes export the expected titles', () => {
    const staticMspRoutes = [
      ['server/src/app/msp/dashboard/page.tsx', 'Dashboard'],
      ['server/src/app/msp/account/layout.tsx', 'Account'],
      ['server/src/app/msp/account-manager/page.tsx', 'Account Manager'],
      ['server/src/app/msp/profile/layout.tsx', 'Profile'],
      ['server/src/app/msp/tickets/page.tsx', 'Tickets'],
      ['server/src/app/msp/clients/page.tsx', 'Clients'],
      ['server/src/app/msp/contacts/page.tsx', 'Contacts'],
      ['server/src/app/msp/projects/page.tsx', 'Projects'],
      ['server/src/app/msp/projects/templates/layout.tsx', 'Project Templates'],
      ['server/src/app/msp/projects/templates/create/layout.tsx', 'Create Template'],
      ['server/src/app/msp/assets/page.tsx', 'Assets'],
      ['server/src/app/msp/assets/automation/page.tsx', 'Asset Automation'],
      ['server/src/app/msp/assets/imports/page.tsx', 'Asset Imports'],
      ['server/src/app/msp/assets/integrations/page.tsx', 'Asset Integrations'],
      ['server/src/app/msp/assets/maintenance/page.tsx', 'Asset Maintenance'],
      ['server/src/app/msp/assets/policies/page.tsx', 'Asset Policies'],
      ['server/src/app/msp/billing/page.tsx', 'Billing'],
      ['server/src/app/msp/billing/credits/page.tsx', 'Credits'],
      ['server/src/app/msp/time-entry/page.tsx', 'Time Entry'],
      ['server/src/app/msp/time-sheet-approvals/page.tsx', 'Timesheet Approvals'],
      ['server/src/app/msp/chat/page.tsx', 'Chat'],
      ['server/src/app/msp/email-logs/page.tsx', 'Email Logs'],
      ['server/src/app/msp/schedule/page.tsx', 'Schedule'],
      ['server/src/app/msp/jobs/page.tsx', 'Jobs'],
      ['server/src/app/msp/technician-dispatch/page.tsx', 'Technician Dispatch'],
      ['server/src/app/msp/surveys/page.tsx', 'Surveys'],
      ['server/src/app/msp/surveys/dashboard/page.tsx', 'Survey Dashboard'],
      ['server/src/app/msp/surveys/analytics/page.tsx', 'Survey Analytics'],
      ['server/src/app/msp/surveys/responses/page.tsx', 'Survey Responses'],
      ['server/src/app/msp/surveys/settings/page.tsx', 'Survey Settings'],
      ['server/src/app/msp/workflow-editor/page.tsx', 'Workflow Editor'],
      ['server/src/app/msp/workflow-editor/new/page.tsx', 'New Workflow'],
      ['server/src/app/msp/workflow-control/page.tsx', 'Workflow Control'],
      ['server/src/app/msp/workflows/page.tsx', 'Workflows'],
      ['server/src/app/msp/automation-hub/layout.tsx', 'Automation Hub'],
      ['server/src/app/msp/settings/page.tsx', 'Settings'],
      ['server/src/app/msp/settings/extensions/layout.tsx', 'Extension Settings'],
      ['server/src/app/msp/settings/extensions/install/layout.tsx', 'Install Extension'],
      ['server/src/app/msp/settings/integrations/qbo/callback/page.tsx', 'QuickBooks Integration'],
      ['server/src/app/msp/settings/notifications/layout.tsx', 'Notification Settings'],
      ['server/src/app/msp/settings/sla/layout.tsx', 'SLA Settings'],
      ['server/src/app/msp/security-settings/page.tsx', 'Security Settings'],
      ['server/src/app/msp/extensions/layout.tsx', 'Extensions'],
      ['server/src/app/msp/licenses/purchase/layout.tsx', 'Purchase Licenses'],
      ['server/src/app/msp/licenses/purchase/success/layout.tsx', 'Purchase Success'],
      ['server/src/app/msp/reports/page.tsx', 'Reports'],
      ['server/src/app/msp/user-activities/page.tsx', 'User Activities'],
      ['server/src/app/msp/onboarding/layout.tsx', 'Onboarding'],
      ['server/src/app/msp/share_document/page.tsx', 'Share Document'],
      ['server/src/app/msp/test/layout.tsx', 'Test'],
      ['server/src/app/msp/test/ui-kit/layout.tsx', 'UI Kit'],
      ['server/src/app/msp/test/collab/page.tsx', 'Collaboration Test'],
      ['server/src/app/msp/test/onboarding/layout.tsx', 'Onboarding Test'],
    ] as const;

    for (const [relativePath, title] of staticMspRoutes) {
      expectStaticTitle(relativePath, title);
    }
  });

  it('T007: dynamic MSP routes with static fallback titles use generateMetadata', () => {
    const dynamicMspRoutes = [
      ['server/src/app/msp/tickets/[id]/page.tsx', 'Ticket Details'],
      ['server/src/app/msp/clients/[id]/page.tsx', 'Client Details'],
      ['server/src/app/msp/contacts/[id]/page.tsx', 'Contact Details'],
      ['server/src/app/msp/contacts/[id]/activity/page.tsx', 'Contact Activity'],
      ['server/src/app/msp/projects/[id]/page.tsx', 'Project Details'],
      ['server/src/app/msp/assets/[asset_id]/page.tsx', 'Asset Details'],
      ['server/src/app/msp/workflows/[executionId]/page.tsx', 'Workflow Execution'],
    ] as const;

    for (const [relativePath, title] of dynamicMspRoutes) {
      expectDynamicTitle(relativePath, title);
    }
  });

  it('T007b: dynamic MSP routes with static-only titles use export const metadata', () => {
    const staticDynamicRoutes = [
      ['server/src/app/msp/projects/templates/[templateId]/layout.tsx', 'Template Details'],
      ['server/src/app/msp/time-entry/timesheet/[id]/page.tsx', 'Timesheet'],
      ['server/src/app/msp/surveys/responses/[id]/page.tsx', 'Response Details'],
      ['server/src/app/msp/workflow-editor/[workflowId]/page.tsx', 'Edit Workflow'],
      ['server/src/app/msp/workflows/runs/[runId]/layout.tsx', 'Workflow Run'],
      ['server/src/app/msp/settings/extensions/[id]/layout.tsx', 'Extension Settings'],
      ['server/src/app/msp/settings/extensions/[id]/settings/layout.tsx', 'Extension Configuration'],
      ['server/src/app/msp/extensions/[id]/debug/layout.tsx', 'Extension Debug'],
    ] as const;

    for (const [relativePath, title] of staticDynamicRoutes) {
      expectStaticTitle(relativePath, title);
    }
  });

  it('T008: static Client Portal routes export the expected titles', () => {
    const staticClientPortalRoutes = [
      ['server/src/app/client-portal/dashboard/page.tsx', 'Dashboard'],
      ['server/src/app/client-portal/account/layout.tsx', 'Account'],
      ['server/src/app/client-portal/profile/layout.tsx', 'Profile'],
      ['server/src/app/client-portal/appointments/layout.tsx', 'Appointments'],
      ['server/src/app/client-portal/billing/page.tsx', 'Billing'],
      ['server/src/app/client-portal/tickets/layout.tsx', 'Tickets'],
      ['server/src/app/client-portal/projects/page.tsx', 'Projects'],
    ] as const;

    for (const [relativePath, title] of staticClientPortalRoutes) {
      expectStaticTitle(relativePath, title);
    }
  });

  it('T009: dynamic Client Portal routes with data-driven titles use generateMetadata', () => {
    const dynamicClientPortalRoutes = [
      ['server/src/app/client-portal/tickets/[ticketId]/page.tsx', 'Ticket Details'],
      ['server/src/app/client-portal/projects/[projectId]/page.tsx', 'Project Details'],
    ] as const;

    for (const [relativePath, title] of dynamicClientPortalRoutes) {
      expectDynamicTitle(relativePath, title);
    }
  });

  it('T009b: dynamic Client Portal routes with static-only titles use export const metadata', () => {
    const staticDynamicRoutes = [
      ['server/src/app/client-portal/appointments/[appointmentRequestId]/layout.tsx', 'Appointment Details'],
      ['server/src/app/client-portal/billing/invoices/[invoiceId]/pay/page.tsx', 'Pay Invoice'],
      ['server/src/app/client-portal/billing/invoices/[invoiceId]/payment-success/page.tsx', 'Payment Success'],
    ] as const;

    for (const [relativePath, title] of staticDynamicRoutes) {
      expectStaticTitle(relativePath, title);
    }
  });

  it('T010: auth routes export the expected titles', () => {
    const authRoutes = [
      ['server/src/app/auth/signin/page.tsx', 'Sign In'],
      ['server/src/app/auth/register/layout.tsx', 'Register'],
      ['server/src/app/auth/verify-email/layout.tsx', 'Verify Email'],
      ['server/src/app/auth/check-email/layout.tsx', 'Check Email'],
      ['server/src/app/auth/portal/setup/layout.tsx', 'Portal Setup'],
      ['server/src/app/auth/msp/signin/page.tsx', 'MSP Sign In'],
      ['server/src/app/auth/msp/forgot-password/layout.tsx', 'Forgot Password'],
      ['server/src/app/auth/client-portal/signin/page.tsx', 'Client Portal Sign In'],
      ['server/src/app/auth/client-portal/forgot-password/layout.tsx', 'Forgot Password'],
      ['server/src/app/auth/client-portal/handoff/page.tsx', 'Signing In'],
      ['server/src/app/auth/password-reset/confirmation/layout.tsx', 'Password Reset'],
      ['server/src/app/auth/password-reset/set-new-password/layout.tsx', 'Set New Password'],
    ] as const;

    for (const [relativePath, title] of authRoutes) {
      expectStaticTitle(relativePath, title);
    }
  });

  it('T011: static and public routes export the expected titles', () => {
    expectStaticTitle('server/src/app/static/master_terms/layout.tsx', 'Master Terms');
    expectStaticTitle('server/src/app/static/privacy_policy/layout.tsx', 'Privacy Policy');
  });

  it('T012: existing asset edit metadata stays template-compatible', () => {
    expectStaticTitle('server/src/app/msp/assets/[asset_id]/edit/page.tsx', 'Edit Asset');
  });

  it('T013: auth verify layout metadata stays template-compatible', () => {
    expectStaticTitle('server/src/app/auth/verify/layout.tsx', 'Verify Email');
  });

  it('T014: client settings page metadata stays template-compatible', () => {
    expectStaticTitle('server/src/app/client-portal/client-settings/page.tsx', 'Company Settings');
  });

  it('T015: MSP extension re-export remains metadata-compatible', () => {
    expect(read('server/src/app/msp/extensions/[id]/page.tsx')).toContain("export { default, generateMetadata } from '@product/extensions/entry';");
    expect(read('packages/product-extensions/oss/entry.tsx')).toContain("title: 'Extensions - Enterprise Feature'");
    expect(read('packages/product-extensions/ee/entry.tsx')).toContain('export async function generateMetadata()');
    expect(read('packages/product-extensions/ee/entry.tsx')).toContain("defaultValue: 'Extension'");
  });

  it('T016: Client Portal extension re-export remains metadata-compatible', () => {
    expect(read('server/src/app/client-portal/extensions/[id]/page.tsx')).toContain("export { default, generateMetadata } from '@product/extensions/entry';");
    expect(read('packages/product-extensions/oss/entry.tsx')).toContain("title: 'Extensions - Enterprise Feature'");
    expect(read('packages/product-extensions/ee/entry.tsx')).toContain('export async function generateMetadata()');
    expect(read('packages/product-extensions/ee/entry.tsx')).toContain("defaultValue: 'Extension'");
  });

  it('T017: survey response metadata returns a string title for the root template', () => {
    const content = read('server/src/app/surveys/respond/[token]/page.tsx');
    expect(content).toMatch(/generateMetadata/);
    expect(content).toContain("title: t('surveys.response.pageTitle', 'Customer Satisfaction Survey')");
  });

  it('T020: page routes do not use client-side document.title mutations', () => {
    for (const rootRelativePath of ['server/src/app', 'ee/server/src/app']) {
      for (const relativePath of collectPages(rootRelativePath)) {
        expect(read(relativePath)).not.toContain('document.title');
      }
    }
  });

  it('T021: layout defaults cover pages without page-level metadata', () => {
    expect(read('server/src/app/msp/layout.tsx')).toContain("default: 'Dashboard | Alga PSA'");
    expect(read('server/src/app/client-portal/layout.tsx')).toContain("default: 'Dashboard | Client Portal'");
    expect(read('server/src/app/auth/layout.tsx')).toContain("default: 'Sign In | Alga PSA'");

    expect(read('server/src/app/auth/verify/page.tsx')).not.toMatch(/export const metadata|generateMetadata/);
    expect(read('server/src/app/msp/account/page.tsx')).not.toMatch(/export const metadata|generateMetadata/);

    expect(read('server/src/app/auth/verify/layout.tsx')).toContain("title: 'Verify Email'");
    expect(read('server/src/app/msp/account/layout.tsx')).toContain("title: 'Account'");
  });

  it('T022: added uncovered community routes export the expected titles', () => {
    expectStaticTitle('server/src/app/msp/documents/page.tsx', 'Documents');
    expectStaticTitle('server/src/app/test-routing/page.tsx', 'Test Routing');
  });

  it('T023: EE layouts export the expected title templates', () => {
    const eeRootLayout = read('ee/server/src/app/layout.tsx');
    expect(eeRootLayout).toContain("template: '%s | Alga PSA'");
    expect(eeRootLayout).toContain("default: 'Alga PSA'");

    const eeMspLayout = read('ee/server/src/app/msp/layout.tsx');
    expect(eeMspLayout).toContain("template: '%s | Alga PSA'");
    expect(eeMspLayout).toContain("default: 'Dashboard | Alga PSA'");

    const eeClientPortalLayout = read('ee/server/src/app/client-portal/layout.tsx');
    expect(eeClientPortalLayout).toContain("template: '%s | Client Portal'");
    expect(eeClientPortalLayout).toContain("default: 'Dashboard | Client Portal'");
  });

  it('T024: EE MSP routes export the expected titles', () => {
    expectStaticTitle('ee/server/src/app/msp/chat/page.tsx', 'Chat');
    expectStaticTitle('ee/server/src/app/msp/licenses/purchase/layout.tsx', 'Purchase Licenses');
    expectStaticTitle('ee/server/src/app/msp/licenses/purchase/success/layout.tsx', 'Purchase Success');
    expectStaticTitle('ee/server/src/app/msp/settings/page.tsx', 'Settings');
  });

  it('T025: EE Client Portal extension route exports a static title', () => {
    expectStaticTitle('ee/server/src/app/client-portal/extensions/[id]/page.tsx', 'Extension');
  });

  it('T026: every CE and EE page route has metadata coverage', () => {
    for (const rootRelativePath of ['server/src/app', 'ee/server/src/app']) {
      for (const relativePath of collectPages(rootRelativePath)) {
        expect(pageHasMetadata(relativePath)).toBe(true);
      }
    }
  });
});
