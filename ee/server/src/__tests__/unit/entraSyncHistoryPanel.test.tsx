// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EntraSyncHistoryPanel from '@ee/components/settings/integrations/EntraSyncHistoryPanel';

const { getEntraSyncRunHistoryMock } = vi.hoisted(() => ({
  getEntraSyncRunHistoryMock: vi.fn(),
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
});
