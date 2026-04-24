/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AppointmentRequestsPanel from '../../../../../packages/scheduling/src/components/schedule/AppointmentRequestsPanel';

const {
  getAppointmentRequests,
  getTeamsMeetingCapability,
  approveAppointmentRequest,
  declineAppointmentRequest,
  getAllUsersBasic,
  getCurrentUser,
  getUserAvatarUrlsBatchAction,
  getSchedulingTicketById,
} = vi.hoisted(() => ({
  getAppointmentRequests: vi.fn(),
  getTeamsMeetingCapability: vi.fn(),
  approveAppointmentRequest: vi.fn(),
  declineAppointmentRequest: vi.fn(),
  getAllUsersBasic: vi.fn(),
  getCurrentUser: vi.fn(),
  getUserAvatarUrlsBatchAction: vi.fn(),
  getSchedulingTicketById: vi.fn(),
}));

vi.mock('@alga-psa/scheduling/actions', () => ({
  getAppointmentRequests,
  getTeamsMeetingCapability,
  approveAppointmentRequest,
  declineAppointmentRequest,
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getAllUsersBasic,
  getCurrentUser,
  getUserAvatarUrlsBatchAction,
}));

vi.mock('../../../../../packages/scheduling/src/actions/ticketLookupActions', () => ({
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
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  handleError: vi.fn(),
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

vi.mock('../../../../../packages/scheduling/src/components/shared/SchedulingTicketDetails', () => ({
  SchedulingTicketDetails: () => <div>Ticket details</div>,
}));

const pendingRequest = {
  appointment_request_id: 'request-pending',
  client_id: 'client-1',
  contact_id: 'contact-1',
  service_id: 'service-1',
  requested_date: '2026-05-01',
  requested_time: '14:00:00',
  requested_duration: 60,
  requester_timezone: 'UTC',
  status: 'pending',
  description: 'Need help with remote support',
  is_authenticated: true,
  schedule_entry_id: 'entry-1',
  created_at: new Date('2026-04-23T09:00:00Z'),
  updated_at: new Date('2026-04-23T09:00:00Z'),
  preferred_assigned_user_id: 'tech-1',
  client_company_name: 'Acme Corp',
  contact_name: 'Casey Client',
  service_name: 'Remote Support',
};

const approvedRequest = {
  ...pendingRequest,
  appointment_request_id: 'request-approved',
  status: 'approved',
  online_meeting_url: 'https://teams.example.com/meeting/123',
};

describe('AppointmentRequestsPanel Teams UI', () => {
  beforeEach(() => {
    getAppointmentRequests.mockResolvedValue({
      success: true,
      data: [pendingRequest],
    });
    getTeamsMeetingCapability.mockResolvedValue({ available: true });
    approveAppointmentRequest.mockResolvedValue({ success: true });
    declineAppointmentRequest.mockResolvedValue({ success: true });
    getAllUsersBasic.mockResolvedValue([
      {
        user_id: 'tech-1',
        first_name: 'Taylor',
        last_name: 'Tech',
        email: 'tech@example.com',
        user_type: 'internal',
        is_inactive: false,
      },
    ]);
    getCurrentUser.mockResolvedValue({
      user_id: 'tech-1',
      first_name: 'Taylor',
      last_name: 'Tech',
      email: 'tech@example.com',
      user_type: 'internal',
      tenant: 'tenant-1',
      created_at: new Date('2026-04-23T09:00:00Z'),
    });
    getUserAvatarUrlsBatchAction.mockResolvedValue({});
    getSchedulingTicketById.mockResolvedValue(null);
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('shows the Teams toggle in the approval form when capability is available and keeps it checked by default', async () => {
    render(
      <AppointmentRequestsPanel
        isOpen={true}
        onClose={vi.fn()}
        highlightedRequestId="request-pending"
      />
    );

    const toggle = await screen.findByLabelText('Generate Microsoft Teams meeting link');

    expect(toggle).toBeChecked();
  });

  it('does not render the Teams toggle in the approval form when capability is unavailable', async () => {
    getTeamsMeetingCapability.mockResolvedValueOnce({ available: false, reason: 'not_configured' });

    render(
      <AppointmentRequestsPanel
        isOpen={true}
        onClose={vi.fn()}
        highlightedRequestId="request-pending"
      />
    );

    await screen.findByText('Approval Details');
    expect(screen.queryByLabelText('Generate Microsoft Teams meeting link')).not.toBeInTheDocument();
  });

  it('shows the Teams join action in the request detail view for approved requests that have a meeting URL', async () => {
    getAppointmentRequests.mockResolvedValueOnce({
      success: true,
      data: [approvedRequest],
    });

    render(
      <AppointmentRequestsPanel
        isOpen={true}
        onClose={vi.fn()}
        highlightedRequestId="request-approved"
      />
    );

    expect(await screen.findByRole('button', { name: 'Join Teams Meeting' })).toBeInTheDocument();
  });
});
