/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import TicketInfo from '../TicketInfo';
import { BentoHero } from '../bento/BentoHero';
import { TicketDataSourceProvider } from '../TicketDataSourceContext';
import { nativeTicketDataSource } from '../../../lib/nativeTicketDataSource';
import {
  NATIVE_TICKET_CAPABILITIES,
  composeTicketDataSource,
  resolveTicketFrozenFields,
  type TicketDataSource,
} from '../../../lib/ticketDataSource';

// The real TagManager and TagList render here; only their server actions and
// the tag context (which needs a provider) are stood in for.
const tagActions = vi.hoisted(() => ({
  createTag: vi.fn(),
  deleteTag: vi.fn(),
  getAllTags: vi.fn(),
  getTagMappingUsageCount: vi.fn(),
}));

vi.mock('../../../../../tags/src/actions', () => ({
  ...tagActions,
  isTagActionError: () => false,
}));

vi.mock('../../../../../tags/src/context/TagContext', () => ({
  useTags: () => ({
    tags: [],
    refetchTags: vi.fn(),
    getPermissions: async () => ({
      canAddExisting: true,
      canCreateNew: true,
      canEditColors: true,
      canEditText: true,
      canDelete: true,
      canDeleteAll: true,
    }),
  }),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({ resolvedTheme: 'light' }),
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
  RichTextViewer: ({ content }: { content: unknown }) => <div>{JSON.stringify(content)}</div>,
  TextEditor: () => <div data-testid="text-editor" />,
}));

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  __esModule: true,
  default: ({ id }: { id?: string }) => <div data-testid={id ?? 'custom-select'} />,
}));

vi.mock('@alga-psa/ui/components/tickets/PrioritySelect', () => ({
  PrioritySelect: () => <div data-testid="priority-select" />,
}));

vi.mock('@alga-psa/ui/components/UserAndTeamPicker', () => ({
  __esModule: true,
  default: () => <div data-testid="assignee-picker" />,
}));

vi.mock('../../CategoryPicker', () => ({
  CategoryPicker: () => <div data-testid="category-picker" />,
}));

vi.mock('../../QuickAddCategory', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('@alga-psa/ui/components/DatePicker', () => ({
  DatePicker: () => <div data-testid="date-picker" />,
}));

vi.mock('@alga-psa/ui/components/DateTimePicker', () => ({
  DateTimePicker: () => <div data-testid="date-time-picker" />,
}));

vi.mock('../../ResponseStateSelect', () => ({
  ResponseStateDisplay: () => <div data-testid="response-state" />,
}));

vi.mock('@alga-psa/ui/components/Tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/ui/components/UserAvatar', () => ({
  __esModule: true,
  default: () => <span data-testid="user-avatar" />,
}));

vi.mock('@alga-psa/ui/components/TeamAvatar', () => ({
  __esModule: true,
  default: () => <span data-testid="team-avatar" />,
}));

vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/bento/BentoTile', () => ({
  BentoTile: ({ children, id }: { children: React.ReactNode; id: string }) => <section id={id}>{children}</section>,
  BentoTileEmpty: ({ children, id }: { children: React.ReactNode; id: string }) => <p id={id}>{children}</p>,
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: () => null,
}));

vi.mock('@alga-psa/ui/components/sla', () => ({
  SlaStatusBadge: () => null,
}));

vi.mock('@alga-psa/ui/presence/FieldConflictBanner', () => ({
  FieldConflictBanner: () => null,
}));

