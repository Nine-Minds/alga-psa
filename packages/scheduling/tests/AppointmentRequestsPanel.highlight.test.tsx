/* @vitest-environment jsdom */

import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AppointmentRequestsPanel from '../src/components/schedule/AppointmentRequestsPanel';

const {
  getAppointmentRequests,
  getTeamsMeetingCapability,
  approveAppointmentRequest,
  declineAppointmentRequest,
  generateTeamsMeetingForApprovedRequest,
  updateAppointmentRequestDateTime,
  getAllUsersBasic,
  getCurrentUser,
  getUserAvatarUrlsBatchAction,
  getSchedulingTicketById,
  toastMock,
  handleErrorMock,
} = vi.hoisted(() => ({
  getAppointmentRequests: vi.fn(),
  getTeamsMeetingCapability: vi.fn(),
  approveAppointmentRequest: vi.fn(),
  declineAppointmentRequest: vi.fn(),
  generateTeamsMeetingForApprovedRequest: vi.fn(),
  updateAppointmentRequestDateTime: vi.fn(),
  getAllUsersBasic: vi.fn(),
  getCurrentUser: vi.fn(),
  getUserAvatarUrlsBatchAction: vi.fn(),
  getSchedulingTicketById: vi.fn(),
  toastMock: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
  handleErrorMock: vi.fn(),
}));

vi.mock('@alga-psa/scheduling/actions', () => ({
  getAppointmentRequests,
  getTeamsMeetingCapability,
  approveAppointmentRequest,
  declineAppointmentRequest,
  generateTeamsMeetingForApprovedRequest,
  updateAppointmentRequestDateTime,
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getAllUsersBasic,
  getCurrentUser,
  getUserAvatarUrlsBatchAction,
}));

vi.mock('../src/actions/ticketLookupActions', () => ({
  getSchedulingTicketById,
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
  default: toastMock,
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  handleError: handleErrorMock,
}));

vi.mock('@alga-psa/ui/components/Drawer', () => ({
  default: ({ children, isOpen }: any) => (isOpen ? <div>{children}</div> : null),
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
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

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, htmlFor }: any) => <label htmlFor={htmlFor}>{children}</label>,
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
        <option value="">Select technician</option>
        {users.map((user: any) => (
          <option key={user.user_id} value={user.user_id}>
            {user.first_name} {user.last_name}
          </option>
        ))}
      </select>
    </label>
  ),
}));

vi.mock('@alga-psa/ui/components/DateTimePicker', () => ({
  DateTimePicker: ({ id }: any) => <input id={id} type="datetime-local" />,
}));

vi.mock('@alga-psa/ui/components/TextArea', () => ({
  TextArea: (props: any) => <textarea {...props} />,
}));

vi.mock('../src/components/shared/SchedulingTicketDetails', () => ({
  SchedulingTicketDetails: () => <div>Ticket details</div>,
}));


const base = {
  client_id: 'client-1',
  contact_id: 'contact-1',
  service_id: 'service-1',
  requested_date: '2026-05-01',
  requested_time: '14:00:00',
  requested_duration: 60,
  requester_timezone: 'UTC',
  description: 'Need help',
  is_authenticated: true,
  schedule_entry_id: 'entry-1',
  created_at: new Date('2026-04-23T09:00:00Z'),
  updated_at: new Date('2026-04-23T09:00:00Z'),
  preferred_assigned_user_id: 'tech-1',
  client_company_name: 'Acme Corp',
  contact_name: 'Casey Client',
  service_name: 'Remote Support',
};

const PENDING_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const APPROVED_ID = 'bbbbbbbb-2222-4222-8222-222222222222';
const UNKNOWN_ID = '00000000-0000-0000-0000-000000000000';

// The details pane renders the first 8 chars of the selected request's id.
const detailsId = (id: string) => id.slice(0, 8).toUpperCase();

function renderPanel(highlightedRequestId: string | null) {
  return render(
    <AppointmentRequestsPanel isOpen onClose={() => {}} highlightedRequestId={highlightedRequestId} />,
  );
}

describe('AppointmentRequestsPanel highlightedRequestId (deep link target)', () => {
  beforeEach(() => {
    getAppointmentRequests.mockResolvedValue({
      success: true,
      data: [
        { ...base, appointment_request_id: PENDING_ID, status: 'pending' },
        { ...base, appointment_request_id: APPROVED_ID, status: 'approved' },
      ],
    });
    getTeamsMeetingCapability.mockResolvedValue({ available: false });
    getAllUsersBasic.mockResolvedValue([]);
    getCurrentUser.mockResolvedValue(null);
    getUserAvatarUrlsBatchAction.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('(a) unknown id: nothing selected, no toast, no handleError', async () => {
    renderPanel(UNKNOWN_ID);
    await waitFor(() => expect(getAppointmentRequests).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.queryByText(detailsId(PENDING_ID))).toBeNull();
    expect(screen.queryByText(detailsId(APPROVED_ID))).toBeNull();
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(handleErrorMock).not.toHaveBeenCalled();
  });

  it('(b) approved id: switches the filter to all and selects it', async () => {
    renderPanel(APPROVED_ID);
    expect(await screen.findByText(detailsId(APPROVED_ID))).toBeTruthy();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('(c) pending id: selects it', async () => {
    renderPanel(PENDING_ID);
    expect(await screen.findByText(detailsId(PENDING_ID))).toBeTruthy();
    expect(toastMock.error).not.toHaveBeenCalled();
  });
});
