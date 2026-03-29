/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import TicketProperties from '../TicketProperties';

const getScheduledHoursForTicketMock = vi.fn();
const getTicketAppointmentRequestsMock = vi.fn();
const getTicketingDisplaySettingsMock = vi.fn();

vi.mock('../../../actions/ticketActions', () => ({
  getScheduledHoursForTicket: (...args: unknown[]) => getScheduledHoursForTicketMock(...args),
  getTicketAppointmentRequests: (...args: unknown[]) => getTicketAppointmentRequestsMock(...args),
}));

vi.mock('../../../actions/ticketDisplaySettings', () => ({
  getTicketingDisplaySettings: (...args: unknown[]) => getTicketingDisplaySettingsMock(...args),
}));

vi.mock('@alga-psa/ui/components', () => ({
  ContentCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button type="button" {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => <label {...props}>{children}</label>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  __esModule: true,
  default: () => <div data-testid="custom-select" />,
}));

vi.mock('@alga-psa/ui/components/MultiUserPicker', () => ({
  __esModule: true,
  default: () => <div data-testid="multi-user-picker" />,
}));

vi.mock('@alga-psa/ui/components/MultiUserAndTeamPicker', () => ({
  __esModule: true,
  default: () => <div data-testid="multi-user-team-picker" />,
}));

vi.mock('@alga-psa/ui/components/UserAvatar', () => ({
  __esModule: true,
  default: () => <div data-testid="user-avatar" />,
}));

vi.mock('@alga-psa/ui/components/TeamAvatar', () => ({
  __esModule: true,
  default: () => <div data-testid="team-avatar" />,
}));

vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: () => <div data-testid="client-picker" />,
}));

vi.mock('@alga-psa/ui/components/ContactPicker', () => ({
  ContactPicker: () => <div data-testid="contact-picker" />,
}));

vi.mock('@alga-psa/tags/components', () => ({
  TagManager: () => <div data-testid="tag-manager" />,
}));

vi.mock('../TicketMaterialsCard', () => ({
  __esModule: true,
  default: () => <div data-testid="ticket-materials-card" />,
}));

vi.mock('../TicketWatchListCard', () => ({
  __esModule: true,
  default: () => <div data-testid="ticket-watch-list-card" />,
}));

vi.mock('@alga-psa/teams/actions', () => ({
  getTeamAvatarUrlsBatchAction: vi.fn().mockResolvedValue({}),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getUserAvatarUrlAction: vi.fn().mockResolvedValue(null),
  getContactAvatarUrlAction: vi.fn().mockResolvedValue(null),
  getUserAvatarUrlsBatchAction: vi.fn().mockResolvedValue({}),
  getUserContactId: vi.fn().mockResolvedValue(null),
}));

vi.mock('@alga-psa/ui/components/ClientAvatar', () => ({
  __esModule: true,
  default: () => <div data-testid="client-avatar" />,
}));

vi.mock('@alga-psa/ui/components/ContactAvatar', () => ({
  __esModule: true,
  default: () => <div data-testid="contact-avatar" />,
}));

vi.mock('@alga-psa/ui/context', () => ({
  useRegisterUnsavedChanges: vi.fn(),
  useQuickAddClient: () => ({ renderQuickAddContact: vi.fn() }),
}));

vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({ openDrawer: vi.fn() }),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Checkbox', () => ({
  Checkbox: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input type="checkbox" {...props} />,
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => ({ enabled: false }),
}));

vi.mock('@alga-psa/ui/ui-reflection/withDataAutomationId', () => ({
  withDataAutomationId: ({ id }: { id: string }) => ({ 'data-testid': id }),
  withUIReflectionId: (Component: React.ComponentType<any>) => Component,
}));

vi.mock('@alga-psa/core', () => ({
  formatMinutesAsHoursAndMinutes: () => '0m',
  utcToLocal: (value: string) => value,
  formatDateTime: (value: string) => value,
  getUserTimeZone: () => 'UTC',
}));

const defaultProps = () => ({
  ticket: {
    ticket_id: 'ticket-1',
    ticket_number: '1001',
    board_id: 'board-1',
    client_id: 'client-1',
    location_id: null,
    assigned_to: null,
    assigned_team_id: null,
    attributes: {},
    entered_at: '2026-03-08T10:00:00.000Z',
  } as any,
  client: { client_id: 'client-1', client_name: 'Client 1' },
  contactInfo: { contact_name_id: 'contact-1', full_name: 'Ada Lovelace' },
  createdByUser: { first_name: 'Grace', last_name: 'Hopper' },
  board: { board_name: 'Support', enable_live_ticket_timer: true },
  elapsedTime: 0,
  isRunning: false,
  timeDescription: '',
  team: null,
  teams: [],
  additionalAgents: [],
  availableAgents: [],
  currentTimeSheet: null,
  currentTimePeriod: null,
  userId: 'user-1',
  tenant: 'tenant-1',
  contacts: [],
  clients: [],
  locations: [],
  clientFilterState: 'active' as const,
  clientTypeFilter: 'company' as const,
  onStart: vi.fn(),
  onPause: vi.fn(),
  onStop: vi.fn(),
  onTimeDescriptionChange: vi.fn(),
  onAddTimeEntry: vi.fn(),
  onClientClick: vi.fn(),
  onContactClick: vi.fn(),
  onAgentClick: vi.fn(),
  onAddAgent: vi.fn().mockResolvedValue(undefined),
  onRemoveAgent: vi.fn().mockResolvedValue(undefined),
  onChangeContact: vi.fn(),
  onChangeClient: vi.fn(),
  onChangeLocation: vi.fn(),
  onClientFilterStateChange: vi.fn(),
  onClientTypeFilterChange: vi.fn(),
});

describe('TicketProperties live timer board policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getScheduledHoursForTicketMock.mockResolvedValue({ scheduledHours: 0 });
    getTicketAppointmentRequestsMock.mockResolvedValue({ success: true, data: [] });
    getTicketingDisplaySettingsMock.mockResolvedValue({ dateTimeFormat: 'MMM d, yyyy h:mm a' });
  });

  it('T004: hides tracked intervals on disabled boards while keeping Add Time Entry available', () => {
    const renderIntervalManagement = vi.fn(() => <div>Intervals</div>);
    const props = defaultProps();
    props.board.enable_live_ticket_timer = false;

    render(<TicketProperties {...props} renderIntervalManagement={renderIntervalManagement} />);

    expect(screen.queryByText('Ticket Timer - #1001')).not.toBeInTheDocument();
    expect(screen.queryByText('Tracked Intervals')).not.toBeInTheDocument();
    expect(renderIntervalManagement).not.toHaveBeenCalled();
    expect(screen.getByText('Add Time Entry')).toBeInTheDocument();
  });

  it('T006: keeps timer controls and tracked interval rendering when enabled', () => {
    const renderIntervalManagement = vi.fn(() => <div data-testid="interval-management-content">Intervals</div>);
    const props = defaultProps();
    props.board.enable_live_ticket_timer = true;

    render(<TicketProperties {...props} renderIntervalManagement={renderIntervalManagement} />);

    expect(screen.getByText('Ticket Timer - #1001')).toBeInTheDocument();
    expect(screen.getByText('Tracked Intervals')).toBeInTheDocument();
    expect(renderIntervalManagement).toHaveBeenCalledWith({ ticketId: 'ticket-1', userId: 'user-1' });
    expect(screen.getByText('Add Time Entry')).toBeInTheDocument();
  });
});
