/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppointmentRequestDetailsPage } from '../../../../../packages/client-portal/src/components/appointments/AppointmentRequestDetailsPage';

const {
  getAppointmentRequestDetails,
  cancelAppointmentRequest,
  pushMock,
} = vi.hoisted(() => ({
  getAppointmentRequestDetails: vi.fn(),
  cancelAppointmentRequest: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ appointmentRequestId: 'appointment-1' }),
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@alga-psa/client-portal/actions', () => ({
  getAppointmentRequestDetails,
  cancelAppointmentRequest,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
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

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({ isOpen, title, message, onConfirm }: any) =>
    isOpen ? (
      <div data-testid="confirmation-dialog">
        <div>{title}</div>
        <div>{message}</div>
        <button onClick={onConfirm}>Confirm</button>
      </div>
    ) : null,
}));

vi.mock('@alga-psa/ui/components/Spinner', () => ({
  default: () => <div>Loading spinner</div>,
}));

const buildAppointment = (overrides: Partial<Record<string, unknown>> = {}) => ({
  appointment_request_id: 'appointment-1',
  service_id: 'service-1',
  service_name: 'Virtual Consultation',
  requested_date: '2026-05-01',
  requested_time: '14:00:00',
  requested_duration: 60,
  requester_timezone: 'UTC',
  status: 'approved',
  approved_at: '2026-04-24T10:00:00Z',
  created_at: '2026-04-23T09:00:00Z',
  online_meeting_url: null,
  ...overrides,
});

describe('AppointmentRequestDetailsPage Teams UI', () => {
  beforeEach(() => {
    getAppointmentRequestDetails.mockResolvedValue({
      success: true,
      data: buildAppointment(),
    });
    cancelAppointmentRequest.mockResolvedValue({ success: true });
    pushMock.mockReset();
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('shows the Teams deletion warning in the cancel confirmation when a meeting URL is present', async () => {
    getAppointmentRequestDetails.mockResolvedValue({
      success: true,
      data: buildAppointment({
        online_meeting_url: 'https://teams.example.com/meeting/123',
      }),
    });

    render(<AppointmentRequestDetailsPage />);

    await screen.findByText('Virtual Consultation');

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel Request' }));

    expect(
      await screen.findByText(
        'Are you sure you want to cancel this appointment request? This action cannot be undone. This will also delete the Microsoft Teams meeting.'
      )
    ).toBeInTheDocument();
  });

  it('omits the Teams deletion warning in the cancel confirmation when no meeting URL is present', async () => {
    render(<AppointmentRequestDetailsPage />);

    await screen.findByText('Virtual Consultation');

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel Request' }));

    expect(
      await screen.findByText('Are you sure you want to cancel this appointment request? This action cannot be undone.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/This will also delete the Microsoft Teams meeting\./)).not.toBeInTheDocument();
  });

  it('renders the Join Teams Meeting button when a meeting URL is present', async () => {
    getAppointmentRequestDetails.mockResolvedValue({
      success: true,
      data: buildAppointment({
        online_meeting_url: 'https://teams.example.com/meeting/123',
      }),
    });

    render(<AppointmentRequestDetailsPage />);

    expect(await screen.findByRole('button', { name: 'Join Teams Meeting' })).toBeInTheDocument();
  });
});
