/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BentoHero } from './BentoHero';
import { TicketDataSourceProvider } from '../TicketDataSourceContext';
import { resolveTicketFrozenFields } from '../../../lib/ticketDataSource';
import { nativeTicketDataSource } from '../../../lib/nativeTicketDataSource';

const crossFeatureRef = vi.hoisted(() => ({ value: null as any }));
const getTicketStatusesMock = vi.fn();
const getTicketCategoriesByBoardMock = vi.fn();
const useRegisterUnsavedChangesMock = vi.fn();
const usePageSaveShortcutMock = vi.fn();
const requestDiscardMock = vi.fn();
const resetDraftTrackingMock = vi.fn();

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, values?: Record<string, string>) => Object.entries(values ?? {}).reduce((out, [k, v]) => out.replace(`{{${k}}}`, v), fallback ?? _key),
  }),
}));

vi.mock('@alga-psa/reference-data/actions', () => ({
  getTicketStatuses: (...args: unknown[]) => getTicketStatusesMock(...args),
}));

vi.mock('../../../actions/ticketCategoryActions', () => ({
  getTicketCategoriesByBoard: (...args: unknown[]) => getTicketCategoriesByBoardMock(...args),
}));

vi.mock('../../CategoryPicker', () => ({
  CategoryPicker: ({
    id,
    categories,
    selectedCategories,
    onSelect,
  }: {
    id: string;
    categories: Array<{ category_id: string; category_name: string; parent_category?: string }>;
    selectedCategories: string[];
    onSelect: (ids: string[], excluded: string[]) => void;
  }) => {
    const selected = categories.find((category) => category.category_id === selectedCategories[0]);
    const parent = selected?.parent_category
      ? categories.find((category) => category.category_id === selected.parent_category)
      : undefined;
    return (
      <div>
        <button id={id} data-testid={id} type="button">
          {parent && <><strong>{parent.category_name}</strong> → </>}{selected?.category_name}
        </button>
        {categories.map((category) => (
          <button key={category.category_id} type="button" onClick={() => onSelect([category.category_id], [])}>
            {category.category_name}
          </button>
        ))}
        <button type="button" onClick={() => onSelect([], [])}>Clear category</button>
      </div>
    );
  },
}));

vi.mock('@alga-psa/ui/context', () => ({
  useRegisterUnsavedChanges: (...args: unknown[]) => useRegisterUnsavedChangesMock(...args),
  useOptionalActivityCrossFeature: () => crossFeatureRef.value,
}));

vi.mock('@alga-psa/ui/keyboard-shortcuts', () => ({
  usePageSaveShortcut: (...args: unknown[]) => usePageSaveShortcutMock(...args),
}));

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, id, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { id: string }) => (
    <button id={id} type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
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
    id: string;
    value?: string | null;
    options: Array<{ value: string; label: React.ReactNode }>;
    onValueChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <select
      data-testid={id}
      id={id}
      disabled={disabled}
      value={value ?? ''}
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

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: () => <div data-testid="date-picker" />,
}));

vi.mock('@alga-psa/ui/components/UserAndTeamPicker', () => ({
  __esModule: true,
  default: () => <div data-testid="assignee-picker" />,
}));

vi.mock('@alga-psa/ui/components/TeamAvatar', () => ({
  __esModule: true,
  default: () => <span data-testid="team-avatar" />,
}));

vi.mock('@alga-psa/ui/components/UserAvatar', () => ({
  __esModule: true,
  default: () => <span data-testid="user-avatar" />,
}));

vi.mock('@alga-psa/ui/components/Badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@alga-psa/ui/components/Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/ui/components/bento/BentoTile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/ui/components/bento/BentoTile')>()),
  BentoTile: ({ children, id }: { children: React.ReactNode; id: string }) => <section id={id}>{children}</section>,
  BentoTileEmpty: ({ children, id }: { children: React.ReactNode; id: string }) => <p id={id}>{children}</p>,
}));

vi.mock('@alga-psa/ui/editor', () => ({
  RichTextViewer: ({ id, content }: { id?: string; content: unknown }) => (
    <div data-testid={id ?? 'rich-text-viewer'}>{JSON.stringify(content)}</div>
  ),
  TextEditor: ({
    id,
    initialContent,
    onContentChange,
  }: {
    id: string;
    initialContent: unknown;
    onContentChange: (content: unknown) => void;
  }) => (
    <textarea
      data-testid={id}
      defaultValue={JSON.stringify(initialContent)}
      onChange={(event) => onContentChange(JSON.parse(event.target.value))}
    />
  ),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  searchUsersForMentions: vi.fn(),
}));

vi.mock('@alga-psa/core/context/DocumentsCrossFeatureContext', () => ({
  useDocumentsCrossFeature: () => ({ deleteDocument: vi.fn() }),
}));

// Stand-in for the clipboard-upload session: discarding routes straight to the
// component's onDiscard (no pasted images tracked in these tests).
vi.mock('../useTicketRichTextUploadSession', () => ({
  useTicketRichTextUploadSession: (options: { onDiscard: () => void }) => ({
    draftClipboardImages: [],
    isDeletingDraftImages: false,
    keepDraftClipboardImages: vi.fn(),
    requestDiscard: () => {
      requestDiscardMock();
      options.onDiscard();
    },
    resetDraftTracking: resetDraftTrackingMock,
    showDraftCancelDialog: false,
    setShowDraftCancelDialog: vi.fn(),
    uploadFile: vi.fn(),
    deleteTrackedDraftClipboardImages: vi.fn(),
  }),
}));

vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children, id }: { children: React.ReactNode; id?: string }) => <div id={id}>{children}</div>,
  AlertDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({
    isOpen,
    onConfirm,
    confirmLabel,
  }: {
    isOpen: boolean;
    onConfirm: () => void;
    confirmLabel: string;
  }) => (
    isOpen ? <button type="button" onClick={onConfirm}>{confirmLabel}</button> : null
  ),
}));

vi.mock('@alga-psa/ui/presence/FieldConflictBanner', () => ({
  FieldConflictBanner: ({ onTakeTheirs }: { onTakeTheirs: () => void }) => (
    <button type="button" data-testid="field-conflict-take-theirs" onClick={onTakeTheirs}>
      Take theirs
    </button>
  ),
}));

vi.mock('@alga-psa/tags/components', () => ({
  TagManager: () => <div data-testid="tag-manager" />,
}));

vi.mock('../TicketNotificationSuppressionControl', () => ({
  __esModule: true,
  default: ({
    value,
    onChange,
  }: {
    value: { suppressContactNotifications: boolean; suppressInternalNotifications: boolean };
    onChange: (value: { suppressContactNotifications: boolean; suppressInternalNotifications: boolean }) => void;
  }) => (
    <label>
      Don't notify the customer
      <input
        aria-label="Don't notify the customer"
        type="checkbox"
        checked={value.suppressContactNotifications}
        onChange={(event) => onChange({
          suppressContactNotifications: event.target.checked,
          suppressInternalNotifications: value.suppressInternalNotifications && event.target.checked,
        })}
      />
    </label>
  ),
}));

const descriptionBlocks = (text: string) => [
  {
    type: 'paragraph',
    props: { textAlignment: 'left', backgroundColor: 'default', textColor: 'default' },
    content: [{ type: 'text', text, styles: {} }],
  },
];

const watchList = [{ type: 'contact', id: 'contact-1', email: 'watcher@example.com' }];

const baseTicket = {
  ticket_id: 'ticket-1',
  tenant: 'tenant-1',
  title: 'Printer offline',
  attributes: {
    description: JSON.stringify(descriptionBlocks('Printer will not come online')),
    watch_list: watchList,
  },
  status_id: 'status-a',
  priority_id: 'priority-high',
  board_id: 'board-a',
  category_id: 'cat-a',
  subcategory_id: 'subcat-a',
  assigned_to: 'user-1',
  due_date: null,
  response_state: null,
  policyApplied: false,
};

function renderHero(overrides: Partial<React.ComponentProps<typeof BentoHero>> = {}) {
  const props: React.ComponentProps<typeof BentoHero> = {
    id: 'ticket-bento',
    ticket: baseTicket as any,
    statusOptions: [
      { value: 'status-a', label: 'Open', board_id: 'board-a' },
      { value: 'status-b', label: 'New board open', board_id: 'board-b' },
    ],
    priorityOptions: [
      { value: 'priority-high', label: 'High' },
      { value: 'priority-low', label: 'Low' },
    ],
    boardOptions: [
      { value: 'board-a', label: 'Support' },
      { value: 'board-b', label: 'Projects' },
    ],
    agentOptions: [],
    availableAgents: [],
    onSelectChange: vi.fn(),
    onBatchSelectChange: vi.fn().mockResolvedValue(true),
    onOpenAllFields: vi.fn(),
    onLiveDirtyFieldsChange: vi.fn(),
    ...overrides,
  };

  return { props, ...render(<BentoHero {...props} />) };
}

const readOnlySource = { ...nativeTicketDataSource, screen: { readOnly: true } } as any;

describe('BentoHero read-only data source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    crossFeatureRef.value = null;
    getTicketStatusesMock.mockResolvedValue([]);
    getTicketCategoriesByBoardMock.mockResolvedValue({ categories: [], boardConfig: { category_type: 'custom', priority_type: 'custom', display_itil_impact: false, display_itil_urgency: false } });
  });
  const renderIn = (source: any, ticket: any) => render(
    <TicketDataSourceProvider dataSource={source}><BentoHero id="ticket-bento" ticket={ticket} statusOptions={[]} priorityOptions={[]} boardOptions={[]}
      agentOptions={[]} availableAgents={[]} liveFrozenFields={resolveTicketFrozenFields(source.screen)} onSelectChange={vi.fn()} onBatchSelectChange={vi.fn()} onOpenAllFields={vi.fn()} onLiveDirtyFieldsChange={vi.fn()} /></TicketDataSourceProvider>);

  // The native source forwards each action through a lazy import(); settle those inside the test (in act, so the
  // resulting state updates are flushed) rather than leaving them pending for the file's teardown.
  const settleLazyActions = () => act(async () => { await vi.dynamicImportSettled(); });

  it('offers no "add a description" affordance when the source is read-only, but does natively', async () => {
    const ticket = { ...baseTicket, attributes: {} };
    const { unmount } = renderIn(readOnlySource, ticket);
    expect(document.getElementById('ticket-bento-description-empty')).toBeNull();
    unmount();
    renderIn(nativeTicketDataSource, ticket);
    expect(document.getElementById('ticket-bento-description-empty')).not.toBeNull();
    await settleLazyActions();
  });

  it('shows the attributed creator display name for "Opened by" when there is no local user record', async () => {
    renderIn(readOnlySource, { ...baseTicket, created_by_display_name: 'Piet de Vries' });
    expect(screen.getByText(/Opened by Piet de Vries/)).toBeInTheDocument();
    await settleLazyActions();
  });
});
