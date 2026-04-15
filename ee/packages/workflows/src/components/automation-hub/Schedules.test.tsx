/// <reference types="@testing-library/jest-dom/vitest" />
/** @vitest-environment jsdom */

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({
  listWorkflowSchedulesAction: vi.fn(),
  listWorkflowScheduleBusinessHoursAction: vi.fn(),
  listWorkflowDefinitionsPagedAction: vi.fn(),
  getWorkflowScheduleAction: vi.fn(),
  pauseWorkflowScheduleAction: vi.fn(),
  resumeWorkflowScheduleAction: vi.fn(),
  deleteWorkflowScheduleAction: vi.fn(),
  createWorkflowScheduleAction: vi.fn(),
  updateWorkflowScheduleAction: vi.fn(),
  getWorkflowSchemaAction: vi.fn()
}));

const router = {
  push: vi.fn(),
  replace: vi.fn()
};

let currentSearchParams = new URLSearchParams('tab=schedules');

const workflowFixtures = [
  {
    workflow_id: '00000000-0000-0000-0000-000000000001',
    name: 'Billing sync',
    published_version: 2,
    payload_schema_mode: 'pinned',
    payload_schema_ref: 'schema.billing'
  },
  {
    workflow_id: '00000000-0000-0000-0000-000000000002',
    name: 'Ticket follow-up',
    published_version: 1,
    payload_schema_mode: 'pinned',
    payload_schema_ref: 'schema.ticket'
  },
  {
    workflow_id: '00000000-0000-0000-0000-000000000003',
    name: 'Legacy inferred',
    published_version: 1,
    payload_schema_mode: 'inferred',
    payload_schema_ref: null
  }
];

const initialScheduleFixtures: Array<Record<string, any>> = [
  {
    id: '10000000-0000-0000-0000-000000000001',
    tenant_id: 'tenant-1',
    workflow_id: workflowFixtures[0].workflow_id,
    workflow_version: 2,
    name: 'Weekday billing',
    workflow_name: workflowFixtures[0].name,
    trigger_type: 'recurring',
    cron: '0 9 * * 1-5',
    timezone: 'America/New_York',
    run_at: null,
    next_fire_at: '2026-03-09T14:00:00.000Z',
    last_fire_at: '2026-03-08T14:00:00.000Z',
    payload_json: { customerId: 'C-100', notify: true },
    enabled: true,
    status: 'scheduled',
    last_error: null,
    created_at: '2026-03-08T10:00:00.000Z',
    updated_at: '2026-03-08T10:00:00.000Z'
  },
  {
    id: '10000000-0000-0000-0000-000000000002',
    tenant_id: 'tenant-1',
    workflow_id: workflowFixtures[0].workflow_id,
    workflow_version: 2,
    name: 'Month-end billing',
    workflow_name: workflowFixtures[0].name,
    trigger_type: 'schedule',
    cron: null,
    timezone: null,
    run_at: '2026-03-31T12:00:00.000Z',
    next_fire_at: null,
    last_fire_at: null,
    payload_json: { customerId: 'C-200', notify: false },
    enabled: false,
    status: 'paused',
    last_error: null,
    created_at: '2026-03-08T10:00:00.000Z',
    updated_at: '2026-03-08T10:00:00.000Z'
  },
  {
    id: '10000000-0000-0000-0000-000000000003',
    tenant_id: 'tenant-1',
    workflow_id: workflowFixtures[1].workflow_id,
    workflow_version: 1,
    name: 'Ticket reminder',
    workflow_name: workflowFixtures[1].name,
    trigger_type: 'recurring',
    cron: '0 10 * * *',
    timezone: 'UTC',
    run_at: null,
    next_fire_at: '2026-03-09T10:00:00.000Z',
    last_fire_at: '2026-03-08T10:00:00.000Z',
    payload_json: { ticketId: 'T-100' },
    enabled: true,
    status: 'failed',
    last_error: 'Schema mismatch after publish',
    created_at: '2026-03-08T10:00:00.000Z',
    updated_at: '2026-03-08T10:00:00.000Z'
  }
];

