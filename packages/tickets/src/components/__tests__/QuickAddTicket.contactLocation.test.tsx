/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { QuickAddTicket } from '../QuickAddTicket';

/**
 * The Location field answers "where do we go", and the requester is the one who knows. These pin
 * the three ways that answer arrives: a contact picked here, a contact that arrived prefilled (the
 * contact page's Create Ticket — the case that shipped unfilled), and a location the dispatcher
 * chose by hand, which nothing may overwrite.
 */

const getTicketFormDataMock = vi.fn();
const getTicketStatusesMock = vi.fn();
const getContactEffectiveLocationMock = vi.fn();

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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}));

vi.mock('../../actions/ticketActions', () => ({
  addTicket: vi.fn(),
  updateTicket: vi.fn(),
}));

vi.mock('../../actions/ticketResourceActions', () => ({
  addTicketResource: vi.fn(),
}));

vi.mock('../../actions/ticketFormActions', () => ({
  getTicketFormData: (...args: unknown[]) => getTicketFormDataMock(...args),
}));

vi.mock('../../actions/clientLookupActions', () => ({
  getContactsByClient: vi.fn().mockResolvedValue([]),
  getClientLocations: vi.fn().mockResolvedValue([
    { location_id: 'warehouse', location_name: 'Warehouse', is_default: false, is_active: true },
    { location_id: 'head-office', location_name: 'Head office', is_default: true, is_active: true },
  ]),
  getContactEffectiveLocation: (...args: unknown[]) => getContactEffectiveLocationMock(...args),
}));

vi.mock('@alga-psa/reference-data/actions', () => ({
  getTicketStatuses: (...args: unknown[]) => getTicketStatusesMock(...args),
}));

vi.mock('@alga-psa/reference-data/actions/status-actions/statusActions', () => ({
  getTicketStatuses: (...args: unknown[]) => getTicketStatusesMock(...args),
}));

vi.mock('@alga-psa/tickets/actions', () => ({
  getTicketCategoriesByBoard: vi.fn().mockResolvedValue({
    categories: [],
    boardConfig: {
      category_type: 'custom',
      priority_type: 'custom',
      display_itil_impact: false,
      display_itil_urgency: false,
    },
  }),
}));

vi.mock('../../actions/ticketCategoryActions', () => ({
  getTicketCategoriesByBoard: vi.fn().mockResolvedValue({
    categories: [],
    boardConfig: {
      category_type: 'custom',
      priority_type: 'custom',
      display_itil_impact: false,
      display_itil_urgency: false,
    },
  }),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: vi.fn().mockResolvedValue(null),
  getUserAvatarUrlsBatchAction: vi.fn(),
  searchUsersForMentions: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/user-composition/actions/userQueryActions', () => ({
  getCurrentUser: vi.fn().mockResolvedValue(null),
}));

vi.mock('@alga-psa/user-composition/actions/avatarActions', () => ({
  getUserAvatarUrlsBatchAction: vi.fn(),
}));

vi.mock('@alga-psa/user-composition/actions/searchUsersForMentions', () => ({
  searchUsersForMentions: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/teams/actions', () => ({
  getTeams: vi.fn().mockResolvedValue([]),
  getTeamAvatarUrlsBatchAction: vi.fn(),
}));

vi.mock('@alga-psa/teams/actions/team-actions/teamActions', () => ({
  getTeams: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/teams/actions/team-actions/avatarActions', () => ({
  getTeamAvatarUrlsBatchAction: vi.fn(),
}));

vi.mock('@alga-psa/teams/actions/team-actions/teamActionErrors', () => ({
  isTeamActionError: () => false,
}));

vi.mock('../../actions/teamAssignmentActions', () => ({
  assignTeamToTicket: vi.fn(),
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => ({ enabled: false }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (
      _key: string,
      fallbackOrOptions?: string | Record<string, unknown>,
      maybeOptions?: Record<string, unknown>,
    ) => {
      // i18next's `t` accepts either `t(key, fallbackString, options)` or
      // `t(key, optionsObject)` where the options object carries `defaultValue`.
      const fallback =
        typeof fallbackOrOptions === 'string'
          ? fallbackOrOptions
          : (fallbackOrOptions?.defaultValue as string | undefined);
      const options =
        typeof fallbackOrOptions === 'string' ? maybeOptions : fallbackOrOptions;

      if (!fallback) {
        return _key;
      }

      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(options?.[name] ?? ''));
    },
  }),
}));

vi.mock('@alga-psa/ui/context', () => ({
  useQuickAddClient: () => ({
    renderQuickAddClient: () => null,
    renderQuickAddContact: () => null,
  }),
}));

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  Dialog: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) => (isOpen ? <div>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/ClientPicker', () => ({
  ClientPicker: () => <div data-testid="client-picker" />,
}));

