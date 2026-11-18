// @vitest-environment jsdom
/**
 * The time-entry Service field is a searchable picker (same convention as the ticket
 * client picker): type to filter, choose with a click, "No services found" when empty.
 * These tests drive the real SearchableSelect through the real TimeEntryEditForm.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/scheduling/lib/contractLineDisambiguation', () => ({
  getClientIdForWorkItem: vi.fn().mockResolvedValue(null),
  getEligibleContractLinesForUI: vi.fn().mockResolvedValue([]),
}));
vi.mock('@alga-psa/scheduling/actions/clientInteractionLookupActions', () => ({
  getSchedulingClientById: vi.fn().mockResolvedValue(null),
}));
vi.mock('@alga-psa/ui/components/DatePicker', () => ({ DatePicker: () => null }));
vi.mock('@alga-psa/ui/lib/i18n/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/ui/lib/i18n/client')>()),
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? '',
  }),
  useFormatters: () => ({ formatDate: (value: Date | string) => new Date(value).toISOString().slice(0, 10) }),
}));

// cmdk observes its list and scrolls the active item; jsdom has neither API.
if (!('ResizeObserver' in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

import TimeEntryEditForm from '@alga-psa/scheduling/components/time-management/time-entry/time-sheet/TimeEntryEditForm';

const services = [
  { id: 'service-1', name: 'Network Support', type: 'Time', tax_rate_id: null, tax_percentage: null },
  { id: 'service-2', name: 'On-site Visit', type: 'Time', tax_rate_id: null, tax_percentage: null },
  { id: 'service-3', name: 'Help Desk', type: 'Time', tax_rate_id: null, tax_percentage: null },
];

const savedEntry: any = {
  entry_id: 'entry-1',
  work_item_id: 'ticket-1',
  work_item_type: 'ticket',
  start_time: '2026-02-10T12:00:00.000Z',
  end_time: '2026-02-10T13:00:00.000Z',
  billable_duration: 60,
  notes: '',
  user_id: 'user-1',
  time_sheet_id: 'timesheet-1',
  approval_status: 'DRAFT',
  service_id: 'service-1',
  isNew: false,
  isDirty: false,
};

// Holds the entry like the real parent does, so a choice round-trips back into the picker.
function Harness({ initial, onUpdate, isEditable = true }: { initial: any; onUpdate: (index: number, entry: any) => void; isEditable?: boolean }) {
  const [entry, setEntry] = React.useState(initial);
  return (
    <TimeEntryEditForm
      id="entry"
      entry={entry}
      index={0}
      isEditable={isEditable}
      services={services}
      taxRegions={[]}
      timeInputs={{}}
      totalDuration={60}
      onSave={vi.fn()}
      onDelete={vi.fn()}
      onUpdateEntry={(index: number, updated: any) => {
        onUpdate(index, updated);
        setEntry(updated);
      }}
      onUpdateTimeInputs={vi.fn()}
      isNewEntry={false}
    />
  );
}

function renderForm(initial: any = savedEntry, isEditable = true) {
  const onUpdate = vi.fn();
  render(<Harness initial={initial} onUpdate={onUpdate} isEditable={isEditable} />);
  return { onUpdate };
}

const trigger = () => document.getElementById('entry-service-0') as HTMLButtonElement;
const optionLabels = () => screen.queryAllByRole('option').map((option) => option.textContent);
const search = (term: string) =>
  fireEvent.change(screen.getByPlaceholderText('Search services...'), { target: { value: term } });
const choose = (name: string) => {
  fireEvent.click(trigger());
  fireEvent.click(screen.getByRole('option', { name }));
};

afterEach(() => {
  cleanup();
});

describe('TimeEntryEditForm service picker', () => {
  it('is a combobox tied to the Service label that shows the saved service', () => {
    renderForm();

    expect(trigger().getAttribute('role')).toBe('combobox');
    expect(screen.getByLabelText(/^Service/)).toBe(trigger());
    expect(trigger().textContent).toContain('Network Support');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('lists every service and filters as you type, ignoring case', () => {
    renderForm();
    fireEvent.click(trigger());

    expect(optionLabels()).toEqual(['Network Support', 'On-site Visit', 'Help Desk']);

    search('DESK');
    expect(optionLabels()).toEqual(['Help Desk']);

    search('on-site');
    expect(optionLabels()).toEqual(['On-site Visit']);
  });

  it('shows the empty message when nothing matches', () => {
    renderForm();
    fireEvent.click(trigger());

    search('zzz');
    expect(optionLabels()).toEqual([]);
    expect(within(screen.getByRole('listbox')).getByText('No services found')).toBeTruthy();
  });

  it('choosing a filtered result updates the entry, marks a saved entry dirty, and shows the new service', () => {
    const { onUpdate } = renderForm();
    fireEvent.click(trigger());

    search('desk');
    fireEvent.click(screen.getByRole('option', { name: 'Help Desk' }));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith(0, expect.objectContaining({ entry_id: 'entry-1', service_id: 'service-3', isDirty: true }));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger().textContent).toContain('Help Desk');
  });

  it('does not mark a new, unsaved entry dirty when a service is chosen', () => {
    const { onUpdate } = renderForm({ ...savedEntry, entry_id: undefined, isNew: true });

    choose('On-site Visit');

    expect(onUpdate).toHaveBeenCalledWith(0, expect.objectContaining({ service_id: 'service-2', isDirty: false }));
  });

  it('tracks whether a prefilled service was overridden', () => {
    const prefilled = {
      ...savedEntry,
      service_id: 'service-2',
      _isServicePrefilled: true,
      _originalServiceId: 'service-1',
      _serviceSource: 'task',
    };
    const { onUpdate } = renderForm(prefilled);

    choose('Network Support');
    expect(onUpdate).toHaveBeenLastCalledWith(0, expect.objectContaining({ service_id: 'service-1', _serviceOverridden: false }));

    choose('Help Desk');
    expect(onUpdate).toHaveBeenLastCalledWith(0, expect.objectContaining({ service_id: 'service-3', _serviceOverridden: true }));
  });

  it('shows the placeholder, not the raw id, for a saved service that is no longer listed', () => {
    renderForm({ ...savedEntry, service_id: 'service-gone' });

    expect(trigger().textContent).toContain('Select a service');
    expect(trigger().textContent).not.toContain('service-gone');
  });

  it('cannot be opened when the entry is not editable', () => {
    const { onUpdate } = renderForm(savedEntry, false);

    expect(trigger().disabled).toBe(true);
    fireEvent.click(trigger());

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
