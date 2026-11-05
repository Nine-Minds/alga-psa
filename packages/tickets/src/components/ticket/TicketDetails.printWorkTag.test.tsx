/* @vitest-environment jsdom */

/**
 * "Print work tag" on the ticket detail view opens LabelPrintDialog (ticket-work-tag) for this
 * ticket, with Title = ticket title and Reason prefilled from subcategory else category.
 *
 * TicketDetails is a ~4.8k-line container, so every child component, server action and context
 * hook is replaced with an inert stub (see `autoMock`); only the print button + dialog wiring and
 * the Reason derivation are real.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import TicketDetails from './TicketDetails';

const h = vi.hoisted(() => {
  const NullComponent = () => null;
  // Module whose every export is an inert stub: Capitalised names -> null component, others -> async no-op.
  const autoMock = (overrides: Record<string, unknown> = {}) => () =>
    new Proxy(overrides, {
      has: () => true,
      get(target, key) {
        if (typeof key !== 'string') return undefined;
        if (key === 'then') return undefined;
        if (key in target) return target[key];
        if (key === '__esModule') return true;
        if (key === 'default' || /^[A-Z]/.test(key)) return NullComponent;
        return async () => undefined;
      },
    });
  return { autoMock, NullComponent };
});

// ---- the dialog under test ----
vi.mock('@alga-psa/ui/components', () => ({
  ResponseStateBadge: () => null,
  LabelPrintDialog: (props: any) => (
    <div
      data-testid="label-dialog"
      data-label-class={props.labelClass}
      data-ids={JSON.stringify(props.ids)}
      data-default-title={props.defaultTitle}
      data-default-detail={props.defaultDetail}
    />
  ),
}));

// ---- framework / context hooks ----
vi.mock('next/link', () => ({ default: ({ children }: any) => <a>{children}</a> }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/msp/tickets/t-1',
}));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null, status: 'unauthenticated' }) }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() }, default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@alga-psa/ui/lib/i18n/client', () => {
  const t = (key: string, options?: any) => String(typeof options === 'string' ? options : options?.defaultValue ?? key);
  const value = { t };
  const formatters = {
    formatDate: () => '', formatNumber: () => '', formatCurrency: () => '', formatRelativeTime: () => '',
    locale: 'en', dateFormat: 'MM/dd/yyyy',
  };
  return { useTranslation: () => value, useFormatters: () => formatters };
});
vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), closeDrawer: vi.fn(), replaceDrawer: vi.fn() }),
}));
vi.mock('@alga-psa/ui/keyboard-shortcuts', () => ({ useCatalogShortcut: () => undefined }));
vi.mock('@alga-psa/ui/context', () => ({ useSchedulingCallbacks: () => ({}) }));
vi.mock('@alga-psa/core/context/DocumentsCrossFeatureContext', () => ({
  useDocumentsCrossFeature: () => ({}),
}));
vi.mock('@alga-psa/tags/context', () => ({ useTags: () => ({ tags: [], addTag: vi.fn(), removeTag: vi.fn() }) }));
vi.mock('./TicketLiveProvider', () => ({
  useTicketLiveContext: () => ({
    enabled: false, reconnectVersion: 0, presence: [], connectionStatus: 'disconnected',
    lastRemoteUpdate: null, setEditingField: vi.fn(),
  }),
}));
vi.mock('../templates/useTicketTemplatePermissions', () => ({
  useTicketTemplatePermissions: () => ({ canCreate: false, canUse: false, canManage: false }),
}));

// ---- UI primitives that need providers ----
vi.mock('@alga-psa/ui/ui-reflection/ReflectionContainer', () => ({
  ReflectionContainer: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, variant: _v, size: _s, ...props }: any) => <button {...props}>{children}</button>,
}));
vi.mock('@alga-psa/ui/components/DropdownMenu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <>{children}</>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  // Print work tag is a More-menu item; render items as clickable buttons.
  DropdownMenuItem: ({ children, onSelect, id }: any) => (
    <button type="button" id={id} onClick={() => onSelect?.()}>{children}</button>
  ),
  DropdownMenuSeparator: () => <hr />,
}));
vi.mock('@alga-psa/ui/components/Dialog', h.autoMock());
vi.mock('@alga-psa/ui/components/Drawer', h.autoMock());
vi.mock('@alga-psa/ui/components/ConfirmationDialog', h.autoMock());
vi.mock('@alga-psa/ui/components/DeleteEntityDialog', h.autoMock());
vi.mock('@alga-psa/ui/components/TextArea', h.autoMock());
vi.mock('@alga-psa/ui/components/Input', h.autoMock());
vi.mock('@alga-psa/ui/components/CustomSelect', h.autoMock());
vi.mock('@alga-psa/ui/components/Label', h.autoMock());
vi.mock('@alga-psa/ui/components/BackNav', h.autoMock());
vi.mock('@alga-psa/ui/presence/PresenceBar', h.autoMock());
vi.mock('@alga-psa/ui/editor/hasEditorContent', h.autoMock({ hasEditorContent: () => false }));

// ---- other packages ----
vi.mock('@alga-psa/tags/components', h.autoMock());
vi.mock('@alga-psa/tags/actions', h.autoMock({ findTagsByEntityId: async () => [], isTagActionError: () => false }));
vi.mock('@alga-psa/auth/lib/preCheckDeletion', h.autoMock());
vi.mock('@alga-psa/user-composition/actions', h.autoMock({ getCurrentUserPermissions: async () => [] }));
vi.mock('@alga-psa/reference-data/actions', h.autoMock({ getTicketStatuses: async () => [], getAllPriorities: async () => [] }));
vi.mock('@alga-psa/teams/actions', h.autoMock({ isTeamActionError: () => false }));
vi.mock('@alga-psa/formatting/blocknoteUtils', h.autoMock());
vi.mock('@blocknote/core', () => ({}));

// ---- sibling server actions ----
vi.mock('../../actions/ticketDisplaySettings', h.autoMock());
vi.mock('../../actions/board-actions/boardActions', h.autoMock());
vi.mock('../../actions/comment-actions/commentActions', h.autoMock({ findCommentsByTicketId: async () => [] }));
vi.mock('../../actions/comment-actions/clipboardImageDraftActions', h.autoMock());
vi.mock('../../actions/clientLookupActions', h.autoMock());
vi.mock('../../actions/optimizedTicketActions', h.autoMock());
vi.mock('../../actions/ticketActions', h.autoMock());
vi.mock('../../actions/close-rules/closeRuleActions', h.autoMock());
vi.mock('../../actions/checklists/ticketChecklistActions', h.autoMock({ getTicketChecklistItems: async () => [] }));
vi.mock('../../actions/ticketBundleActions', h.autoMock());
vi.mock('../../actions/ticketResourceActions', h.autoMock({ getTicketResources: async () => [] }));
vi.mock('../../actions/teamAssignmentActions', h.autoMock());
vi.mock('../../actions/ticketLayoutPreference', h.autoMock({ getTicketLayoutPreference: async () => 'stacked' }));
vi.mock('../../actions/recurringTicketActions', h.autoMock());

// ---- sibling components ----
vi.mock('./TicketInfo', h.autoMock());
vi.mock('./TicketNotificationSuppressionControl', h.autoMock());
vi.mock('./TicketProperties', h.autoMock());
vi.mock('./TicketDocumentsSection', h.autoMock());
vi.mock('./TicketCredentialsSection', h.autoMock());
vi.mock('./TicketExternalLinksSection', h.autoMock());
vi.mock('./TicketEmailNotifications', h.autoMock());
vi.mock('./TicketConversation', h.autoMock());
vi.mock('./TicketActivityTimeline', h.autoMock());
vi.mock('./TicketChecklistSection', h.autoMock({ summarizeChecklist: () => ({ total: 0, done: 0 }) }));
vi.mock('./AgentScheduleDrawer', h.autoMock());
vi.mock('./TicketNavigation', h.autoMock());
vi.mock('./bento/LayoutToggle', h.autoMock());
vi.mock('./bento/TicketBentoLayout', h.autoMock());
vi.mock('../TicketOriginBadge', h.autoMock());
vi.mock('../BundleStatusPropagationDialog', h.autoMock());
vi.mock('./ClosedMasterChoiceFields', h.autoMock());
vi.mock('./TicketResolutionDialog', h.autoMock());

const cat = (id: string, name: string, parent?: string) =>
  ({ category_id: id, category_name: name, parent_category: parent ?? null }) as any;

const categories = [cat('cat-1', 'Hardware'), cat('sub-1', 'Laptops', 'cat-1')];

function renderDetails(ticketOverrides: Record<string, unknown>) {
  const ticket = {
    ticket_id: 'ticket-42',
    ticket_number: 'T-42',
    title: 'Screen is cracked',
    tenant: 'tenant-1',
    ...ticketOverrides,
  } as any;
  render(<TicketDetails id="td" initialTicket={ticket} initialCategories={categories} currentUser={{ id: 'u1' } as any} />);
}

async function openDialog() {
  const button = await waitFor(() => {
    const el = document.getElementById('td-print-work-tag-button');
    if (!el) throw new Error('print work tag button not rendered');
    return el;
  });
  expect(screen.queryByTestId('label-dialog')).toBeNull();
  await userEvent.click(button);
  return screen.getByTestId('label-dialog');
}

describe('TicketDetails print work tag', () => {
  afterEach(cleanup);

  it('prefills Reason with the subcategory name when both are set', async () => {
    renderDetails({ category_id: 'cat-1', subcategory_id: 'sub-1' });
    const dialog = await openDialog();
    expect(dialog.getAttribute('data-label-class')).toBe('ticket-work-tag');
    expect(JSON.parse(dialog.getAttribute('data-ids')!)).toEqual(['ticket-42']);
    expect(dialog.getAttribute('data-default-title')).toBe('Screen is cracked');
    expect(dialog.getAttribute('data-default-detail')).toBe('Laptops');
  });

  it('prefills Reason with the category name when there is no subcategory', async () => {
    renderDetails({ category_id: 'cat-1', subcategory_id: null });
    const dialog = await openDialog();
    expect(dialog.getAttribute('data-default-detail')).toBe('Hardware');
  });

  it('prefills Reason with an empty string when the ticket has no category', async () => {
    renderDetails({ category_id: null, subcategory_id: null });
    const dialog = await openDialog();
    expect(dialog.getAttribute('data-default-detail')).toBe('');
    expect(dialog.getAttribute('data-default-title')).toBe('Screen is cracked');
  });
});