vi.mock('@alga-psa/ui/components/ContactPicker', () => ({
  ContactPicker: ({
    contacts,
    value,
    onValueChange,
  }: {
    contacts: Array<{ contact_name_id: string; full_name: string }>;
    value?: string;
    onValueChange: (value: string) => void;
  }) => (
    <select
      data-testid="contact-picker"
      value={value || ''}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="" />
      {contacts.map((contact) => (
        <option key={contact.contact_name_id} value={contact.contact_name_id}>
          {contact.full_name}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('../CategoryPicker', () => ({
  CategoryPicker: () => <div data-testid="category-picker" />,
}));

vi.mock('../QuickAddCategory', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('@alga-psa/ui/components/settings/general/BoardPicker', () => ({
  __esModule: true,
  BoardPicker: ({
    boards,
    onSelect,
    selectedBoardId,
  }: {
    boards: Array<{ board_id?: string | null; board_name?: string | null }>;
    onSelect: (boardId: string) => void;
    selectedBoardId: string | null;
  }) => (
    <div>
      <div data-testid="board-picker-selected">{selectedBoardId || ''}</div>
      {boards.map((board) => (
        <button key={board.board_id} type="button" onClick={() => onSelect(board.board_id || '')}>
          Select {board.board_name}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  __esModule: true,
  default: ({
    id,
    value,
    options,
    onValueChange,
    disabled,
  }: {
    id?: string;
    value?: string;
    options: Array<{ value: string; label: string }>;
    onValueChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <select
      data-testid={id || 'custom-select'}
      value={value || ''}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="" />
      {options.map((option) => (
      <option key={option.value} value={option.value}>
          {typeof option.label === 'string' ? option.label : option.value}
      </option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components/UserPicker', () => ({
  __esModule: true,
  default: () => <div data-testid="user-picker" />,
}));

vi.mock('@alga-psa/ui/components/UserAndTeamPicker', () => ({
  __esModule: true,
  default: () => <div data-testid="user-team-picker" />,
}));

vi.mock('@alga-psa/ui/editor', () => ({
  TextEditor: () => <div data-testid="text-editor" />,
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}));

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: () => <div data-testid="date-picker" />,
}));

vi.mock('@alga-psa/ui/components/DateTimePicker', () => ({
  DateTimePicker: () => <div data-testid="date-time-picker" />,
}));

vi.mock('@alga-psa/ui/components/Spinner', () => ({
  __esModule: true,
  default: () => <div data-testid="spinner" />,
}));

vi.mock('@alga-psa/tags/components', () => ({
  QuickAddTagPicker: () => <div data-testid="tag-picker" />,
}));

vi.mock('@alga-psa/tags/components/QuickAddTagPicker', () => ({
  QuickAddTagPicker: () => <div data-testid="tag-picker" />,
}));

vi.mock('@alga-psa/tags/actions/tagActions', () => ({
  createTagsForEntity: vi.fn(),
}));

vi.mock('@alga-psa/ui/ui-reflection/useAutomationIdAndRegister', () => ({
  useAutomationIdAndRegister: () => ({ automationIdProps: {}, updateMetadata: vi.fn() }),
}));

vi.mock('@alga-psa/ui/ui-reflection/useRegisterUIComponent', () => ({
  useRegisterUIComponent: () => vi.fn(),
}));

vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/ui-reflection/withDataAutomationId', () => ({
  withDataAutomationId: () => ({}),
}));

vi.mock('../useQuickAddRichTextUploadSession', () => ({
  useQuickAddRichTextUploadSession: () => ({
    uploadFile: vi.fn(),
    requestDiscard: vi.fn(),
    resetDraftTracking: vi.fn(),
    stagedClipboardImages: [],
    showDraftCancelDialog: false,
    setShowDraftCancelDialog: vi.fn(),
    deleteTrackedDraftClipboardImages: vi.fn(),
    keepDraftClipboardImages: vi.fn(),
  }),
}));

vi.mock('../../lib/ticketRichText', () => ({
  parseTicketRichTextContent: vi.fn().mockReturnValue([]),
  serializeTicketRichTextContent: vi.fn().mockReturnValue(''),
  extractTicketRichTextPlainText: vi.fn().mockReturnValue(''),
}));

vi.mock('../../lib/ticketRichTextImages', () => ({
  removeTicketRichTextImageUrls: vi.fn().mockImplementation((value) => value),
  replaceTicketRichTextImageUrls: vi.fn().mockImplementation((value) => value),
}));


const DOROTHY = { contact_name_id: 'dorothy', full_name: 'Dorothy Gale', client_id: 'client-1' };
const TOTO = { contact_name_id: 'toto', full_name: 'Toto', client_id: 'client-1' };

describe('QuickAddTicket contact location', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTicketFormDataMock.mockResolvedValue({
      users: [],
      boards: [
        { board_id: 'board-custom', board_name: 'Custom Board', priority_type: 'custom', category_type: 'custom' },
      ],
      statuses: [],
      priorities: [],
      clients: [{ client_id: 'client-1', client_name: 'Emerald City', client_type: 'company' }],
      selectedClient: { client_id: 'client-1', client_name: 'Emerald City', client_type: 'company' },
      contacts: [DOROTHY, TOTO],
    });
    getTicketStatusesMock.mockResolvedValue([
      { status_id: 'status-default', name: 'New', is_default: true, is_closed: false },
    ]);
    getContactEffectiveLocationMock.mockImplementation(async (contactId: string) =>
      contactId === 'dorothy'
        ? {
            locationId: 'warehouse',
            locations: [
              { location_id: 'warehouse', location_name: 'Warehouse', is_primary: true, is_active: true },
              { location_id: 'head-office', location_name: 'Head office', is_primary: false, is_active: true },
            ],
            workArrangement: 'hybrid',
          }
        : { locationId: 'head-office', locations: [{ location_id: 'head-office', location_name: 'Head office', is_primary: true, is_active: true }], workArrangement: null }
    );
  });

  const renderQuickAdd = (props: Record<string, unknown> = {}) =>
    render(
      <QuickAddTicket
        open={true}
        onOpenChange={vi.fn()}
        onTicketAdded={vi.fn()}
        prefilledClient={{ id: 'client-1', name: 'Emerald City' }}
        {...props}
      />
    );

  it('fills the location from a contact that arrived prefilled', async () => {
    renderQuickAdd({ prefilledContact: { id: 'dorothy', name: 'Dorothy Gale' } });

    const locationSelect = await screen.findByTestId('ticket-quick-add-location');
    await waitFor(() => {
      expect(locationSelect).toHaveValue('warehouse');
    });
    expect(getContactEffectiveLocationMock).toHaveBeenCalledWith('dorothy');
  });

  it('marks the contact\'s own sites in the list and offers them first', async () => {
    renderQuickAdd({ prefilledContact: { id: 'dorothy', name: 'Dorothy Gale' } });

    const locationSelect = await screen.findByTestId('ticket-quick-add-location');
    await waitFor(() => {
      expect(locationSelect).toHaveValue('warehouse');
    });

    const labels = Array.from(locationSelect.querySelectorAll('option'))
      .map((option) => option.textContent)
      .filter(Boolean);
    expect(labels).toEqual([
      'None',
      "Warehouse (contact's primary)",
      "Head office (contact's location) (Default)",
    ]);
  });

  it('fills the location when a contact is picked here', async () => {
    renderQuickAdd();

    const locationSelect = await screen.findByTestId('ticket-quick-add-location');
    expect(locationSelect).toHaveValue('');

    fireEvent.change(await screen.findByTestId('contact-picker'), { target: { value: 'dorothy' } });
    await waitFor(() => {
      expect(locationSelect).toHaveValue('warehouse');
    });

    // Switching requesters follows the new one...
    fireEvent.change(screen.getByTestId('contact-picker'), { target: { value: 'toto' } });
    await waitFor(() => {
      expect(locationSelect).toHaveValue('head-office');
    });

    // ...and clearing the requester takes the location it filled with it.
    fireEvent.change(screen.getByTestId('contact-picker'), { target: { value: '' } });
    await waitFor(() => {
      expect(locationSelect).toHaveValue('');
    });
  });

  it('never replaces a location the dispatcher chose by hand', async () => {
    renderQuickAdd();

    const locationSelect = await screen.findByTestId('ticket-quick-add-location');
    fireEvent.change(locationSelect, { target: { value: 'head-office' } });
    expect(locationSelect).toHaveValue('head-office');

    fireEvent.change(await screen.findByTestId('contact-picker'), { target: { value: 'dorothy' } });
    await waitFor(() => {
      expect(getContactEffectiveLocationMock).toHaveBeenCalledWith('dorothy');
    });
    expect(locationSelect).toHaveValue('head-office');

    // An explicit None is just as much a choice, and the contact does not undo it either.
    fireEvent.change(locationSelect, { target: { value: 'none' } });
    fireEvent.change(screen.getByTestId('contact-picker'), { target: { value: 'toto' } });
    await waitFor(() => {
      expect(getContactEffectiveLocationMock).toHaveBeenCalledWith('toto');
    });
    expect(locationSelect).toHaveValue('');
  });
});
