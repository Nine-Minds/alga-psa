// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EntraSyncHistoryPanel from '@ee/components/settings/integrations/EntraSyncHistoryPanel';

const { getEntraSyncRunHistoryMock, fetchMock } = vi.hoisted(() => ({
  getEntraSyncRunHistoryMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock('@alga-psa/integrations/actions', () => ({
  getEntraSyncRunHistory: getEntraSyncRunHistoryMock,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
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
    expect(
      screen.getByText('created 2, linked 3, updated 1, ambiguous 0, inactivated 4')
    ).toBeInTheDocument();
  });
});
