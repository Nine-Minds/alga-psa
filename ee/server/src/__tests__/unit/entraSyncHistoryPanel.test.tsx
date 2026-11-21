// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EntraSyncHistoryPanel from '@ee/components/settings/integrations/EntraSyncHistoryPanel';

const { getEntraSyncRunHistoryMock, fetchMock } = vi.hoisted(() => ({
  getEntraSyncRunHistoryMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', async () => {
  const { createLocaleTranslationMock } = await import('../utils/localeTranslationMock');
  return createLocaleTranslationMock('msp/integrations');
});

vi.mock('@alga-psa/integrations/actions', () => ({
  getEntraSyncRunHistory: getEntraSyncRunHistoryMock,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (key === 'integrations.entra.syncHistory.run.header') {
        return `${vars?.runType} · ${vars?.status}`;
      }
      if (key === 'integrations.entra.syncHistory.details.tenantHeader') {
        return `Tenant ${vars?.tenant} · ${vars?.status}`;
      }
      if (key === 'integrations.entra.syncHistory.details.stats') {
        return `created ${vars?.created}, linked ${vars?.linked}, updated ${vars?.updated}, ambiguous ${vars?.ambiguous}, inactivated ${vars?.inactivated}`;
      }
      if (key === 'integrations.entra.syncHistory.details.summarySkipped') {
        return `Skipped provisioning outcomes: ${vars?.count}`;
      }
      if (key === 'integrations.entra.syncHistory.details.contactsFailed') {
        return `${vars?.count} contacts failed`;
      }
      if (key === 'integrations.entra.syncHistory.details.summaryFailed') {
        return `Contacts that failed: ${vars?.count}`;
      }
      if (key === 'integrations.entra.syncHistory.details.failureEntry') {
        return `${vars?.user} (${vars?.stage}): ${vars?.message}`;
      }
      if (key === 'integrations.entra.syncHistory.details.moreFailures') {
        return `and ${vars?.count} more`;
      }
      if (key.startsWith('integrations.entra.syncHistory.details.stages.')) {
        return key.split('.').pop() as string;
      }
      return key;
    },
  }),
}));

