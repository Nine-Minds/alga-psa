/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { QuickAddTicket } from '../QuickAddTicket';

const getTicketFormDataMock = vi.fn();
const getTicketStatusesMock = vi.fn();
const addTicketMock = vi.fn();

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
  addTicket: (...args: unknown[]) => addTicketMock(...args),
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
  getClientLocations: vi.fn().mockResolvedValue([]),
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

// The composition layer's seam, standing in for ClientAssetMultiSelect: it
// only ever receives one client's id, and the ids it is handed back are what
// the dialog submits.
vi.mock('@alga-psa/ui/context', () => ({
  useTicketAssetPicker: () => ({
    renderAssetPicker: ({ id, clientId, value, onChange, label, disabled }: {
      id: string;
      clientId: string;
      value: string[];
      onChange: (assetIds: string[]) => void;
      label: string;
      disabled?: boolean;
    }) => (
      <div data-testid="asset-picker" data-client={clientId} data-label={label} data-disabled={String(Boolean(disabled))}>
        <div data-testid="asset-picker-value">{value.join(',')}</div>
        {ASSET_FIXTURES.map((asset) => (
          <button
            key={asset.asset_id}
            type="button"
            id={`${id}-add-${asset.asset_id}`}
            onClick={() => onChange([...value, asset.asset_id])}
          >
            {`Pick ${asset.name}`}
          </button>
        ))}
      </div>
    ),
  }),
  useQuickAddClient: () => ({
    renderQuickAddClient: () => null,
    renderQuickAddContact: () => null,
  }),
}));

const ASSET_FIXTURES = [
  { asset_id: 'asset-1', name: 'Reception PC' },
  { asset_id: 'asset-2', name: 'Back-office NAS' },
];

vi.mock('@alga-psa/ui/components/Dialog', () => ({
  // The footer (Create / Create + View) is a prop, not a child.
  Dialog: ({ isOpen, children, title, footer }: { isOpen: boolean; children: React.ReactNode; title?: React.ReactNode; footer?: React.ReactNode }) =>
    isOpen ? (
      <div role="dialog">
        {title ? <h2>{title}</h2> : null}
        {children}
        {footer}
      </div>
    ) : null,
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
  ClientPicker: ({ clients, onSelect, selectedClientId }: {
    clients: Array<{ client_id: string; client_name: string }>;
    onSelect: (clientId: string | null) => void;
    selectedClientId: string | null;
  }) => (
    <div>
      <div data-testid="client-picker-value">{selectedClientId || ''}</div>
      {clients.map((client) => (
        <button key={client.client_id} type="button" onClick={() => onSelect(client.client_id)}>
          {`Choose ${client.client_name}`}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('@alga-psa/ui/components/ContactPicker', () => ({
  ContactPicker: () => <div data-testid="contact-picker" />,
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

/**
 * alga-2026-0002785 (customer ask via ticket 2592): the ticket-create dialog
 * picks any number of the selected client's devices, instead of only rendering
 * a banner for one asset handed in from the asset page.
 */
describe('QuickAddTicket asset selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTicketFormDataMock.mockResolvedValue({
      users: [],
      boards: [{ board_id: 'board-a', board_name: 'Board A', priority_type: 'custom' }],
      statuses: [],
      priorities: [{ priority_id: 'priority-1', priority_name: 'Priority 1', item_type: 'ticket' }],
      clients: [
        { client_id: 'client-1', client_name: 'Acme', client_type: 'company' },
        { client_id: 'client-2', client_name: 'Globex', client_type: 'company' },
      ],
    });
    getTicketStatusesMock.mockResolvedValue([
      { status_id: 'status-a-default', name: 'Board A Default', is_default: true, is_closed: false },
    ]);
    addTicketMock.mockResolvedValue({ ticket_id: 'ticket-1', ticket_number: 'TIC-1' });
  });

  async function openDialog(props: Record<string, unknown> = {}) {
    render(
      <QuickAddTicket open={true} onOpenChange={vi.fn()} onTicketAdded={vi.fn()} {...props} />
    );
    await waitFor(() => expect(getTicketFormDataMock).toHaveBeenCalled());
    await screen.findByTestId('ticket-quick-add');
  }

  it('offers no picker until a client is chosen', async () => {
    await openDialog();

    expect(screen.queryByTestId('asset-picker')).not.toBeInTheDocument();
    expect(screen.getByTestId('ticket-quick-add-assets-disabled')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Choose Acme'));

    const picker = await screen.findByTestId('asset-picker');
    expect(picker).toHaveAttribute('data-client', 'client-1');
    expect(picker).toHaveAttribute('data-label', 'Assets');
    expect(screen.queryByTestId('ticket-quick-add-assets-disabled')).not.toBeInTheDocument();
  });

  it('submits every picked device as its own asset_ids entry', async () => {
    await openDialog();

    fireEvent.click(screen.getByText('Choose Acme'));
    await screen.findByTestId('asset-picker');
    fireEvent.click(screen.getByText('Pick Reception PC'));
    await waitFor(() => expect(screen.getByTestId('asset-picker-value')).toHaveTextContent('asset-1'));
    fireEvent.click(screen.getByText('Pick Back-office NAS'));
    await waitFor(() => expect(screen.getByTestId('asset-picker-value')).toHaveTextContent('asset-1,asset-2'));

    fireEvent.change(screen.getByPlaceholderText('Ticket Title *'), { target: { value: 'Two devices down' } });
    fireEvent.click(screen.getByText('Select Board A'));
    await waitFor(() => expect(getTicketStatusesMock).toHaveBeenCalledWith('board-a'));
    fireEvent.change(screen.getByTestId('ticket-quick-add-priority'), { target: { value: 'priority-1' } });
    await waitFor(() => expect(screen.getByTestId('ticket-quick-add-priority')).toHaveValue('priority-1'));

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(addTicketMock).toHaveBeenCalled());

    const formData = addTicketMock.mock.calls[0][0] as FormData;
    expect(formData.getAll('asset_ids')).toEqual(['asset-1', 'asset-2']);
    // The single-asset form is gone from this surface: the server reads asset_ids.
    expect(formData.get('asset_id')).toBeNull();
  });

  it('clears the picked devices when the client changes', async () => {
    await openDialog();

    fireEvent.click(screen.getByText('Choose Acme'));
    await screen.findByTestId('asset-picker');
    fireEvent.click(screen.getByText('Pick Reception PC'));
    await waitFor(() => expect(screen.getByTestId('asset-picker-value')).toHaveTextContent('asset-1'));

    fireEvent.click(screen.getByText('Choose Globex'));

    // A device of the previous client must not stay picked.
    await waitFor(() => expect(screen.getByTestId('asset-picker')).toHaveAttribute('data-client', 'client-2'));
    expect(screen.getByTestId('asset-picker-value')).toHaveTextContent('');
  });

  it('pre-fills the picker when the dialog is opened from an asset', async () => {
    await openDialog({
      assetId: 'asset-1',
      assetName: 'Reception PC',
      prefilledClient: { id: 'client-1', name: 'Acme' },
    });

    const picker = await screen.findByTestId('asset-picker');
    expect(picker).toHaveAttribute('data-client', 'client-1');
    expect(screen.getByTestId('asset-picker-value')).toHaveTextContent('asset-1');
    // The read-only banner is replaced by the picker, not shown beside it.
    expect(screen.queryByTestId('quick-add-ticket-asset-pill')).not.toBeInTheDocument();
  });
});
