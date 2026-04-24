/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AvailabilitySettings from '../../../../../packages/scheduling/src/components/schedule/AvailabilitySettings';

const {
  getAvailabilitySettings,
  getTeamsMeetingsTabState,
  setDefaultMeetingOrganizer,
  verifyMeetingOrganizer,
  createOrUpdateAvailabilitySetting,
  deleteAvailabilitySetting,
  getAvailabilityExceptions,
  addAvailabilityException,
  deleteAvailabilityException,
  getServices,
  getAllUsersBasic,
  getTeams,
  useSession,
  useFeatureFlag,
} = vi.hoisted(() => ({
  getAvailabilitySettings: vi.fn(),
  getTeamsMeetingsTabState: vi.fn(),
  setDefaultMeetingOrganizer: vi.fn(),
  verifyMeetingOrganizer: vi.fn(),
  createOrUpdateAvailabilitySetting: vi.fn(),
  deleteAvailabilitySetting: vi.fn(),
  getAvailabilityExceptions: vi.fn(),
  addAvailabilityException: vi.fn(),
  deleteAvailabilityException: vi.fn(),
  getServices: vi.fn(),
  getAllUsersBasic: vi.fn(),
  getTeams: vi.fn(),
  useSession: vi.fn(),
  useFeatureFlag: vi.fn(),
}));

vi.mock('@alga-psa/scheduling/actions', () => ({
  getAvailabilitySettings,
  getTeamsMeetingsTabState,
  setDefaultMeetingOrganizer,
  verifyMeetingOrganizer,
  createOrUpdateAvailabilitySetting,
  deleteAvailabilitySetting,
  getAvailabilityExceptions,
  addAvailabilityException,
  deleteAvailabilityException,
  getServices,
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getAllUsersBasic,
}));

vi.mock('@alga-psa/teams/actions', () => ({
  getTeams,
}));

vi.mock('next-auth/react', () => ({
  useSession: () => useSession(),
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => useFeatureFlag(),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string | { defaultValue?: string }) =>
      typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? _key,
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

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}));

vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <div>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Tabs', () => ({
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children, value, onClick }: any) => (
    <button data-value={value} onClick={onClick}>
      {children}
    </button>
  ),
  TabsContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, htmlFor }: any) => <label htmlFor={htmlFor}>{children}</label>,
}));

vi.mock('@alga-psa/ui/components/Switch', () => ({
  Switch: ({ id, checked, onCheckedChange }: any) => (
    <input
      id={id}
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange(event.target.checked)}
    />
  ),
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: any) => <div>{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
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

vi.mock('@alga-psa/ui/components/TimePicker', () => ({
  TimePicker: (props: any) => <input type="time" {...props} />,
}));

vi.mock('@alga-psa/ui/components/Calendar', () => ({
  Calendar: () => <div>Calendar</div>,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@alga-psa/ui/components/Table', () => ({
  Table: ({ children }: any) => <table>{children}</table>,
  TableBody: ({ children }: any) => <tbody>{children}</tbody>,
  TableCell: ({ children }: any) => <td>{children}</td>,
  TableHead: ({ children }: any) => <th>{children}</th>,
  TableHeader: ({ children }: any) => <thead>{children}</thead>,
  TableRow: ({ children }: any) => <tr>{children}</tr>,
}));

vi.mock('@alga-psa/ui/components/DataTable', () => ({
  DataTable: () => <div>Data table</div>,
}));

describe('AvailabilitySettings Teams meetings UI', () => {
  beforeEach(() => {
    useSession.mockReturnValue({
      data: { user: { id: 'user-1' } },
    });
    useFeatureFlag.mockReturnValue({ enabled: false });
    getTeams.mockResolvedValue([]);
    getAllUsersBasic.mockResolvedValue([]);
    getServices.mockResolvedValue({ services: [] });
    getAvailabilitySettings.mockResolvedValue({ success: true, data: [] });
    getAvailabilityExceptions.mockResolvedValue({ success: true, data: [] });
    getTeamsMeetingsTabState.mockResolvedValue({
      success: true,
      data: { visible: true, organizerUpn: 'scheduler@acme.com' },
    });
    setDefaultMeetingOrganizer.mockResolvedValue({
      success: true,
      data: { organizerUpn: 'video@acme.com' },
    });
    verifyMeetingOrganizer.mockResolvedValue({
      success: true,
      data: { valid: true, displayName: 'Scheduler User' },
    });
    createOrUpdateAvailabilitySetting.mockResolvedValue({ success: true });
    deleteAvailabilitySetting.mockResolvedValue({ success: true });
    addAvailabilityException.mockResolvedValue({ success: true });
    deleteAvailabilityException.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows the Teams Meetings tab only when the tab state reports it visible', async () => {
    const visibleRender = render(<AvailabilitySettings isOpen={true} onClose={vi.fn()} />);

    expect(await screen.findByText('Teams Meetings')).toBeInTheDocument();
    visibleRender.unmount();

    getTeamsMeetingsTabState.mockResolvedValue({
      success: true,
      data: { visible: false, organizerUpn: null },
    });

    render(<AvailabilitySettings isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.queryByText('Teams Meetings')).not.toBeInTheDocument();
    });
  });

  it('saves the organizer UPN from the Teams Meetings tab', async () => {
    render(<AvailabilitySettings isOpen={true} onClose={vi.fn()} />);

    const organizerInput = await screen.findByLabelText('Default meeting organizer (UPN or Microsoft user ID)');

    fireEvent.change(organizerInput, { target: { value: 'video@acme.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(setDefaultMeetingOrganizer).toHaveBeenCalledWith({ upn: 'video@acme.com' });
    });

    expect(
      (screen.getByLabelText('Default meeting organizer (UPN or Microsoft user ID)') as HTMLInputElement).value
    ).toBe('video@acme.com');
  });
});
