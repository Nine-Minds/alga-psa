/* @vitest-environment jsdom */

import React, { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { IExtendedWorkItem } from '@alga-psa/types';

const fetchServicesForTimeEntry = vi.fn();
const fetchTaxRegions = vi.fn();
const fetchClientTaxRateForWorkItem = vi.fn();
const fetchScheduleEntryForWorkItem = vi.fn();
const resolveDefaultTicketTimeEntryService = vi.fn();
const getClientIdForWorkItem = vi.fn();
const getSchedulingClientById = vi.fn();

vi.mock('../src/actions/timeEntryActions', () => ({
  fetchServicesForTimeEntry: (...args: unknown[]) => fetchServicesForTimeEntry(...args),
  fetchTaxRegions: (...args: unknown[]) => fetchTaxRegions(...args),
  fetchClientTaxRateForWorkItem: (...args: unknown[]) => fetchClientTaxRateForWorkItem(...args),
  fetchScheduleEntryForWorkItem: (...args: unknown[]) => fetchScheduleEntryForWorkItem(...args),
  resolveDefaultTicketTimeEntryService: (...args: unknown[]) => resolveDefaultTicketTimeEntryService(...args),
}));

vi.mock('../src/actions/clientInteractionLookupActions', () => ({
  getSchedulingClientById: (...args: unknown[]) => getSchedulingClientById(...args),
}));

vi.mock('../src/lib/contractLineDisambiguation', () => ({
  getClientIdForWorkItem: (...args: unknown[]) => getClientIdForWorkItem(...args),
}));

const { translate } = vi.hoisted(() => ({
  translate: (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? _key,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: translate,
  }),
}));

import { TimeEntryProvider, useTimeEntry } from '../src/components/time-management/time-entry/time-sheet/TimeEntryProvider';

const services = [
  { id: 'svc-a', name: 'Service A', type: 'hourly', tax_rate_id: null, tax_percentage: null },
  { id: 'svc-b', name: 'Service B', type: 'hourly', tax_rate_id: null, tax_percentage: null },
];

type InitParams = Parameters<ReturnType<typeof useTimeEntry>['initializeEntries']>[0];

const ticketWorkItem: Omit<IExtendedWorkItem, 'tenant'> = {
  work_item_id: 'ticket-1',
  type: 'ticket',
  name: 'Test Ticket',
};

function Harness({ params }: { params: InitParams }) {
  const { entries, initializeEntries } = useTimeEntry();
  useEffect(() => {
    void initializeEntries(params);
  }, [initializeEntries, params]);
  return <div data-testid="service">{entries[0]?.service_id ?? ''}</div>;
}

function renderProvider(params: InitParams) {
  return render(
    <TimeEntryProvider>
      <Harness params={params} />
    </TimeEntryProvider>
  );
}

describe('TimeEntryProvider default ticket service', () => {
  beforeEach(() => {
    fetchServicesForTimeEntry.mockResolvedValue(services);
    fetchTaxRegions.mockResolvedValue([]);
    fetchClientTaxRateForWorkItem.mockResolvedValue(undefined);
    fetchScheduleEntryForWorkItem.mockResolvedValue(null);
    getClientIdForWorkItem.mockResolvedValue('client-1');
    getSchedulingClientById.mockResolvedValue({ client_id: 'client-1', region_code: null });
    resolveDefaultTicketTimeEntryService.mockResolvedValue({ serviceId: 'svc-a', source: 'client' });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('prefills a resolved default for a new ticket entry', async () => {
    renderProvider({
      workItem: ticketWorkItem,
      date: new Date('2026-09-21T09:00:00.000Z'),
      defaultStartTime: new Date('2026-09-21T09:00:00.000Z'),
      defaultEndTime: new Date('2026-09-21T10:00:00.000Z'),
    });

    await waitFor(() => expect(screen.getByTestId('service').textContent).toBe('svc-a'));
    expect(resolveDefaultTicketTimeEntryService).toHaveBeenCalledTimes(1);
  });

  it('prefills a resolved default in the no-default-times branch too', async () => {
    renderProvider({
      workItem: ticketWorkItem,
      date: new Date('2026-09-21T09:00:00.000Z'),
    });

    await waitFor(() => expect(screen.getByTestId('service').textContent).toBe('svc-a'));
  });

  it('does not overwrite an explicitly supplied service', async () => {
    renderProvider({
      workItem: { ...ticketWorkItem, service_id: 'svc-b' },
      date: new Date('2026-09-21T09:00:00.000Z'),
      defaultStartTime: new Date('2026-09-21T09:00:00.000Z'),
      defaultEndTime: new Date('2026-09-21T10:00:00.000Z'),
    });

    await waitFor(() => expect(screen.getByTestId('service').textContent).toBe('svc-b'));
    expect(resolveDefaultTicketTimeEntryService).not.toHaveBeenCalled();
  });

  it('does not overwrite an existing entry being edited', async () => {
    renderProvider({
      workItem: ticketWorkItem,
      date: new Date('2026-09-21T09:00:00.000Z'),
      existingEntries: [{
        entry_id: 'entry-1',
        work_item_id: 'ticket-1',
        work_item_type: 'ticket',
        service_id: 'svc-b',
        start_time: '2026-09-21T09:00:00.000Z',
        end_time: '2026-09-21T10:00:00.000Z',
        created_at: '2026-09-21T09:00:00.000Z',
        updated_at: '2026-09-21T09:00:00.000Z',
      } as any],
    });

    await waitFor(() => expect(screen.getByTestId('service').textContent).toBe('svc-b'));
    expect(resolveDefaultTicketTimeEntryService).not.toHaveBeenCalled();
  });

  it('leaves the service empty when no default resolves', async () => {
    resolveDefaultTicketTimeEntryService.mockResolvedValue({ serviceId: null, source: null });

    renderProvider({
      workItem: ticketWorkItem,
      date: new Date('2026-09-21T09:00:00.000Z'),
      defaultStartTime: new Date('2026-09-21T09:00:00.000Z'),
      defaultEndTime: new Date('2026-09-21T10:00:00.000Z'),
    });

    await waitFor(() => expect(resolveDefaultTicketTimeEntryService).toHaveBeenCalled());
    expect(screen.getByTestId('service').textContent).toBe('');
  });

  it('preserves project-task service prefilling', async () => {
    renderProvider({
      workItem: {
        work_item_id: 'task-1',
        type: 'project_task',
        name: 'Task',
        service_id: 'svc-b',
      },
      date: new Date('2026-09-21T09:00:00.000Z'),
      defaultStartTime: new Date('2026-09-21T09:00:00.000Z'),
      defaultEndTime: new Date('2026-09-21T10:00:00.000Z'),
    });

    await waitFor(() => expect(screen.getByTestId('service').textContent).toBe('svc-b'));
    expect(resolveDefaultTicketTimeEntryService).not.toHaveBeenCalled();
  });
});
