/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import TicketInfo from '../TicketInfo';
import { TicketDataSourceProvider } from '../TicketDataSourceContext';
import { nativeTicketDataSource } from '../../../lib/nativeTicketDataSource';
import {
  NO_TICKET_CAPABILITIES,
  composeTicketDataSource,
  resolveTicketFrozenFields,
  type TicketDataSource,
} from '../../../lib/ticketDataSource';

const getTicketCategoriesByBoardMock = vi.fn();
const getTicketCategoriesMock = vi.fn();
const createCategoryMock = vi.fn();

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => ({ enabled: false }),
}));

vi.mock('@alga-psa/ui/context', () => ({
  useRegisterUnsavedChanges: vi.fn(),
  useOptionalActivityCrossFeature: () => null,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('@alga-psa/ui/editor', () => ({
  RichTextViewer: ({ content }: { content: string }) => <div>{content}</div>,
  TextEditor: () => <div data-testid="text-editor" />,
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, id, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { id?: string }) => (
    <button {...props} data-testid={id}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  __esModule: true,
  default: ({ value, options, placeholder }: { value?: string; options?: Array<{ value: string; label: string }>; placeholder?: string }) => (
    <div data-testid="custom-select">{options?.find((option) => option.value === value)?.label ?? placeholder ?? 'Select...'}</div>
  ),
}));

vi.mock('@alga-psa/ui/components/tickets/PrioritySelect', () => ({
  PrioritySelect: () => <div data-testid="priority-select" />,
}));

vi.mock('@alga-psa/ui/components/UserAndTeamPicker', () => ({
  __esModule: true,
  // Renders what the real picker shows with no resolvable selection: its placeholder.
  default: ({ placeholder, disabled }: { placeholder?: string; disabled?: boolean }) => (
    <button type="button" data-testid="assignee-picker" disabled={disabled}>{placeholder}</button>
  ),
}));

vi.mock('../../CategoryPicker', () => ({
  CategoryPicker: ({ categories, onAddNew, disabled }: { categories: Array<{ category_id: string; category_name: string }>; onAddNew?: () => void; disabled?: boolean }) => (
    <div data-testid="category-picker" data-disabled={disabled ? 'true' : 'false'}>
      {categories.map((category) => category.category_name).join(',')}
      {onAddNew ? <button type="button" onClick={onAddNew}>Add new category</button> : null}
    </div>
  ),
}));

vi.mock('../../QuickAddCategory', () => ({
  __esModule: true,
  default: () => <div data-testid="quick-add-category" />,
}));

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: () => <button type="button">Due date</button>,
}));

vi.mock('@alga-psa/ui/components/DateTimePicker', () => ({
  DateTimePicker: () => <button type="button">Due date and time</button>,
}));

vi.mock('@alga-psa/tags/components', () => ({
  TagManager: () => <div data-testid="tag-manager" />,
}));

vi.mock('../../ResponseStateSelect', () => ({
  ResponseStateDisplay: () => <button type="button">Response state</button>,
}));

vi.mock('@alga-psa/ui/components/Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/UserAvatar', () => ({
  __esModule: true,
  default: () => <div data-testid="user-avatar" />,
}));

vi.mock('@alga-psa/ui/components/TeamAvatar', () => ({
  __esModule: true,
  default: () => <div data-testid="team-avatar" />,
}));

vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: ({ containerClassName: _containerClassName, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { containerClassName?: string }) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}));

vi.mock('@alga-psa/ui/components/sla', () => ({
  SlaStatusBadge: () => <div data-testid="sla-status-badge" />,
}));

vi.mock('@alga-psa/ui/presence/FieldConflictBanner', () => ({
  FieldConflictBanner: () => <div data-testid="field-conflict-banner" />,
}));

vi.mock('@alga-psa/core/context/DocumentsCrossFeatureContext', () => ({
  useDocumentsCrossFeature: () => ({
    deleteDocument: vi.fn(),
  }),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getUserAvatarUrlsBatchAction: vi.fn(),
  searchUsersForMentions: vi.fn().mockResolvedValue([]),
}));

vi.mock('@alga-psa/teams/actions', () => ({
  getTeamAvatarUrlsBatchAction: vi.fn(),
}));

vi.mock('@alga-psa/reference-data/actions', () => ({
  getTicketStatuses: vi.fn().mockResolvedValue([]),
}));

// TicketInfo imports these straight from the module, not through the
// @alga-psa/tickets/actions barrel; mocking the barrel leaves the real
// server action in place and the component fires it at a database that a
// unit run does not have.
vi.mock('../../../actions/ticketCategoryActions', () => ({
  getTicketCategories: (...args: unknown[]) => getTicketCategoriesMock(...args),
  getTicketCategoriesByBoard: (...args: unknown[]) => getTicketCategoriesByBoardMock(...args),
  createCategory: (...args: unknown[]) => createCategoryMock(...args),
}));

vi.mock('../../../lib/ticketRichText', () => ({
  parseTicketRichTextContent: vi.fn().mockReturnValue([]),
  serializeTicketRichTextContent: vi.fn().mockReturnValue('[]'),
}));

vi.mock('../useTicketRichTextUploadSession', () => ({
  useTicketRichTextUploadSession: () => ({
    uploadFile: vi.fn(),
    requestDiscard: vi.fn(),
    resetDraftTracking: vi.fn(),
    showDraftCancelDialog: false,
    setShowDraftCancelDialog: vi.fn(),
    deleteTrackedDraftClipboardImages: vi.fn(),
    keepDraftClipboardImages: vi.fn(),
  }),
}));

