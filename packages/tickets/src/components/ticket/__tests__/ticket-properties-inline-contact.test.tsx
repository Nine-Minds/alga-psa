import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TicketProperties from '../TicketProperties';

const getScheduledHoursForTicketMock = vi.fn();
const getTicketAppointmentRequestsMock = vi.fn();
const getTicketingDisplaySettingsMock = vi.fn();
const getTeamAvatarUrlsBatchActionMock = vi.fn();
const getUserAvatarUrlActionMock = vi.fn();
const getContactAvatarUrlActionMock = vi.fn();
const getUserAvatarUrlsBatchActionMock = vi.fn();
const getUserContactIdMock = vi.fn();

vi.mock('next/server', () => ({
  NextRequest: class NextRequest {},
  NextResponse: {
    next: vi.fn(),
    json: vi.fn(),
  },
}));

vi.mock('next-auth', () => ({
  __esModule: true,
  default: vi.fn(() => ({
    handlers: {},
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  })),
}));

vi.mock('next-auth/lib/env', () => ({
  setEnvDefaults: vi.fn(),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
  signOut: vi.fn(),
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../actions/ticketActions', () => ({
  getScheduledHoursForTicket: (...args: unknown[]) => getScheduledHoursForTicketMock(...args),
  getTicketAppointmentRequests: (...args: unknown[]) => getTicketAppointmentRequestsMock(...args),
}));

vi.mock('../../../actions/ticketDisplaySettings', () => ({
  getTicketingDisplaySettings: (...args: unknown[]) => getTicketingDisplaySettingsMock(...args),
}));

vi.mock('@alga-psa/tags/components', () => ({
  TagManager: () => <div data-testid="tag-manager" />,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: any) => <button type="button" {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  __esModule: true,
  default: ({ options = [], value = '', onValueChange }: any) => (
    <select data-testid="custom-select" value={value} onChange={(event) => onValueChange?.(event.target.value)}>
      <option value="" />
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components', () => ({
  ContentCard: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/core', () => ({
  formatMinutesAsHoursAndMinutes: () => '0m',
  utcToLocal: (value: string) => value,
  formatDateTime: (value: string) => value,
  getUserTimeZone: () => 'UTC',
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

vi.mock('@alga-psa/teams/actions', () => ({
  getTeamAvatarUrlsBatchAction: (...args: unknown[]) => getTeamAvatarUrlsBatchActionMock(...args),
}));

vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: () => <div data-testid="client-picker" />,
}));

vi.mock('@alga-psa/ui/components/ContactPicker', () => ({
  ContactPicker: ({ onAddNew, value, contacts }: any) => (
    <div data-testid="contact-picker">
      <div data-testid="contact-picker-value">{value}</div>
      <div data-testid="contact-picker-count">{contacts.length}</div>
      {onAddNew ? (
        <button type="button" onClick={onAddNew}>
          + Add new contact
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock('react-hot-toast', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@alga-psa/ui/ui-reflection/withDataAutomationId', () => ({
  withDataAutomationId: ({ id }: { id: string }) => ({ 'data-automation-id': id }),
  withUIReflectionId: (Component: React.ComponentType<any>) => Component,
}));

vi.mock('@alga-psa/ui/components/ClientAvatar', () => ({
  __esModule: true,
  default: () => <div data-testid="client-avatar" />,
}));

vi.mock('@alga-psa/ui/components/ContactAvatar', () => ({
  __esModule: true,
  default: () => <div data-testid="contact-avatar" />,
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getUserAvatarUrlAction: (...args: unknown[]) => getUserAvatarUrlActionMock(...args),
  getContactAvatarUrlAction: (...args: unknown[]) => getContactAvatarUrlActionMock(...args),
  getUserAvatarUrlsBatchAction: (...args: unknown[]) => getUserAvatarUrlsBatchActionMock(...args),
  getUserContactId: (...args: unknown[]) => getUserContactIdMock(...args),
}));

vi.mock('../TicketMaterialsCard', () => ({
  __esModule: true,
  default: () => <div data-testid="ticket-materials-card" />,
}));

vi.mock('../TicketWatchListCard', () => ({
  __esModule: true,
  default: () => <div data-testid="ticket-watch-list-card" />,
}));

vi.mock('@alga-psa/ui/context', () => ({
  useRegisterUnsavedChanges: vi.fn(),
  useQuickAddClient: () => ({
    renderQuickAddContact: ({
      isOpen,
      selectedClientId,
    }: {
      isOpen: boolean;
      selectedClientId: string;
    }) => {
      if (!isOpen) {
        return null;
      }

      return (
        <div data-testid="quick-add-contact-dialog">
          <div data-testid="quick-add-contact-client">{selectedClientId}</div>
        </div>
      );
    },
  }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, options?: Record<string, string | number>) => {
      if (!fallback) {
        return _key;
      }

      return Object.entries(options ?? {}).reduce(
        (message, [name, value]) => message.replaceAll(`{{${name}}}`, String(value)),
        fallback,
      );
    },
  }),
}));

vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({ openDrawer: vi.fn() }),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ children }: any) => <div>{children}</div>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Checkbox', () => ({
  Checkbox: (props: any) => <input type="checkbox" {...props} />,
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => ({ enabled: false }),
}));