describe('EntraSyncHistoryPanel', () => {
  beforeEach(() => {
    getEntraSyncRunHistoryMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('T122: renders recent sync runs sorted by startedAt descending', async () => {
    getEntraSyncRunHistoryMock.mockResolvedValue({
      success: true,
      data: {
        runs: [
          {
            runId: 'run-old',
            status: 'completed',
            runType: 'old-run',
            startedAt: '2026-02-20T00:10:00.000Z',
            completedAt: '2026-02-20T00:20:00.000Z',
            totalTenants: 2,
            processedTenants: 2,
            succeededTenants: 2,
            failedTenants: 0,
          },
          {
            runId: 'run-newest',
            status: 'completed',
            runType: 'newest-run',
            startedAt: '2026-02-20T04:10:00.000Z',
            completedAt: '2026-02-20T04:20:00.000Z',
            totalTenants: 2,
            processedTenants: 2,
            succeededTenants: 2,
            failedTenants: 0,
          },
          {
            runId: 'run-middle',
            status: 'completed',
            runType: 'middle-run',
            startedAt: '2026-02-20T02:10:00.000Z',
            completedAt: '2026-02-20T02:20:00.000Z',
            totalTenants: 2,
            processedTenants: 2,
            succeededTenants: 2,
            failedTenants: 0,
          },
        ],
      },
    });

    render(<EntraSyncHistoryPanel />);

    await screen.findByText('newest-run · completed');
    const newest = document.getElementById('entra-sync-run-drilldown-run-newest');
    const middle = document.getElementById('entra-sync-run-drilldown-run-middle');
    const oldest = document.getElementById('entra-sync-run-drilldown-run-old');

    expect(newest).not.toBeNull();
    expect(middle).not.toBeNull();
    expect(oldest).not.toBeNull();

    expect(newest!.compareDocumentPosition(middle as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(middle!.compareDocumentPosition(oldest as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('T123: drilldown view renders per-tenant outcomes and counter details', async () => {
    getEntraSyncRunHistoryMock.mockResolvedValue({
      success: true,
      data: {
        runs: [
          {
            runId: 'run-123',
            status: 'completed',
            runType: 'all-tenants',
            startedAt: '2026-02-20T04:10:00.000Z',
            completedAt: '2026-02-20T04:20:00.000Z',
            totalTenants: 1,
            processedTenants: 1,
            succeededTenants: 1,
            failedTenants: 0,
          },
        ],
      },
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          run: {
            runId: 'run-123',
            status: 'completed',
            runType: 'all-tenants',
            startedAt: '2026-02-20T04:10:00.000Z',
            completedAt: '2026-02-20T04:20:00.000Z',
            totalTenants: 1,
            processedTenants: 1,
            succeededTenants: 1,
            failedTenants: 0,
            summary: {
              skipped: 2,
            },
          },
          tenantResults: [
            {
              managedTenantId: 'managed-123',
              clientId: 'client-123',
              status: 'completed',
              created: 2,
              linked: 3,
              updated: 1,
              ambiguous: 0,
              inactivated: 4,
              skipped: 2,
              errorMessage: null,
            },
          ],
        },
      }),
    });

    render(<EntraSyncHistoryPanel />);

    await screen.findByText('all-tenants · completed');
    const button = document.getElementById('entra-sync-run-drilldown-run-123');
    expect(button).not.toBeNull();
    fireEvent.click(button as HTMLElement);

    await screen.findByText('Tenant managed-123 · completed');
    expect(screen.getByText('Skipped provisioning outcomes: 2')).toBeInTheDocument();
    expect(
      screen.getByText('created 2, linked 3, updated 1, ambiguous 0, inactivated 4, skipped 2')
    ).toBeInTheDocument();
  });

  async function openDrilldown(tenantResult: Record<string, unknown>, summary: Record<string, unknown>) {
    getEntraSyncRunHistoryMock.mockResolvedValue({
      success: true,
      data: {
        runs: [
          {
            runId: 'run-f',
            status: 'completed',
            runType: 'all-tenants',
            startedAt: '2026-02-20T04:10:00.000Z',
            completedAt: '2026-02-20T04:20:00.000Z',
            totalTenants: 1,
            processedTenants: 1,
            succeededTenants: 1,
            failedTenants: 0,
          },
        ],
      },
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          run: {
            runId: 'run-f',
            status: 'completed',
            runType: 'all-tenants',
            startedAt: '2026-02-20T04:10:00.000Z',
            completedAt: '2026-02-20T04:20:00.000Z',
            totalTenants: 1,
            processedTenants: 1,
            succeededTenants: 1,
            failedTenants: 0,
            summary,
          },
          tenantResults: [
            {
              managedTenantId: 'managed-f',
              clientId: 'client-f',
              status: 'completed',
              created: 1,
              linked: 0,
              updated: 0,
              ambiguous: 0,
              inactivated: 0,
              errorMessage: null,
              ...tenantResult,
            },
          ],
        },
      }),
    });

    render(<EntraSyncHistoryPanel />);
    await screen.findByText('all-tenants · completed');
    fireEvent.click(document.getElementById('entra-sync-run-drilldown-run-f') as HTMLElement);
    await screen.findByText('Tenant managed-f · completed');
  }

  it('T008: shows "N contacts failed" and the failed users by display name, never by id', async () => {
    await openDrilldown(
      {
        failed: 3,
        userIssues: [
          {
            severity: 'failure',
            stage: 'create',
            entraObjectId: 'entra-object-secret-1',
            userPrincipalName: 'ann@example.com',
            displayName: 'Ann Example',
            contactNameId: 'contact-secret-1',
            message: 'Cannot create contact for Entra user without email/UPN.',
          },
          {
            severity: 'failure',
            stage: 'link',
            entraObjectId: 'entra-object-secret-2',
            userPrincipalName: 'bob@example.com',
            displayName: null,
            message: 'link boom',
          },
          {
            severity: 'notice',
            stage: 'create',
            entraObjectId: 'entra-object-secret-3',
            userPrincipalName: 'cy@example.com',
            displayName: 'Cy Example',
            field: 'phone_numbers',
            message: 'Extension "12345678901" was dropped: extensions are 1-10 digits.',
          },
        ],
      },
      { failed: 3 }
    );

    expect(screen.getByText('Contacts that failed: 3')).toBeInTheDocument();
    expect(screen.getByText('3 contacts failed')).toBeInTheDocument();
    expect(
      screen.getByText('Ann Example (create): Cannot create contact for Entra user without email/UPN.')
    ).toBeInTheDocument();
    expect(screen.getByText('bob@example.com (link): link boom')).toBeInTheDocument();
    expect(screen.getByText('and 1 more')).toBeInTheDocument();
    expect(screen.getByText(/Cy Example \(create\): Extension/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('entra-object-secret');
    expect(document.body.textContent).not.toContain('contact-secret');
  });

  it('T008: shows nothing about failures when failed is 0', async () => {
    await openDrilldown({ failed: 0, userIssues: [] }, { failed: 0 });

    expect(screen.queryByText(/contacts failed/)).toBeNull();
    expect(screen.queryByText(/Contacts that failed/)).toBeNull();
  });
});
