/// <reference types="@testing-library/jest-dom/vitest" />
/** @vitest-environment jsdom */

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({
  getWorkflowLaunchSkipSummaryAction: vi.fn(),
  listWorkflowLaunchSkipsPagedAction: vi.fn(),
}));

vi.mock('@alga-psa/workflows/actions', () => actionMocks);

// i18n backed by the real en locale file (so missing keys fail), falling back to defaultValue.
// Pluralization: _one/_other via `count`.
const enLocale = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('node:path');
  return JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), '../../server/public/locales/en/msp/workflows.json'), 'utf8')
  ) as Record<string, unknown>;
});
const lookup = (key: string): string | undefined => {
  let cur: any = enLocale;
  for (const part of key.split('.')) cur = cur?.[part];
  return typeof cur === 'string' ? cur : undefined;
};

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const count = options?.count as number | undefined;
      const fromLocale =
        typeof count === 'number' ? lookup(`${key}_${count === 1 ? 'one' : 'other'}`) ?? lookup(key) : lookup(key);
      const raw = fromLocale ?? (count === 1 ? (options?.defaultValue_one as string | undefined) : (options?.defaultValue_other as string | undefined)) ??
        (options?.defaultValue as string | undefined) ??
        key;
      return raw.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(options?.[name] ?? ''));
    },
  }),
  useFormatters: () => ({
    formatRelativeTime: (value: string) => `rel(${value})`,
    formatDate: (value: string) => `date(${value})`,
  }),
}));

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock('@alga-psa/ui/components/Drawer', () => ({
  __esModule: true,
  default: ({ isOpen, children, id }: { isOpen: boolean; children: React.ReactNode; id?: string }) =>
    isOpen ? <div id={id} role="dialog">{children}</div> : null,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  __esModule: true,
  default: ({ id, options, value, onValueChange }: {
    id: string;
    options: Array<{ value: string; label: string }>;
    value: string;
    onValueChange: (value: string) => void;
  }) => (
    <select id={id} data-testid={id} value={value} onChange={(event) => onValueChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

// Simplified table: renders column titles/cells, row click, and the caller-driven expanded row.
vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({ id, data, columns, onRowClick, expandedRowRender, onPageChange, currentPage }: any) => (
    <div id={id}>
      <table>
        <thead>
          <tr>{columns.map((column: any) => <th key={column.title}>{column.title}</th>)}</tr>
        </thead>
        <tbody>
          {data.map((record: any) => (
            <React.Fragment key={record.skipId}>
              <tr data-testid={`row-${record.skipId}`} onClick={() => onRowClick?.(record)}>
                {columns.map((column: any) => (
                  <td key={column.title}>
                    {column.render ? column.render(record[column.dataIndex], record) : String(record[column.dataIndex])}
                  </td>
                ))}
              </tr>
              {expandedRowRender?.(record) && <tr><td>{expandedRowRender(record)}</td></tr>}
            </React.Fragment>
          ))}
        </tbody>
      </table>
      <button type="button" data-testid="next-page" onClick={() => onPageChange?.((currentPage ?? 1) + 1)}>next</button>
    </div>
  ),
}));

import WorkflowLaunchSkipBanner from '../WorkflowLaunchSkipBanner';
import WorkflowLaunchSkipsDrawer from '../WorkflowLaunchSkipsDrawer';

const WORKFLOW_ID = '11111111-1111-4111-8111-111111111111';

const emptyGroup = { total: 0, lastSkippedAt: null, byReason: [] };
const summary = (overrides: Record<string, unknown> = {}) => ({
  from: '2026-10-03T00:00:00.000Z',
  alarming: emptyGroup,
  intentional: emptyGroup,
  ...overrides,
});

const skipItem = {
  skipId: 'skip-1',
  eventId: '22222222-2222-4222-8222-222222222222',
  eventName: 'TICKET_CREATED',
  eventDisplayName: 'Ticket created',
  reason: 'schema_mismatch',
  intentional: false,
  message: 'Payload does not match the schema',
  details: { issues: [{ path: 'ticket.id', message: 'Required' }] },
  createdAt: '2026-10-09T10:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  actionMocks.getWorkflowLaunchSkipSummaryAction.mockResolvedValue(summary());
  actionMocks.listWorkflowLaunchSkipsPagedAction.mockResolvedValue({ items: [], totalItems: 0 });
});

afterEach(() => cleanup());

describe('WorkflowLaunchSkipBanner', () => {
  it('renders nothing when there are no skips', async () => {
    render(<WorkflowLaunchSkipBanner workflowId={WORKFLOW_ID} isPublished />);
    await waitFor(() => expect(actionMocks.getWorkflowLaunchSkipSummaryAction).toHaveBeenCalled());
    expect(document.getElementById('workflow-launch-skip-banner')).not.toBeInTheDocument();
  });

  it('renders nothing when only intentional skips exist', async () => {
    actionMocks.getWorkflowLaunchSkipSummaryAction.mockResolvedValue(
      summary({ intentional: { total: 5, lastSkippedAt: '2026-10-09T00:00:00.000Z', byReason: [{ reason: 'paused', count: 5, lastSkippedAt: null }] } })
    );
    render(<WorkflowLaunchSkipBanner workflowId={WORKFLOW_ID} isPublished />);
    await waitFor(() => expect(actionMocks.getWorkflowLaunchSkipSummaryAction).toHaveBeenCalled());
    expect(document.getElementById('workflow-launch-skip-banner')).not.toBeInTheDocument();
  });

  it('does not query or render for an unpublished workflow', async () => {
    render(<WorkflowLaunchSkipBanner workflowId={WORKFLOW_ID} isPublished={false} />);
    await act(async () => undefined);
    expect(actionMocks.getWorkflowLaunchSkipSummaryAction).not.toHaveBeenCalled();
    expect(document.getElementById('workflow-launch-skip-banner')).not.toBeInTheDocument();
  });

  it('shows pluralized copy with reasons and the last-skipped line', async () => {
    actionMocks.getWorkflowLaunchSkipSummaryAction.mockResolvedValue(
      summary({
        alarming: {
          total: 4,
          lastSkippedAt: '2026-10-09T10:00:00.000Z',
          byReason: [
            { reason: 'schema_mismatch', count: 3, lastSkippedAt: null },
            { reason: 'launch_failed', count: 1, lastSkippedAt: null },
          ],
        },
      })
    );
    render(<WorkflowLaunchSkipBanner workflowId={WORKFLOW_ID} isPublished />);
    await waitFor(() => expect(document.getElementById('workflow-launch-skip-banner')).toBeInTheDocument());

    expect(screen.getByText('Skipped 4 events in the last 7 days — Event payload does not match schema (3), Launch failed (1)')).toBeInTheDocument();
    expect(screen.getByText('Last skipped rel(2026-10-09T10:00:00.000Z)')).toBeInTheDocument();
  });

  it('uses the singular form for one skipped event', async () => {
    actionMocks.getWorkflowLaunchSkipSummaryAction.mockResolvedValue(
      summary({ alarming: { total: 1, lastSkippedAt: null, byReason: [{ reason: 'launch_failed', count: 1, lastSkippedAt: null }] } })
    );
    render(<WorkflowLaunchSkipBanner workflowId={WORKFLOW_ID} isPublished />);
    await waitFor(() => expect(screen.getByText(/^Skipped 1 event in the last 7 days/)).toBeInTheDocument());
  });

  it('refetches on window focus and opens the drawer from the view button', async () => {
    actionMocks.getWorkflowLaunchSkipSummaryAction.mockResolvedValue(
      summary({ alarming: { total: 2, lastSkippedAt: null, byReason: [{ reason: 'launch_failed', count: 2, lastSkippedAt: null }] } })
    );
    render(<WorkflowLaunchSkipBanner workflowId={WORKFLOW_ID} isPublished />);
    await waitFor(() => expect(document.getElementById('workflow-launch-skips-view')).toBeInTheDocument());
    expect(actionMocks.getWorkflowLaunchSkipSummaryAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(actionMocks.getWorkflowLaunchSkipSummaryAction).toHaveBeenCalledTimes(2));

    fireEvent.click(document.getElementById('workflow-launch-skips-view') as HTMLElement);
    await waitFor(() => expect(document.getElementById('workflow-launch-skips-drawer')).toBeInTheDocument());
  });
});

describe('WorkflowLaunchSkipsDrawer', () => {
  const renderOpen = () => render(<WorkflowLaunchSkipsDrawer workflowId={WORKFLOW_ID} isOpen onClose={vi.fn()} />);

  beforeEach(() => {
    actionMocks.getWorkflowLaunchSkipSummaryAction.mockResolvedValue(
      summary({
        alarming: { total: 1, lastSkippedAt: skipItem.createdAt, byReason: [{ reason: 'schema_mismatch', count: 1, lastSkippedAt: skipItem.createdAt }] },
        intentional: { total: 2, lastSkippedAt: skipItem.createdAt, byReason: [{ reason: 'paused', count: 2, lastSkippedAt: skipItem.createdAt }] },
      })
    );
    actionMocks.listWorkflowLaunchSkipsPagedAction.mockResolvedValue({ items: [skipItem], totalItems: 1 });
  });

  it('shows human columns only (no id columns) and the display name instead of ids', async () => {
    renderOpen();
    await waitFor(() => expect(screen.getByTestId('row-skip-1')).toBeInTheDocument());

    const headers = within(document.getElementById('workflow-launch-skips-table') as HTMLElement)
      .getAllByRole('columnheader')
      .map((header) => header.textContent);
    expect(headers).toEqual(['Received', 'Event', 'Reason', 'Message']);
    expect(screen.getByText('Ticket created')).toBeInTheDocument();
    expect(screen.queryByText(skipItem.eventId)).not.toBeInTheDocument();
    expect(screen.queryByText(skipItem.skipId)).not.toBeInTheDocument();
  });

  it('requests the default 7-day alarming view', async () => {
    renderOpen();
    await waitFor(() => expect(actionMocks.listWorkflowLaunchSkipsPagedAction).toHaveBeenCalled());
    const input = actionMocks.listWorkflowLaunchSkipsPagedAction.mock.calls[0][0];
    expect(input).toMatchObject({ workflowId: WORKFLOW_ID, intentional: false, page: 1, pageSize: 10 });
    expect(input).not.toHaveProperty('reason');
    const spanMs = Date.now() - new Date(input.from).getTime();
    expect(Math.abs(spanMs - 7 * 24 * 60 * 60 * 1000)).toBeLessThan(60_000);
  });

  it('passes the selected window to both actions', async () => {
    renderOpen();
    await waitFor(() => expect(actionMocks.listWorkflowLaunchSkipsPagedAction).toHaveBeenCalled());
    actionMocks.listWorkflowLaunchSkipsPagedAction.mockClear();
    actionMocks.getWorkflowLaunchSkipSummaryAction.mockClear();

    fireEvent.change(screen.getByTestId('workflow-launch-skips-window'), { target: { value: '24h' } });

    await waitFor(() => expect(actionMocks.listWorkflowLaunchSkipsPagedAction).toHaveBeenCalled());
    const listInput = actionMocks.listWorkflowLaunchSkipsPagedAction.mock.calls[0][0];
    const summaryInput = actionMocks.getWorkflowLaunchSkipSummaryAction.mock.calls[0][0];
    for (const input of [listInput, summaryInput]) {
      expect(Math.abs(Date.now() - new Date(input.from).getTime() - 24 * 60 * 60 * 1000)).toBeLessThan(60_000);
    }
  });

  it('passes the reason filter and resets paging', async () => {
    renderOpen();
    await waitFor(() => expect(screen.getByTestId('row-skip-1')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('next-page'));
    await waitFor(() =>
      expect(actionMocks.listWorkflowLaunchSkipsPagedAction).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }))
    );

    fireEvent.change(screen.getByTestId('workflow-launch-skips-reason'), { target: { value: 'schema_mismatch' } });
    await waitFor(() =>
      expect(actionMocks.listWorkflowLaunchSkipsPagedAction).toHaveBeenLastCalledWith(
        expect.objectContaining({ reason: 'schema_mismatch', page: 1, intentional: false })
      )
    );
  });

  it('switches to the intentional group', async () => {
    renderOpen();
    await waitFor(() => expect(screen.getByTestId('row-skip-1')).toBeInTheDocument());
    fireEvent.click(document.getElementById('workflow-launch-skips-group-guarded') as HTMLElement);
    await waitFor(() =>
      expect(actionMocks.listWorkflowLaunchSkipsPagedAction).toHaveBeenLastCalledWith(expect.objectContaining({ intentional: true, page: 1 }))
    );
    await waitFor(() =>
      expect(within(document.getElementById('workflow-launch-skips-summary') as HTMLElement).getByText('Workflow paused')).toBeInTheDocument()
    );
  });

  it('expands a row to show the full message, issue paths, and a link carrying the event id', async () => {
    renderOpen();
    await waitFor(() => expect(screen.getByTestId('row-skip-1')).toBeInTheDocument());
    expect(screen.queryByTestId('launch-skip-expanded')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('row-skip-1'));
    const expanded = await screen.findByTestId('launch-skip-expanded');
    expect(within(expanded).getByText('ticket.id')).toBeInTheDocument();
    expect(within(expanded).getByText(/Required/)).toBeInTheDocument();
    expect(within(expanded).getByText('Open event')).toHaveAttribute(
      'href',
      `/msp/workflow-control?section=events&eventId=${skipItem.eventId}`
    );

    fireEvent.click(screen.getByTestId('row-skip-1'));
    await waitFor(() => expect(screen.queryByTestId('launch-skip-expanded')).not.toBeInTheDocument());
  });
});