vi.mock('@alga-psa/clients/components', () => ({
  __esModule: true,
  QuickAddContact: ({ isOpen, selectedClientId }: any) => {
    if (!isOpen) {
      return null;
    }

    return (
      <div data-testid="quick-add-contact-dialog">
        <div data-testid="quick-add-contact-client">{selectedClientId}</div>
      </div>
    );
  },
}));

const defaultProps = () => ({
  ticket: {
    ticket_id: 'ticket-1',
    ticket_number: '1001',
    client_id: 'ticket-client-1',
    location_id: null,
    assigned_to: null,
    assigned_team_id: null,
    attributes: {},
    entered_at: '2026-03-08T10:00:00.000Z',
  } as any,
  client: {
    client_id: 'fallback-client-1',
    client_name: 'Fallback Client',
  },
  contactInfo: {
    contact_name_id: 'contact-1',
    full_name: 'Ada Lovelace',
  },
  createdByUser: {
    first_name: 'Grace',
    last_name: 'Hopper',
  },
  board: {
    board_name: 'Support',
  },
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
  contacts: [
    {
      contact_name_id: 'contact-1',
      full_name: 'Ada Lovelace',
      client_id: 'ticket-client-1',
      is_inactive: false,
    },
  ],
  clients: [
    {
      client_id: 'ticket-client-1',
      client_name: 'Ticket Client',
      client_type: 'company' as const,
      url: '',
      is_inactive: false,
      credit_balance: 0,
      billing_cycle: 'monthly' as const,
      is_tax_exempt: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ],
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

describe('TicketProperties quick add contact', () => {
  beforeEach(() => {
    getScheduledHoursForTicketMock.mockReset();
    getTicketAppointmentRequestsMock.mockReset();
    getTicketingDisplaySettingsMock.mockReset();
    getTeamAvatarUrlsBatchActionMock.mockReset();
    getUserAvatarUrlActionMock.mockReset();
    getContactAvatarUrlActionMock.mockReset();
    getUserAvatarUrlsBatchActionMock.mockReset();
    getUserContactIdMock.mockReset();

    getScheduledHoursForTicketMock.mockResolvedValue({ scheduledHours: 0 });
    getTicketAppointmentRequestsMock.mockResolvedValue([]);
    getTicketingDisplaySettingsMock.mockResolvedValue({ date_time_format: 'MMM d, yyyy h:mm a' });
    getTeamAvatarUrlsBatchActionMock.mockResolvedValue({});
    getUserAvatarUrlActionMock.mockResolvedValue(null);
    getContactAvatarUrlActionMock.mockResolvedValue(null);
    getUserAvatarUrlsBatchActionMock.mockResolvedValue({});
    getUserContactIdMock.mockResolvedValue(null);
  });

  it("T009: clicking '+ Add new contact' opens QuickAddContact with the ticket client id", async () => {
    const view = render(<TicketProperties {...defaultProps()} />);

    const toggleButton = view.container.querySelector('[data-automation-id="ticket-properties-toggle-contact-picker-btn"]');
    expect(toggleButton).not.toBeNull();

    fireEvent.click(toggleButton!);
    fireEvent.click(await screen.findByRole('button', { name: '+ Add new contact' }));

    await waitFor(() => {
      expect(screen.getByTestId('quick-add-contact-dialog')).toBeInTheDocument();
      expect(screen.getByTestId('quick-add-contact-client')).toHaveTextContent('ticket-client-1');
    });
  });
});