let scheduleFixtures = initialScheduleFixtures.map((schedule) => ({ ...schedule }));

const billingSchema = {
  type: 'object',
  required: ['customerId'],
  properties: {
    customerId: { type: 'string', title: 'customerId' },
    notify: { type: 'boolean', title: 'notify' }
  }
};

const ticketSchema = {
  type: 'object',
  required: ['ticketId'],
  properties: {
    ticketId: { type: 'string', title: 'ticketId' }
  }
};

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => currentSearchParams
}));

vi.mock('@radix-ui/react-dropdown-menu', () => {
  const passthrough = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  return {
    Root: passthrough,
    Trigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Portal: passthrough,
    Content: passthrough,
    Separator: () => <hr />,
    Item: ({ children, onSelect }: { children: React.ReactNode; onSelect?: () => void }) => (
      <button type="button" onClick={onSelect}>{children}</button>
    )
  };
});

vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    id,
    type = 'button'
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    id?: string;
    type?: 'button' | 'submit' | 'reset';
  }) => (
    <button type={type} onClick={onClick} disabled={disabled} id={id}>
      {children}
    </button>
  )
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>
}));

vi.mock('@alga-psa/ui/components/SearchInput', () => ({
  SearchInput: ({
    value,
    onChange,
    placeholder,
    className
  }: {
    value: string;
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
    placeholder?: string;
    className?: string;
  }) => (
    <input
      aria-label={placeholder ?? className ?? 'search'}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
    />
  )
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({
    value,
    onValueChange,
    options,
    label,
    id,
    disabled
  }: {
    value?: string | null;
    onValueChange: (value: string) => void;
    options: Array<{ value: string; label: React.ReactNode; textValue?: string; disabled?: boolean }>;
    label?: string;
    id?: string;
    disabled?: boolean;
  }) => (
    <label>
      {label ?? id}
      <select
        aria-label={label ?? id ?? 'select'}
        value={value ?? ''}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {typeof option.label === 'string' ? option.label : (option.textValue ?? option.value)}
          </option>
        ))}
      </select>
    </label>
  )
}));

vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: ({
    data,
    columns
  }: {
    data: Array<Record<string, unknown>>;
    columns: Array<{ title: React.ReactNode; dataIndex: string | string[]; render?: (value: unknown, record: Record<string, unknown>, index: number) => React.ReactNode }>;
  }) => (
    <table>
      <thead>
        <tr>
          {columns.map((column, index) => (
            <th key={index}>{column.title}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((record, rowIndex) => (
          <tr key={String(record.id ?? rowIndex)}>
            {columns.map((column, columnIndex) => {
              const value = Array.isArray(column.dataIndex)
                ? column.dataIndex.reduce<unknown>((acc, part) => (acc as any)?.[part], record)
                : (record as any)[column.dataIndex];
              return (
                <td key={columnIndex}>
                  {column.render ? column.render(value, record, rowIndex) : String(value ?? '')}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}));

vi.mock('@alga-psa/ui', () => ({
  DeleteEntityDialog: ({
    isOpen,
    onClose,
    onConfirmDelete,
    entityName
  }: {
    isOpen: boolean;
    onClose: () => void;
    onConfirmDelete: () => void;
    entityName: string;
  }) => isOpen ? (
    <div role="dialog" aria-label="Delete schedule">
      <div>Delete {entityName}</div>
      <button type="button" onClick={onConfirmDelete}>Confirm Delete</button>
      <button type="button" onClick={onClose}>Cancel</button>
    </div>
  ) : null
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({
    isOpen,
    title,
    children
  }: {
    isOpen: boolean;
    title?: string;
    children: React.ReactNode;
  }) => isOpen ? <div role="dialog" aria-label={title}>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({
    label,
    id,
    value,
    onChange,
    type = 'text',
    disabled,
    ...props
  }: {
    label?: string;
    id?: string;
    value?: string;
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
    type?: string;
    disabled?: boolean;
    [key: string]: unknown;
  }) => (
    <label>
      {label ?? id}
      <input
        aria-label={(props['aria-label'] as string | undefined) ?? label ?? id ?? 'input'}
        id={id}
        type={type}
        value={value ?? ''}
        onChange={onChange}
        disabled={disabled}
      />
    </label>
  )
}));

vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: ({
    id,
    value,
    onChange
  }: {
    id?: string;
    value?: string;
    onChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  }) => (
    <textarea aria-label={id ?? 'textarea'} id={id} value={value ?? ''} onChange={onChange} />
  )
}));

vi.mock('@alga-psa/ui/components/TimezonePicker', () => ({
  default: ({
    value,
    onValueChange,
  }: {
    value: string;
    onValueChange: (value: string) => void;
  }) => (
    <label>
      Browse all time zones
      <select
        aria-label="Browse all time zones"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      >
        <option value="UTC">UTC</option>
        <option value="America/New_York">America/New_York</option>
        <option value="America/Chicago">America/Chicago</option>
      </select>
    </label>
  )
}));

vi.mock('@alga-psa/ui/components/Switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked: boolean;
    onCheckedChange: (value: boolean) => void;
    [key: string]: unknown;
  }) => (
    <input
      aria-label={(props['aria-label'] as string | undefined) ?? "switch"}
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange(event.target.checked)}
    />
  )
}));