vi.mock('@alga-psa/core/context/DocumentsCrossFeatureContext', () => ({
  useDocumentsCrossFeature: () => ({ deleteDocument: vi.fn() }),
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

vi.mock('../../../actions/ticketCategoryActions', () => ({
  getTicketCategories: vi.fn().mockResolvedValue([]),
  getTicketCategoriesByBoard: vi.fn().mockResolvedValue({
    categories: [],
    boardConfig: { category_type: 'custom', priority_type: 'custom', display_itil_impact: false, display_itil_urgency: false },
  }),
  createCategory: vi.fn(),
}));

vi.mock('../../../lib/ticketRichText', () => ({
  parseTicketRichTextContent: vi.fn().mockReturnValue([]),
  serializeTicketRichTextContent: vi.fn().mockReturnValue('[]'),
}));

vi.mock('../useTicketRichTextUploadSession', () => ({
  useTicketRichTextUploadSession: () => ({
    draftClipboardImages: [],
    isDeletingDraftImages: false,
    uploadFile: vi.fn(),
    requestDiscard: vi.fn(),
    resetDraftTracking: vi.fn(),
    showDraftCancelDialog: false,
    setShowDraftCancelDialog: vi.fn(),
    deleteTrackedDraftClipboardImages: vi.fn(),
    keepDraftClipboardImages: vi.fn(),
  }),
}));

vi.mock('../TicketNotificationSuppressionControl', () => ({
  __esModule: true,
  default: () => null,
}));

const existingTags = [
  { tag_id: 'mapping-1', tenant: 'tenant-1', tag_text: 'Escalated', tagged_id: 'ticket-1', tagged_type: 'ticket' as const },
  { tag_id: 'mapping-2', tenant: 'tenant-1', tag_text: 'VIP', tagged_id: 'ticket-1', tagged_type: 'ticket' as const },
];

const ticket = {
  ticket_id: 'ticket-1',
  tenant: 'tenant-1',
  ticket_number: 'T-1001',
  title: 'Printer offline',
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

/** The customer workspace screen the ticket page composes: native, tags on, read-only when the lifecycle cannot write. */
function workspaceDataSource(readOnly: boolean): TicketDataSource {
  return composeTicketDataSource(nativeTicketDataSource, {
    capabilities: { ...NATIVE_TICKET_CAPABILITIES, timeEntry: false },
    ...(readOnly ? { screen: { readOnly: true } } : {}),
  });
}

function renderEntry(dataSource: TicketDataSource) {
  return render(
    <TicketDataSourceProvider dataSource={dataSource}>
      <TicketInfo
        id="ticket-info"
        ticket={ticket}
        conversations={[]}
        statusOptions={[{ value: 'status-a', label: 'Open' }]}
        agentOptions={[]}
        boardOptions={[{ value: 'board-a', label: 'Board A' }]}
        priorityOptions={[{ value: 'priority-1', label: 'Priority 1' }]}
        onSelectChange={vi.fn()}
        onSaveChanges={vi.fn().mockResolvedValue(true)}
        responseStateTrackingEnabled={false}
        liveFrozenFields={resolveTicketFrozenFields(dataSource.screen)}
        tags={existingTags}
        onTagsChange={vi.fn()}
      />
    </TicketDataSourceProvider>,
  );
}

function renderGrid(dataSource: TicketDataSource) {
  return render(
    <TicketDataSourceProvider dataSource={dataSource}>
      <BentoHero
        id="ticket-bento"
        ticket={ticket}
        statusOptions={[{ value: 'status-a', label: 'Open', board_id: 'board-a' }]}
        priorityOptions={[{ value: 'priority-1', label: 'Priority 1' }]}
        boardOptions={[{ value: 'board-a', label: 'Board A' }]}
        agentOptions={[]}
        availableAgents={[]}
        onSelectChange={vi.fn()}
        onBatchSelectChange={vi.fn().mockResolvedValue(true)}
        onOpenAllFields={vi.fn()}
        onLiveDirtyFieldsChange={vi.fn()}
        tags={existingTags}
        onTagsChange={vi.fn()}
      />
    </TicketDataSourceProvider>,
  );
}

/** Any control that adds, removes, or edits a tag: the add button (popover or inline), remove X, edit chevron. */
function tagMutationControls(container: HTMLElement) {
  return {
    add: container.querySelectorAll('#tag-add-button, [id$="-input-button"]'),
    remove: screen.queryAllByTitle('Remove tag'),
    edit: Array.from(container.querySelectorAll('span[title="Escalated"] button, span[title="VIP"] button'))
      .filter((button) => button.getAttribute('title') !== 'Remove tag'),
  };
}

const layouts = [
  ['Entry', renderEntry],
  ['Grid', renderGrid],
] as const;

describe.each(layouts)('%s layout ticket tags', (_name, renderLayout) => {
  beforeEach(() => {
    vi.clearAllMocks();
    tagActions.getAllTags.mockResolvedValue([]);
  });

  it('shows existing tags with no add, remove, or edit affordance when the screen is read-only', async () => {
    const { container } = renderLayout(workspaceDataSource(true));
    expect(await screen.findByText('Escalated')).toBeInTheDocument();
    expect(screen.getByText('VIP')).toBeInTheDocument();
    // Let the permission lookup settle: read-only must hold even after full permissions arrive.
    await waitFor(() => expect(screen.getByText('VIP')).toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 0));
    const controls = tagMutationControls(container);
    expect(controls.add).toHaveLength(0);
    expect(controls.remove).toHaveLength(0);
    expect(controls.edit).toHaveLength(0);
    expect(tagActions.createTag).not.toHaveBeenCalled();
    expect(tagActions.deleteTag).not.toHaveBeenCalled();
  });

  it('offers add, remove, and edit on an active (writable) workspace', async () => {
    const { container } = renderLayout(workspaceDataSource(false));
    expect(await screen.findByText('Escalated')).toBeInTheDocument();
    await waitFor(() => expect(tagMutationControls(container).add.length).toBeGreaterThan(0));
    const controls = tagMutationControls(container);
    expect(controls.remove).toHaveLength(existingTags.length);
    expect(controls.edit).toHaveLength(existingTags.length);
  });
});

describe('Entry layout save bar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tagActions.getAllTags.mockResolvedValue([]);
  });

  it('shows no Save or Cancel when the screen is read-only', async () => {
    const { container } = renderEntry(workspaceDataSource(true));
    expect(await screen.findByText('Escalated')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.querySelector('#ticket-info-save-changes-btn')).toBeNull();
    expect(container.querySelector('#ticket-info-cancel-btn')).toBeNull();
  });

  it('shows Save and Cancel on a writable screen', async () => {
    const { container } = renderEntry(workspaceDataSource(false));
    expect(await screen.findByText('Escalated')).toBeInTheDocument();
    expect(container.querySelector('#ticket-info-save-changes-btn')).not.toBeNull();
    expect(container.querySelector('#ticket-info-cancel-btn')).not.toBeNull();
  });
});
