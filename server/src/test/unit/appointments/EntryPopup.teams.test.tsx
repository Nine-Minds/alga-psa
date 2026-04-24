/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import EntryPopup from '../../../../../packages/scheduling/src/components/schedule/EntryPopup';

const {
  getTeamsMeetingCapability,
  getAppointmentRequestById,
  approveAppointmentRequest,
  declineAppointmentRequest,
  getWorkItemById,
  getUserAvatarUrlsBatchAction,
} = vi.hoisted(() => ({
  getTeamsMeetingCapability: vi.fn(),
  getAppointmentRequestById: vi.fn(),
  approveAppointmentRequest: vi.fn(),
  declineAppointmentRequest: vi.fn(),
  getWorkItemById: vi.fn(),
  getUserAvatarUrlsBatchAction: vi.fn(),
}));

vi.mock('@alga-psa/scheduling/actions', () => ({
  approveAppointmentRequest,
  declineAppointmentRequest,
  getTeamsMeetingCapability,
  getAppointmentRequestById,
  getWorkItemById,
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getUserAvatarUrlsBatchAction,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string | { defaultValue?: string }) =>
      typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? _key,
  }),
  useFormatters: () => ({
    formatDate: (value: Date | string) => String(value),
  }),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  handleError: vi.fn(),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: (props: any) => <input type="date" {...props} />,
}));

vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: (props: any) => <textarea {...props} />,
}));

vi.mock('@alga-psa/ui/components/Switch', () => ({
  Switch: ({ id, checked, onCheckedChange, label }: any) => (
    <label htmlFor={id}>
      {label}
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onCheckedChange(event.target.checked)}
      />
    </label>
  ),
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => <div>{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({ openDrawer: vi.fn() }),
  DeleteEntityDialog: () => null,
}));

vi.mock('@alga-psa/scheduling/components/time-management/time-entry/time-sheet/WorkItemDrawer', () => ({
  WorkItemDrawer: () => null,
}));

vi.mock('@alga-psa/scheduling/components/time-management/time-entry/time-sheet/AddWorkItemDialog', () => ({
  AddWorkItemDialog: () => null,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  default: ({ id, options = [], value, onValueChange }: any) => (
    <select id={id} value={value} onChange={(event) => onValueChange(event.target.value)}>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components/UserPicker', () => ({
  default: ({ id, label, users = [], value, onValueChange }: any) => (
    <label htmlFor={id}>
      {label}
      <select id={id} value={value} onChange={(event) => onValueChange(event.target.value)}>
        {users.map((user: any) => (
          <option key={user.user_id} value={user.user_id}>
            {user.first_name} {user.last_name}
          </option>
        ))}
      </select>
    </label>
  ),
}));

vi.mock('@alga-psa/scheduling/components/time-management/time-entry/time-sheet/SelectedWorkItem', () => ({
  default: () => null,
}));

vi.mock('@alga-psa/ui/components/DateTimePicker', () => ({
  DateTimePicker: ({ id }: any) => <input id={id} type="datetime-local" />,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}));

vi.mock('@alga-psa/auth/lib/preCheckDeletion', () => ({
  preCheckDeletion: vi.fn(),
}));

const baseEvent = {
  entry_id: 'entry-1',
  tenant: 'tenant-1',
  title: 'Appointment: Remote Support',
  scheduled_start: new Date('2026-05-01T14:00:00Z'),
  scheduled_end: new Date('2026-05-01T15:00:00Z'),
  assigned_user_ids: ['tech-1'],
  work_item_type: 'appointment_request',
  work_item_id: 'request-1',
  status: 'scheduled',
  created_at: new Date('2026-04-23T09:00:00Z'),
  updated_at: new Date('2026-04-23T09:00:00Z'),
  notes: 'Customer requested a virtual consultation.',
  is_private: false,
};

const baseAppointmentRequest = {
  appointment_request_id: 'request-1',
  requested_date: '2026-05-01',
  requested_time: '14:00:00',
  requested_duration: 60,
  requester_timezone: 'UTC',
  status: 'pending',
  online_meeting_url: null,
  approved_at: null,
  service_name: 'Remote Support',
};

const users = [
  {
    user_id: 'tech-1',
    first_name: 'Taylor',
    last_name: 'Tech',
    email: 'tech@example.com',
    user_type: 'internal',
    is_inactive: false,
  },
];

describe('EntryPopup Teams UI', () => {
  beforeEach(() => {
    getTeamsMeetingCapability.mockResolvedValue({ available: true });
    getAppointmentRequestById.mockResolvedValue({
      success: true,
      data: baseAppointmentRequest,
    });
    approveAppointmentRequest.mockResolvedValue({ success: true });
    declineAppointmentRequest.mockResolvedValue({ success: true });
    getWorkItemById.mockResolvedValue(null);
    getUserAvatarUrlsBatchAction.mockResolvedValue({});
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('shows the Teams toggle in the pending approval view when capability is available', async () => {
    render(
      <EntryPopup
        event={baseEvent as any}
        onClose={vi.fn()}
        onSave={vi.fn()}
        canAssignMultipleAgents={false}
        users={users as any}
        currentUserId="tech-1"
        canModifySchedule={true}
        focusedTechnicianId={null}
        canAssignOthers={true}
      />
    );

    const toggle = await screen.findByLabelText('Generate Microsoft Teams meeting link');
    expect(toggle).toBeChecked();
  });

  it('shows the Teams join action in the approved banner when an online meeting URL is present', async () => {
    getAppointmentRequestById.mockResolvedValue({
      success: true,
      data: {
        ...baseAppointmentRequest,
        status: 'approved',
        approved_at: '2026-04-24T10:00:00Z',
        online_meeting_url: 'https://teams.example.com/meeting/123',
      },
    });

    render(
      <EntryPopup
        event={baseEvent as any}
        onClose={vi.fn()}
        onSave={vi.fn()}
        canAssignMultipleAgents={false}
        users={users as any}
        currentUserId="tech-1"
        canModifySchedule={true}
        focusedTechnicianId={null}
        canAssignOthers={true}
      />
    );

    expect(await screen.findByRole('button', { name: 'Join Teams Meeting' })).toBeInTheDocument();
  });
});