vi.mock('@alga-psa/workflows/actions', () => ({
  listWorkflowSchedulesAction: actionMocks.listWorkflowSchedulesAction,
  listWorkflowScheduleBusinessHoursAction: actionMocks.listWorkflowScheduleBusinessHoursAction,
  listWorkflowDefinitionsPagedAction: actionMocks.listWorkflowDefinitionsPagedAction,
  getWorkflowScheduleAction: actionMocks.getWorkflowScheduleAction,
  pauseWorkflowScheduleAction: actionMocks.pauseWorkflowScheduleAction,
  resumeWorkflowScheduleAction: actionMocks.resumeWorkflowScheduleAction,
  deleteWorkflowScheduleAction: actionMocks.deleteWorkflowScheduleAction,
  createWorkflowScheduleAction: actionMocks.createWorkflowScheduleAction,
  updateWorkflowScheduleAction: actionMocks.updateWorkflowScheduleAction,
  getWorkflowSchemaAction: actionMocks.getWorkflowSchemaAction
}));

import Schedules from './Schedules';

describe('Schedules', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    currentSearchParams = new URLSearchParams('tab=schedules');
    router.push.mockReset();
    router.replace.mockReset();
    scheduleFixtures = initialScheduleFixtures.map((schedule) => ({ ...schedule }));
    actionMocks.listWorkflowSchedulesAction.mockImplementation(async (input: {
      workflowId?: string;
      status?: string;
      triggerType?: string;
      search?: string;
    }) => {
      const search = (input.search ?? '').toLowerCase();
      const items = scheduleFixtures.filter((schedule) => {
        if (input.workflowId && schedule.workflow_id !== input.workflowId) return false;
        if (input.triggerType && input.triggerType !== 'all' && schedule.trigger_type !== input.triggerType) return false;
        if (input.status && input.status !== 'all') {
          if (input.status === 'enabled' && !schedule.enabled) return false;
          if (input.status !== 'enabled' && schedule.status !== input.status) return false;
        }
        if (search) {
          return schedule.name.toLowerCase().includes(search) || String(schedule.workflow_name ?? '').toLowerCase().includes(search);
        }
        return true;
      });

      return { items };
    });
    actionMocks.listWorkflowDefinitionsPagedAction.mockResolvedValue({ items: workflowFixtures });
    actionMocks.listWorkflowScheduleBusinessHoursAction.mockResolvedValue({
      items: [
        { schedule_id: 'bh-default', schedule_name: 'Default business hours', is_default: true, is_24x7: false },
        { schedule_id: 'bh-night', schedule_name: 'Night shift', is_default: false, is_24x7: false }
      ]
    });
    actionMocks.getWorkflowScheduleAction.mockImplementation(async ({ scheduleId }: { scheduleId: string }) =>
      scheduleFixtures.find((schedule) => schedule.id === scheduleId)
    );
    actionMocks.pauseWorkflowScheduleAction.mockResolvedValue({ ok: true });
    actionMocks.resumeWorkflowScheduleAction.mockResolvedValue({ ok: true });
    actionMocks.deleteWorkflowScheduleAction.mockResolvedValue({ ok: true });
    actionMocks.createWorkflowScheduleAction.mockResolvedValue({ ok: true, schedule: scheduleFixtures[0] });
    actionMocks.updateWorkflowScheduleAction.mockResolvedValue({ ok: true, schedule: scheduleFixtures[0] });
    actionMocks.getWorkflowSchemaAction.mockImplementation(async ({ schemaRef }: { schemaRef: string }) => ({
      schema: schemaRef === 'schema.ticket' ? ticketSchema : billingSchema
    }));
  });

  afterEach(() => {
    cleanup();
    try {
      vi.runOnlyPendingTimers();
    } catch {}
    vi.useRealTimers();
  });

  const renderSchedules = async () => {
    render(<Schedules />);
    await screen.findByText('Weekday billing');
  };

  it('shows schedule name, workflow, trigger type, timing, status, and error columns', async () => {
    await renderSchedules();

    expect(screen.getByText('Schedule')).toBeInTheDocument();
    expect(screen.getByText('Workflow')).toBeInTheDocument();
    expect(screen.getByText('Trigger Type')).toBeInTheDocument();
    expect(screen.getByText('Next Fire / Run At')).toBeInTheDocument();
    expect(screen.getByText('Last Fire')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Last Error')).toBeInTheDocument();
    expect(screen.getByText('Weekday billing')).toBeInTheDocument();
    expect(screen.getAllByText('Billing sync').length).toBeGreaterThan(0);
    expect(screen.getByText('Schema mismatch after publish')).toBeInTheDocument();
  });

  it('shows a filtered recurring schedule as misconfigured instead of falling back to the raw cron next fire time', async () => {
    scheduleFixtures = [
      {
        ...scheduleFixtures[0],
        day_type_filter: 'business',
        next_fire_at: '2026-03-09T14:00:00.000Z',
        next_eligible_fire_at: null,
        calendar_resolution_error: 'Business/non-business day filters require a default business-hours schedule or a specific override.'
      }
    ];

    await renderSchedules();

    expect(screen.getByText('Calendar misconfigured')).toBeInTheDocument();
  });

  it('filters the schedules list by workflow', async () => {
    await renderSchedules();
    const initialCalls = actionMocks.listWorkflowSchedulesAction.mock.calls.length;

    fireEvent.change(screen.getByLabelText('schedules-filter-workflow'), {
      target: { value: workflowFixtures[0].workflow_id }
    });

    await waitFor(() => {
      expect(actionMocks.listWorkflowSchedulesAction).toHaveBeenCalledTimes(initialCalls + 1);
      expect(screen.getByText('Weekday billing')).toBeInTheDocument();
      expect(screen.queryByText('Ticket reminder')).not.toBeInTheDocument();
    });
  });

  it('filters the schedules list by trigger type', async () => {
    await renderSchedules();
    const initialCalls = actionMocks.listWorkflowSchedulesAction.mock.calls.length;

    fireEvent.change(screen.getByLabelText('schedules-filter-trigger'), {
      target: { value: 'schedule' }
    });

    await waitFor(() => {
      expect(actionMocks.listWorkflowSchedulesAction).toHaveBeenCalledTimes(initialCalls + 1);
      expect(screen.getByText('Month-end billing')).toBeInTheDocument();
      expect(screen.queryByText('Weekday billing')).not.toBeInTheDocument();
    });
  });

  it('filters the schedules list by status', async () => {
    await renderSchedules();
    const initialCalls = actionMocks.listWorkflowSchedulesAction.mock.calls.length;

    fireEvent.change(screen.getByLabelText('schedules-filter-status'), {
      target: { value: 'failed' }
    });

    await waitFor(() => {
      expect(actionMocks.listWorkflowSchedulesAction).toHaveBeenCalledTimes(initialCalls + 1);
      expect(screen.getByText('Ticket reminder')).toBeInTheDocument();
      expect(screen.queryByText('Weekday billing')).not.toBeInTheDocument();
    });
  });

  it('matches schedule name and workflow name in text search', async () => {
    await renderSchedules();
    const initialCalls = actionMocks.listWorkflowSchedulesAction.mock.calls.length;

    fireEvent.change(screen.getByPlaceholderText('Search schedules...'), {
      target: { value: 'Billing sync' }
    });

    await waitFor(() => {
      expect(actionMocks.listWorkflowSchedulesAction).toHaveBeenCalledTimes(initialCalls + 1);
      expect(screen.getByText('Weekday billing')).toBeInTheDocument();
      expect(screen.getByText('Month-end billing')).toBeInTheDocument();
      expect(screen.queryByText('Ticket reminder')).not.toBeInTheDocument();
    });
  });

  it('opens the edit dialog with the current schedule values', async () => {
    await renderSchedules();

    const row = screen.getByText('Weekday billing').closest('tr');
    expect(row).not.toBeNull();
    fireEvent.click(within(row as HTMLTableRowElement).getByText('Edit'));

    await screen.findByRole('dialog', { name: 'Edit Schedule' });
    expect(screen.getByLabelText('Schedule name')).toHaveValue('Weekday billing');
    expect(screen.getByLabelText('Trigger type')).toHaveValue('recurring');
    expect(screen.getByLabelText('Frequency')).toHaveValue('weekly');
    expect(screen.getByLabelText('Time')).toHaveValue('09:00');
    expect(screen.getByLabelText('Timezone')).toHaveValue('America/New_York');
    expect(screen.queryByLabelText('Cron')).not.toBeInTheDocument();
  });

  it('pauses a currently enabled schedule from the row action', async () => {
    await renderSchedules();

    const row = screen.getByText('Weekday billing').closest('tr');
    fireEvent.click(within(row as HTMLTableRowElement).getByText('Pause'));

    await waitFor(() => {
      expect(actionMocks.pauseWorkflowScheduleAction).toHaveBeenCalledWith({ scheduleId: '10000000-0000-0000-0000-000000000001' });
    });
  });

  it('resumes a paused schedule from the row action', async () => {
    await renderSchedules();

    const row = screen.getByText('Month-end billing').closest('tr');
    fireEvent.click(within(row as HTMLTableRowElement).getByText('Resume'));

    await waitFor(() => {
      expect(actionMocks.resumeWorkflowScheduleAction).toHaveBeenCalledWith({ scheduleId: '10000000-0000-0000-0000-000000000002' });
    });
  });

  it('deletes a schedule after confirmation', async () => {
    await renderSchedules();

    const row = screen.getByText('Ticket reminder').closest('tr');
    fireEvent.click(within(row as HTMLTableRowElement).getByText('Delete'));
    fireEvent.click(screen.getByText('Confirm Delete'));

    await waitFor(() => {
      expect(actionMocks.deleteWorkflowScheduleAction).toHaveBeenCalledWith({ scheduleId: '10000000-0000-0000-0000-000000000003' });
    });
  });

  it('requires workflow selection and schedule name before create can save', async () => {
    await renderSchedules();

    fireEvent.click(screen.getByText('New Schedule'));
    await screen.findByRole('dialog', { name: 'Create Schedule' });
    expect(screen.getByLabelText('Run at')).toBeInTheDocument();
    expect(screen.getByText('Create Schedule', { selector: 'button' })).toBeDisabled();
  });

  it('shows the runAt input for one-time schedules', async () => {
    await renderSchedules();

    fireEvent.click(screen.getByText('New Schedule'));
    await screen.findByRole('dialog', { name: 'Create Schedule' });
    expect(screen.getByLabelText('Run at')).toBeInTheDocument();
  });

  it('shows the recurring schedule builder and timezone input for recurring schedules', async () => {
    await renderSchedules();

    fireEvent.click(screen.getByText('New Schedule'));
    await screen.findByRole('dialog', { name: 'Create Schedule' });
    fireEvent.change(screen.getByLabelText('Trigger type'), { target: { value: 'recurring' } });

    expect(screen.getByLabelText('Frequency')).toBeInTheDocument();
    expect(screen.getByLabelText('Time')).toBeInTheDocument();
    expect(screen.getByLabelText('Timezone')).toBeInTheDocument();
    expect(screen.getByLabelText('Run on')).toBeInTheDocument();
    expect(screen.getByText(/runs every day at/i)).toBeInTheDocument();
  });

  it('T012: shows recurring day-filter controls and calendar-source options only when relevant, including specific schedule options', async () => {
    await renderSchedules();

    fireEvent.click(screen.getByText('New Schedule'));
    await screen.findByRole('dialog', { name: 'Create Schedule' });
    fireEvent.change(screen.getByLabelText('Trigger type'), { target: { value: 'recurring' } });

    expect(screen.getByLabelText('Run on')).toHaveValue('any');
    expect(screen.queryByLabelText('Calendar source')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Business-hours schedule')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Run on'), { target: { value: 'business' } });
    expect(screen.getByLabelText('Calendar source')).toBeInTheDocument();
    expect(screen.queryByLabelText('Business-hours schedule')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Calendar source'), { target: { value: 'specific' } });
    const scheduleSelect = screen.getByLabelText('Business-hours schedule');
    expect(scheduleSelect).toBeInTheDocument();
    expect(within(scheduleSelect).getByRole('option', { name: /default business hours/i })).toBeInTheDocument();
    expect(within(scheduleSelect).getByRole('option', { name: /night shift/i })).toBeInTheDocument();
  });

  it('annotates and disables tenant default calendar source when no tenant default business-hours schedule exists', async () => {
    actionMocks.listWorkflowScheduleBusinessHoursAction.mockResolvedValueOnce({
      items: [
        { schedule_id: 'bh-night', schedule_name: 'Night shift', is_default: false, is_24x7: false }
      ]
    });

    await renderSchedules();

    fireEvent.click(screen.getByText('New Schedule'));
    await screen.findByRole('dialog', { name: 'Create Schedule' });
    fireEvent.change(screen.getByLabelText('Trigger type'), { target: { value: 'recurring' } });
    fireEvent.change(screen.getByLabelText('Run on'), { target: { value: 'business' } });

    const calendarSource = screen.getByLabelText('Calendar source');
    expect(calendarSource).toBeInTheDocument();
    expect(within(calendarSource).getByRole('option', { name: /tenant default business hours \(not configured\)/i })).toBeDisabled();
    expect(screen.getByText('No tenant default business-hours schedule is configured yet. Choose a specific business-hours schedule or set a tenant default first.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Workflow'), {
      target: { value: workflowFixtures[0].workflow_id }
    });
    await screen.findByLabelText('customerId');
    fireEvent.change(screen.getByLabelText('Schedule name'), { target: { value: 'Filtered schedule without default' } });
    fireEvent.change(screen.getByLabelText('customerId'), { target: { value: 'C-510' } });

    expect(screen.getByText('Create Schedule', { selector: 'button' })).toBeDisabled();

    fireEvent.change(calendarSource, { target: { value: 'specific' } });
    const scheduleSelect = screen.getByLabelText('Business-hours schedule');
    fireEvent.change(scheduleSelect, { target: { value: 'bh-night' } });

    await waitFor(() => {
      expect(screen.getByText('Create Schedule', { selector: 'button' })).toBeEnabled();
    });
  });

  it('keeps UTC in the common timezone dropdown for new recurring schedules', async () => {
    await renderSchedules();

    fireEvent.click(screen.getByText('New Schedule'));
    await screen.findByRole('dialog', { name: 'Create Schedule' });
    fireEvent.change(screen.getByLabelText('Trigger type'), { target: { value: 'recurring' } });

    expect(screen.getByLabelText('Timezone')).toHaveValue('UTC');
    expect(screen.queryByLabelText('Custom timezone')).not.toBeInTheDocument();
  });

  it('updates the recurrence summary when a custom timezone is entered', async () => {
    await renderSchedules();

    fireEvent.click(screen.getByText('New Schedule'));
    await screen.findByRole('dialog', { name: 'Create Schedule' });
    fireEvent.change(screen.getByLabelText('Trigger type'), { target: { value: 'recurring' } });
    fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: '__custom__' } });
    fireEvent.change(screen.getByLabelText('Custom timezone'), { target: { value: 'Pacific/Niue' } });

    expect(screen.getByText('Runs every day at 9:00 AM Pacific/Niue')).toBeInTheDocument();
  });

  it('updates the recurrence summary when a non-common timezone is chosen from browse all', async () => {
    await renderSchedules();

    fireEvent.click(screen.getByText('New Schedule'));
    await screen.findByRole('dialog', { name: 'Create Schedule' });
    fireEvent.change(screen.getByLabelText('Trigger type'), { target: { value: 'recurring' } });
    fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: '__browse_all__' } });
    fireEvent.change(screen.getByLabelText('Browse all time zones'), { target: { value: 'America/Chicago' } });

    expect(screen.getByText('Runs every day at 9:00 AM America/Chicago')).toBeInTheDocument();
  });

  it('creates a recurring schedule from the builder and saves the generated cron string', async () => {
    await renderSchedules();

    fireEvent.click(screen.getByText('New Schedule'));
    await screen.findByRole('dialog', { name: 'Create Schedule' });
    fireEvent.change(screen.getByLabelText('Trigger type'), { target: { value: 'recurring' } });
    fireEvent.change(screen.getByLabelText('Workflow'), {
      target: { value: workflowFixtures[0].workflow_id }
    });
    await screen.findByLabelText('customerId');

    fireEvent.change(screen.getByLabelText('Schedule name'), { target: { value: 'Daily billing sync' } });
    fireEvent.change(screen.getByLabelText('customerId'), { target: { value: 'C-300' } });
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '06:45' } });
    fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: 'America/Chicago' } });
    fireEvent.click(screen.getByText('Create Schedule', { selector: 'button' }));

    await waitFor(() => {
      expect(actionMocks.createWorkflowScheduleAction).toHaveBeenCalledWith(expect.objectContaining({
        workflowId: workflowFixtures[0].workflow_id,
        name: 'Daily billing sync',
        triggerType: 'recurring',
        cron: '45 6 * * *',
        timezone: 'America/Chicago',
        payload: {
          customerId: 'C-300',
          notify: false,
        },
      }));
    });
  });

  it('requires at least one weekday for weekly recurring schedules in builder mode', async () => {
    await renderSchedules();

    fireEvent.click(screen.getByText('New Schedule'));
    await screen.findByRole('dialog', { name: 'Create Schedule' });
    fireEvent.change(screen.getByLabelText('Trigger type'), { target: { value: 'recurring' } });
    fireEvent.change(screen.getByLabelText('Workflow'), {
      target: { value: workflowFixtures[0].workflow_id }
    });
    await screen.findByLabelText('customerId');

    fireEvent.change(screen.getByLabelText('Schedule name'), { target: { value: 'Weekly billing sync' } });
    fireEvent.change(screen.getByLabelText('customerId'), { target: { value: 'C-400' } });
    fireEvent.change(screen.getByLabelText('Frequency'), { target: { value: 'weekly' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mon' }));

    await waitFor(() => {
      expect(screen.getByText('Choose at least one weekday.')).toBeInTheDocument();
      expect(screen.getByText('Create Schedule', { selector: 'button' })).toBeDisabled();
    });
  });

  it('renders schema-driven form fields for payload editing', async () => {
    await renderSchedules();

    fireEvent.click(screen.getByText('New Schedule'));
    await screen.findByRole('dialog', { name: 'Create Schedule' });
    fireEvent.change(screen.getByLabelText('Workflow'), {
      target: { value: workflowFixtures[0].workflow_id }
    });

    await screen.findByLabelText('customerId');
    expect(screen.getByLabelText('notify')).toBeInTheDocument();
  });

  it('allows raw JSON payload editing in JSON mode', async () => {
    await renderSchedules();

    fireEvent.click(screen.getByText('New Schedule'));
    await screen.findByRole('dialog', { name: 'Create Schedule' });
    fireEvent.change(screen.getByLabelText('Workflow'), {
      target: { value: workflowFixtures[0].workflow_id }
    });
    await screen.findByLabelText('customerId');

    fireEvent.click(screen.getByText('JSON Mode'));
    expect(screen.getByLabelText('schedule-dialog-payload-json')).toBeInTheDocument();
  });

  it('blocks save and shows field-level issues when form mode payload is invalid', async () => {
    await renderSchedules();

    fireEvent.click(screen.getByText('New Schedule'));
    await screen.findByRole('dialog', { name: 'Create Schedule' });
    fireEvent.change(screen.getByLabelText('Workflow'), {
      target: { value: workflowFixtures[0].workflow_id }
    });
    await screen.findByLabelText('customerId');

    fireEvent.change(screen.getByLabelText('Schedule name'), { target: { value: 'Daily sync' } });
    fireEvent.change(screen.getByLabelText('Run at'), { target: { value: '2026-03-10T09:00' } });

    await waitFor(() => {
      expect(screen.getAllByText('Required field missing.').length).toBeGreaterThan(0);
      expect(screen.getByText('Create Schedule', { selector: 'button' })).toBeDisabled();
    });
  });

  it('blocks save and shows schema issues when JSON mode payload is invalid', async () => {
    await renderSchedules();

    fireEvent.click(screen.getByText('New Schedule'));
    await screen.findByRole('dialog', { name: 'Create Schedule' });
    fireEvent.change(screen.getByLabelText('Workflow'), {
      target: { value: workflowFixtures[0].workflow_id }
    });
    await screen.findByLabelText('customerId');

    fireEvent.change(screen.getByLabelText('Schedule name'), { target: { value: 'Daily sync' } });
    fireEvent.change(screen.getByLabelText('Run at'), { target: { value: '2026-03-10T09:00' } });
    fireEvent.click(screen.getByText('JSON Mode'));
    fireEvent.change(screen.getByLabelText('schedule-dialog-payload-json'), {
      target: { value: JSON.stringify({ notify: true }, null, 2) }
    });

    await waitFor(() => {
      expect(screen.getByText(/customerId: Required field missing\./)).toBeInTheDocument();
      expect(screen.getByText('Create Schedule', { selector: 'button' })).toBeDisabled();
    });
  });

  it('explains why inferred-schema workflows cannot be scheduled', async () => {
    await renderSchedules();

    fireEvent.click(screen.getByText('New Schedule'));
    await screen.findByRole('dialog', { name: 'Create Schedule' });
    fireEvent.change(screen.getByLabelText('Workflow'), {
      target: { value: workflowFixtures[2].workflow_id }
    });

    await waitFor(() => {
      expect(screen.getByText('Schedules are only supported for workflows with a pinned payload schema.')).toBeInTheDocument();
      expect(screen.getByText('Create Schedule', { selector: 'button' })).toBeDisabled();
    });
  });

  it('T013: surfaces save-time business-hours validation errors inline in the schedule dialog', async () => {
    actionMocks.createWorkflowScheduleAction.mockResolvedValueOnce({
      ok: false,
      message: 'Business/non-business day filters require a default business-hours schedule or a specific override.'
    });

    await renderSchedules();

    fireEvent.click(screen.getByText('New Schedule'));
    await screen.findByRole('dialog', { name: 'Create Schedule' });
    fireEvent.change(screen.getByLabelText('Trigger type'), { target: { value: 'recurring' } });
    fireEvent.change(screen.getByLabelText('Workflow'), {
      target: { value: workflowFixtures[0].workflow_id }
    });
    await screen.findByLabelText('customerId');
    fireEvent.change(screen.getByLabelText('Schedule name'), { target: { value: 'Filtered schedule' } });
    fireEvent.change(screen.getByLabelText('Run on'), { target: { value: 'business' } });
    fireEvent.change(screen.getByLabelText('customerId'), { target: { value: 'C-500' } });
    fireEvent.click(screen.getByText('Create Schedule', { selector: 'button' }));

    await waitFor(() => {
      expect(screen.getByText('Business/non-business day filters require a default business-hours schedule or a specific override.')).toBeInTheDocument();
    });
  });
});