const boardConfig = {
  category_type: 'custom' as const,
  priority_type: 'custom' as const,
  display_itil_impact: false,
  display_itil_urgency: false,
};

const ticket = {
  ticket_id: 'ticket-1',
  ticket_number: 'T-1001',
  title: 'Entry gating',
  status_id: 'status-a',
  status_name: 'Open',
  board_id: 'board-a',
  assigned_to: null,
  category_id: null,
  subcategory_id: null,
  priority_id: 'priority-1',
  due_date: null,
  response_state: null,
  attributes: { description: '' },
  sla_policy_id: null,
  entered_at: new Date('2026-03-14T10:00:00.000Z').toISOString(),
} as any;

function sharedDataSource(screen: { readOnly?: boolean } = {}): TicketDataSource {
  return composeTicketDataSource(nativeTicketDataSource, {
    capabilities: { ...NO_TICKET_CAPABILITIES },
    screen,
    options: {
      getTicketStatuses: vi.fn().mockResolvedValue([]),
      getTicketCategories: vi.fn().mockResolvedValue([{ category_id: 'cat-1', category_name: 'Hardware' }]),
      getTicketCategoriesByBoard: vi.fn().mockResolvedValue({
        categories: [{ category_id: 'cat-1', category_name: 'Hardware' }],
        boardConfig,
      }),
    },
  });
}

function renderEntry(
  dataSource: TicketDataSource,
  statusOptions: Array<{ value: string; label: string }> = [],
  ticketOverrides: Record<string, unknown> = {},
) {
  return render(
    <TicketDataSourceProvider dataSource={dataSource}>
      <TicketInfo
        id="ticket-info"
        ticket={{ ...ticket, ...ticketOverrides }}
        conversations={[]}
        statusOptions={statusOptions}
        agentOptions={[]}
        boardOptions={[{ value: 'board-a', label: 'Board A' }]}
        priorityOptions={[{ value: 'priority-1', label: 'Priority 1' }]}
        onSelectChange={vi.fn()}
        onSaveChanges={vi.fn().mockResolvedValue(true)}
        responseStateTrackingEnabled={false}
        liveFrozenFields={resolveTicketFrozenFields(dataSource.screen)}
      />
    </TicketDataSourceProvider>,
  );
}

describe('TicketInfo Entry layout on a shared (non-native) data source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTicketCategoriesMock.mockResolvedValue([]);
    getTicketCategoriesByBoardMock.mockResolvedValue({ categories: [], boardConfig });
  });

  it('offers no Add new category and never mounts QuickAddCategory or calls createCategory', async () => {
    renderEntry(sharedDataSource());
    await waitFor(() => expect(screen.getByTestId('category-picker')).toHaveTextContent('Hardware'));
    expect(screen.queryByText('Add new category')).not.toBeInTheDocument();
    expect(screen.queryByTestId('quick-add-category')).not.toBeInTheDocument();
    expect(createCategoryMock).not.toHaveBeenCalled();
    expect(getTicketCategoriesByBoardMock).not.toHaveBeenCalled();
  });

  it('disables the category picker when the screen is read-only', async () => {
    renderEntry(sharedDataSource({ readOnly: true }));
    await waitFor(() => expect(screen.getByTestId('category-picker')).toHaveTextContent('Hardware'));
    expect(screen.getByTestId('category-picker')).toHaveAttribute('data-disabled', 'true');
  });

  it('shows the current status label, not the placeholder, for a read-only viewer without status options', async () => {
    renderEntry(sharedDataSource({ readOnly: true }));
    await waitFor(() => expect(screen.getByTestId('category-picker')).toBeInTheDocument());
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.queryByText('Select...')).not.toBeInTheDocument();
  });


  it('shows Not assigned when no customer assignee is disclosed', async () => {
    renderEntry(sharedDataSource(), [], { assigned_to: undefined, assigned_to_name: null });
    await waitFor(() => expect(screen.getByTestId('category-picker')).toBeInTheDocument());
    expect(screen.getByTestId('assignee-picker')).toHaveTextContent('Not assigned');
  });

  it('renders no Tags block (heading or placeholder) when capabilities.tags is false', async () => {
    renderEntry(sharedDataSource());
    await waitFor(() => expect(screen.getByTestId('category-picker')).toBeInTheDocument());
    expect(screen.queryByText('Tags')).not.toBeInTheDocument();
    expect(screen.queryByText('Tags cannot be managed')).not.toBeInTheDocument();
  });
});

describe('TicketInfo Entry layout on the native data source (regression guard)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTicketCategoriesMock.mockResolvedValue([]);
    getTicketCategoriesByBoardMock.mockResolvedValue({
      categories: [{ category_id: 'cat-1', category_name: 'Hardware' }],
      boardConfig,
    });
  });

  it('still offers Add new category, mounts QuickAddCategory, and shows the Tags block', async () => {
    renderEntry(nativeTicketDataSource, [{ value: 'status-a', label: 'Open' }]);
    await waitFor(() => expect(screen.getByText('Add new category')).toBeInTheDocument());
    expect(screen.getByTestId('category-picker')).toHaveAttribute('data-disabled', 'false');
    expect(screen.getByTestId('quick-add-category')).toBeInTheDocument();
    expect(screen.getByText('Tags')).toBeInTheDocument();
    expect(screen.getByText('Tags cannot be managed')).toBeInTheDocument();
  });
});
