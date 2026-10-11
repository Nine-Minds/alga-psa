/**
 * @vitest-environment jsdom
 */
import { createElement } from 'react';
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TimeEntryProvider,
  useTimeEntry,
} from '../src/components/time-management/time-entry/time-sheet/TimeEntryProvider';

const {
  fetchServicesForTimeEntry,
  fetchTaxRegions,
  fetchScheduleEntryForWorkItem,
  getClientIdForWorkItem,
  getSchedulingClientById,
} = vi.hoisted(() => ({
  fetchServicesForTimeEntry: vi.fn(),
  fetchTaxRegions: vi.fn(),
  fetchScheduleEntryForWorkItem: vi.fn(),
  getClientIdForWorkItem: vi.fn(),
  getSchedulingClientById: vi.fn(),
}));

vi.mock('../src/actions/timeEntryActions', () => ({
  fetchServicesForTimeEntry,
  fetchTaxRegions,
  fetchScheduleEntryForWorkItem,
  fetchClientTaxRateForWorkItem: vi.fn(),
}));

vi.mock('../src/actions/clientInteractionLookupActions', () => ({
  getSchedulingClientById,
}));

vi.mock('../src/lib/contractLineDisambiguation', () => ({
  getClientIdForWorkItem,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  getErrorMessage: (value: unknown) => String(value),
  isActionMessageError: () => false,
  isActionPermissionError: () => false,
}));

type TimeEntryContext = ReturnType<typeof useTimeEntry>;

let context: TimeEntryContext | null = null;

function Harness(): null {
  context = useTimeEntry();
  return null;
}

// The provider's context value is rebuilt on every state dispatch, so the
// snapshot captured before an update is stale; read through the latest mount.
function renderProvider(): () => TimeEntryContext {
  render(createElement(TimeEntryProvider, null, createElement(Harness)));
  return () => {
    if (!context) {
      throw new Error('TimeEntryProvider did not mount');
    }
    return context;
  };
}

function ticketWorkItem(overrides: Record<string, unknown> = {}): any {
  return {
    work_item_id: 'ticket-1',
    type: 'ticket',
    name: 'Ticket 1',
    description: 'Worked on issue',
    ...overrides,
  };
}

const DATE = new Date('2026-01-05T00:00:00.000Z');

beforeEach(() => {
  context = null;
  fetchServicesForTimeEntry.mockResolvedValue([]);
  fetchTaxRegions.mockResolvedValue([]);
  fetchScheduleEntryForWorkItem.mockResolvedValue(null);
  getClientIdForWorkItem.mockResolvedValue(null);
  getSchedulingClientById.mockResolvedValue(null);
});

describe('TimeEntryProvider new-entry initialization', () => {
  it('copies the work-item description into notes when explicit default times are supplied', async () => {
    const getContext = renderProvider();

    await act(async () => {
      await getContext().initializeEntries({
        defaultStartTime: new Date('2026-01-05T10:00:00.000Z'),
        defaultEndTime: new Date('2026-01-05T11:00:00.000Z'),
        workItem: ticketWorkItem({ description: '  Printer offline on duplex jobs  ' }),
        date: DATE,
      });
    });

    const { entries } = getContext();
    expect(entries).toHaveLength(1);
    expect(entries[0].isNew).toBe(true);
    expect(entries[0].notes).toBe('  Printer offline on duplex jobs  ');
  });

  it('copies the work-item description into notes when the default time window is derived', async () => {
    const getContext = renderProvider();

    await act(async () => {
      await getContext().initializeEntries({
        workItem: ticketWorkItem({ description: 'Worked on issue' }),
        date: DATE,
      });
    });

    const { entries } = getContext();
    expect(entries).toHaveLength(1);
    expect(entries[0].isNew).toBe(true);
    expect(entries[0].notes).toBe('Worked on issue');
  });

  it('initializes notes to an empty string when the work-item description is nullish', async () => {
    const getExplicitContext = renderProvider();

    await act(async () => {
      await getExplicitContext().initializeEntries({
        defaultStartTime: new Date('2026-01-05T10:00:00.000Z'),
        defaultEndTime: new Date('2026-01-05T11:00:00.000Z'),
        workItem: ticketWorkItem({ description: undefined }),
        date: DATE,
      });
    });

    expect(getExplicitContext().entries[0].notes).toBe('');

    const getFallbackContext = renderProvider();

    await act(async () => {
      await getFallbackContext().initializeEntries({
        workItem: ticketWorkItem({ description: null }),
        date: DATE,
      });
    });

    expect(getFallbackContext().entries[0].notes).toBe('');
  });

  it('preserves the saved notes of an existing entry instead of the work-item description', async () => {
    const getContext = renderProvider();

    await act(async () => {
      await getContext().initializeEntries({
        existingEntries: [
          {
            entry_id: 'entry-1',
            work_item_id: 'ticket-1',
            work_item_type: 'ticket',
            notes: 'Saved note from before',
            start_time: '2026-01-05T10:00:00.000Z',
            end_time: '2026-01-05T11:00:00.000Z',
            created_at: '2026-01-05T10:00:00.000Z',
            updated_at: '2026-01-05T10:00:00.000Z',
            tax_region: null,
          },
        ] as any,
        workItem: ticketWorkItem({ description: 'A newer work-item description' }),
        date: DATE,
      });
    });

    const { entries } = getContext();
    expect(entries).toHaveLength(1);
    expect(entries[0].isNew).toBe(false);
    expect(entries[0].notes).toBe('Saved note from before');
  });
});
