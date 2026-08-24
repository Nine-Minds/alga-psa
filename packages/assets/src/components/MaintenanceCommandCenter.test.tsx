/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SWRConfig } from 'swr';

const listMaintenanceOccurrences = vi.fn();

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));

vi.mock('../actions/assetActions', () => ({
  listMaintenanceOccurrences: (...args: unknown[]) => listMaintenanceOccurrences(...args),
  getMaintenanceAggregates: vi.fn(async () => ({ overdue: 0, due_today: 0, upcoming_7d: 0, open_maintenance_tickets: 0, compliance_90d: 0 })),
  completeOccurrence: vi.fn(),
  createOccurrenceTicket: vi.fn(),
  setSchedulePaused: vi.fn(),
  skipOccurrence: vi.fn(),
}));

vi.mock('../context/AssetCrossFeatureContext', () => ({
  useAssetCrossFeature: () => ({ renderQuickAddTicket: () => null }),
}));

vi.mock('./MaintenanceCompletionDialog', () => ({
  MaintenanceCompletionDialog: () => null,
  checklistItems: () => [],
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children }: any) => <section>{children}</section>,
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <header>{children}</header>,
  CardTitle: ({ children }: any) => <h2>{children}</h2>,
}));
vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));
vi.mock('@alga-psa/ui/components/Label', () => ({ Label: ({ children }: any) => <label>{children}</label> }));
vi.mock('@alga-psa/ui/components/TextArea', () => ({ TextArea: (props: any) => <textarea {...props} /> }));
vi.mock('@alga-psa/ui/components/Badge', () => ({ Badge: ({ children }: any) => <span>{children}</span> }));
vi.mock('@alga-psa/core', () => ({
  formatCalendarDate: (value: string) => value,
  toCalendarDateString: (value: string) => value,
  toCalendarDisplayDate: (value: string) => new Date(value),
}));

import { MaintenanceCommandCenter } from './MaintenanceCommandCenter';

const completedOccurrence = {
  occurrence_id: '00000000-0000-4000-8000-000000000001',
  tenant: '00000000-0000-4000-8000-000000000002',
  schedule_id: '00000000-0000-4000-8000-000000000003',
  asset_id: '00000000-0000-4000-8000-000000000004',
  schedule_name: 'Completed workstation cleaning',
  asset_name: 'History workstation',
  due_date: '2026-08-20T00:00:00.000Z',
  status: 'completed',
  maintenance_type: 'preventive',
  frequency: 'monthly',
  frequency_interval: 1,
};

describe('MaintenanceCommandCenter', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not carry an invisible work-queue search filter into History', async () => {
    listMaintenanceOccurrences.mockImplementation(async (filters: { search?: string }) => ({
      occurrences: filters.search ? [] : [completedOccurrence],
      total: filters.search ? 0 : 1,
    }));

    const user = userEvent.setup();
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <MaintenanceCommandCenter />
      </SWRConfig>,
    );

    const search = await screen.findByPlaceholderText('Search plans, assets, or clients');
    await user.type(search, 'no matching queue occurrence');
    await waitFor(() => expect(screen.getByText('No maintenance occurrences match these filters. Clear a filter or widen the due-date range.')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: /History/ }));
    await waitFor(() => expect(screen.getAllByText('Completed workstation cleaning').length).toBeGreaterThan(0));
    await waitFor(() => expect(listMaintenanceOccurrences).toHaveBeenLastCalledWith({ limit: 100 }));
  });
});
