/* @vitest-environment jsdom */
// T002 (bento layout) and T003 harness check: capability gating of every section.
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TicketBentoLayout, type TicketBentoLayoutProps } from './TicketBentoLayout';
import { TicketDataSourceProvider } from '../TicketDataSourceContext';
import { nativeTicketDataSource } from '../../../lib/nativeTicketDataSource';
import { NATIVE_TICKET_CAPABILITIES, NO_TICKET_CAPABILITIES, composeTicketDataSource, type TicketCapabilityKey } from '../../../lib/ticketDataSource';
import { createTicketIdGuardDataSource } from '../../../lib/testing/ticketIdGuardDataSource';

vi.mock('@alga-psa/ui/components/Button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@alga-psa/ui/components/Input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@alga-psa/ui/components/Label', () => ({
  Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => <label {...props}>{children}</label>,
}));

vi.mock('@alga-psa/ui/components/ContactPicker', () => ({ ContactPicker: () => null }));
vi.mock('@alga-psa/ui/components/ClientPicker', () => ({ ClientPicker: () => null }));
vi.mock('@alga-psa/ui/components/ContactAvatar', () => ({ __esModule: true, default: () => null }));
vi.mock('@alga-psa/ui/components/ClientAvatar', () => ({ __esModule: true, default: () => null }));
vi.mock('@alga-psa/ui/components/TeamAvatar', () => ({ __esModule: true, default: () => null }));
vi.mock('@alga-psa/ui/components/MultiUserAndTeamPicker', () => ({ __esModule: true, default: () => <div data-testid="s-team-picker" /> }));
vi.mock('@alga-psa/ui/components/CallLink', () => ({ CallLink: () => null }));

vi.mock('@alga-psa/ui/components', () => ({
  ContentCardVariantProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ContentCardFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/components/bento/BentoBoard', () => ({
  BentoBoard: ({ tiles, main }: { tiles: Array<{ key: string; node: React.ReactNode }>; main?: React.ReactNode }) => (
    <div>
      {tiles.map((tile) => <div key={tile.key}>{tile.node}</div>)}
      {main}
    </div>
  ),
}));

vi.mock('@alga-psa/ui/ui-reflection/withDataAutomationId', () => ({
  withDataAutomationId: ({ id }: { id: string }) => ({ 'data-testid': id }),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getUserAvatarUrlsBatchAction: vi.fn().mockResolvedValue({}),
}));

vi.mock('@alga-psa/teams/actions', () => ({
  getTeamAvatarUrlsBatchAction: vi.fn().mockResolvedValue({}),
}));

vi.mock('@alga-psa/ui/context', () => ({
  useOptionalActivityCrossFeature: () => null,
  useQuickAddClient: () => ({
    renderQuickAddContact: () => null,
    renderQuickAddInteraction: () => null,
    openInteractionDetails: vi.fn(),
  }),
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : _key),
  }),
}));

vi.mock('@alga-psa/ui/components/bento/BentoTile', () => ({
  BentoTile: ({ children, action }: { children?: React.ReactNode; action?: React.ReactNode }) => <div data-testid="bento-tile">{action}{children}</div>,
  BentoTileEmpty: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  BentoTileEmptyScope: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  BentoTileAddButton: ({ id }: { id: string }) => <button type="button" data-testid={id} />,
  BentoTileSkeleton: () => <div />,
  BentoCollapseEmptyTiles: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock('./BentoHero', () => ({ BentoHero: () => <div data-testid="bento-hero" /> }));
vi.mock('./BentoTimelineTile', () => ({ BentoTimelineTile: () => <div data-testid="bento-timeline" /> }));
vi.mock('./SlaClocksTile', () => ({ SlaClocksTile: () => <div data-testid="sla-clocks" /> }));
vi.mock('./dataTiles', () => ({
  ScheduledWorkTile: (props: { onSchedule?: () => void }) => <div data-testid="s-scheduling" data-can-schedule={String(Boolean(props.onSchedule))} />,
  AppointmentRequestsTile: () => <div data-testid="s-appointmentRequests" />,
  CallsEmailsTile: (props: { onLogInteraction?: () => void }) => <div data-testid="calls-emails" data-can-log={String(Boolean(props.onLogInteraction))} />,
  BillingSummary: () => <div data-testid="s-billing" />,
}));
vi.mock('./TimeLoggedSummary', () => ({ TimeLoggedSummary: () => null }));
vi.mock('./useTeamAvatarUrl', () => ({ useTeamAvatarUrl: () => null }));
vi.mock('../TicketChecklistSection', () => ({ __esModule: true, default: () => <div data-testid="s-checklist" /> }));
vi.mock('../TicketCredentialsSection', () => ({ TicketCredentialsSection: () => <div data-testid="s-credentials" /> }));
vi.mock('../TicketExternalLinksSection', () => ({ TicketExternalLinksSection: () => <div data-testid="s-externalLinks" /> }));
vi.mock('./DocumentsTile', () => ({ DocumentsTile: () => <div data-testid="s-documents" /> }));
vi.mock('../TicketStopwatchControls', () => ({
  TicketStopwatchControls: ({ id }: { id: string }) => <div data-testid={`${id}-stopwatch-controls`} />,
}));
vi.mock('../TicketTimeEntries', () => ({ __esModule: true, default: () => null }));
vi.mock('../TicketMaterialsCard', () => ({ __esModule: true, default: () => <div data-testid="s-materials" /> }));
vi.mock('../TicketWatchListCard', () => ({ __esModule: true, default: () => <div data-testid="s-watch-list" /> }));

function baseProps(overrides: Partial<TicketBentoLayoutProps> = {}): TicketBentoLayoutProps {
  return {
    id: 'bento',
    ticket: {
      ticket_id: 'ticket-1',
      ticket_number: '1001',
      client_id: 'client-1',
      assigned_to: null,
      assigned_team_id: null,
      entered_at: '2026-03-08T10:00:00.000Z',
      attributes: {},
    } as any,
    statusOptions: [],
    priorityOptions: [],
    boardOptions: [],
    agentOptions: [],
    onSelectChange: vi.fn(),
    onOpenAllFields: vi.fn(),
    conversations: [],
    userMap: {},
    contactMap: {},
    timelineRefreshKey: 0,
    timelineInitialOrder: 'asc',
    editorKey: 0,
    onNewCommentContentChange: vi.fn(),
    onAddNewComment: vi.fn().mockResolvedValue(true),
    isEditing: false,
    currentComment: null,
    onContentChange: vi.fn(),
    onSaveComment: vi.fn(),
    onCloseEdit: vi.fn(),
    onEditComment: vi.fn(),
    onDeleteComment: vi.fn(),
    onContactClick: vi.fn(),
    onClientClick: vi.fn(),
    checklistItems: [],
    onChecklistItemsChanged: vi.fn(),
    timeDescription: '',
    onTimeDescriptionChange: vi.fn(),
    onAddTimeEntry: vi.fn(),
    additionalAgents: [],
    availableAgents: [],
    onAddAgent: vi.fn(),
    onRemoveAgent: vi.fn(),
    documents: [],
    onDocumentCreated: vi.fn().mockResolvedValue(undefined),
    surveySummaryCard: <div data-testid="s-survey" />,
    associatedAssets: <div data-testid="s-assets" />,
    ...overrides,
  } as TicketBentoLayoutProps;
}


const SECTIONS: Array<[TicketCapabilityKey, string]> = [
  ['checklist', 's-checklist'],
  ['documents', 's-documents'],
  ['credentials', 's-credentials'],
  ['externalLinks', 's-externalLinks'],
  ['materials', 's-materials'],
  ['billing', 's-billing'],
  ['scheduling', 's-scheduling'],
  ['survey', 's-survey'],
  ['assets', 's-assets'],
  ['sla', 'sla-clocks'],
  ['timeEntry', 'bento-add-time-entry'],
];

const withCaps = (caps: Partial<Record<TicketCapabilityKey, boolean>>) =>
  composeTicketDataSource(nativeTicketDataSource, {
    capabilities: { ...NO_TICKET_CAPABILITIES, ...caps } as typeof NATIVE_TICKET_CAPABILITIES,
  });

function renderWith(ds: typeof nativeTicketDataSource, overrides: Partial<TicketBentoLayoutProps> = {}) {
  return render(
    <TicketDataSourceProvider dataSource={ds}>
      <TicketBentoLayout {...baseProps(overrides)} />
    </TicketDataSourceProvider>,
  );
}

describe('T002 bento layout capability gating', () => {
  it('renders every gated section under the native default', () => {
    render(<TicketBentoLayout {...baseProps()} />);
    for (const [, testId] of SECTIONS) expect(screen.getByTestId(testId)).toBeTruthy();
  });

  it('renders none of the gated sections, and no placeholders, when all capabilities are off', () => {
    renderWith(withCaps({}));
    for (const [, testId] of SECTIONS) expect(screen.queryByTestId(testId)).toBeNull();
  });

  // Mutation check: each capability alone must bring back exactly its own section.
  // If any gate in TicketBentoLayout were removed the "all off" test above fails;
  // if a gate pointed at the wrong key this positive control fails.
  it.each(SECTIONS)('capability %s alone enables only its own section', (key, testId) => {
    renderWith(withCaps({ [key]: true }));
    for (const [, other] of SECTIONS) {
      if (other === testId) expect(screen.getByTestId(other)).toBeTruthy();
      else expect(screen.queryByTestId(other)).toBeNull();
    }
  });

  // Guide 10 Grid audit: an ended (read-only) workspace offers no schedule or log-interaction add actions.
  it('withholds the schedule and log-interaction add actions on a read-only screen', () => {
    const readOnly = composeTicketDataSource(nativeTicketDataSource, { screen: { readOnly: true } });
    const { unmount } = renderWith(readOnly, { onScheduleWork: vi.fn() } as Partial<TicketBentoLayoutProps>);
    expect(screen.getByTestId('s-scheduling').getAttribute('data-can-schedule')).toBe('false');
    expect(screen.getByTestId('calls-emails').getAttribute('data-can-log')).toBe('false');
    unmount();
    renderWith(composeTicketDataSource(nativeTicketDataSource, {}), { onScheduleWork: vi.fn() } as Partial<TicketBentoLayoutProps>);
    expect(screen.getByTestId('s-scheduling').getAttribute('data-can-schedule')).toBe('true');
  });

  it('renders the appSection slot node and works under the ticket-id guard source', () => {
    const guarded = createTicketIdGuardDataSource({ capabilities: { ...NO_TICKET_CAPABILITIES } as typeof NATIVE_TICKET_CAPABILITIES });
    renderWith(guarded, { appSection: <div data-testid="s-app-section" /> });
    expect(screen.getByTestId('s-app-section')).toBeTruthy();
  });
});

describe('native neutrality: live-conflict fields do not reach the tile gates', () => {
  const liveFrozenFields = ['additional_agents', 'watch_list', 'client_id', 'contact_name_id'];
  const props: Partial<TicketBentoLayoutProps> = {
    liveFrozenFields,
    onChangeClient: vi.fn(),
    onChangeContact: vi.fn(),
    client: { client_id: 'client-1', client_name: 'Acme' } as any,
    contactInfo: { contact_name_id: 'c-1', full_name: 'Pat' } as any,
  };

  it('still offers Team, Watch list, change-client and edit-contact on a native ticket', () => {
    renderWith(nativeTicketDataSource, props);
    expect(screen.getByTestId('s-watch-list')).toBeTruthy();
    expect(screen.getByTestId('s-team-picker')).toBeTruthy();
    expect(document.getElementById('bento-client-edit')).not.toBeNull();
    expect(document.getElementById('bento-contact-edit')).not.toBeNull();
  });

  it('hides them only when the screen itself declares the fields frozen', () => {
    const frozen = composeTicketDataSource(nativeTicketDataSource, {
      screen: { frozenFields: liveFrozenFields },
    });
    renderWith(frozen, props);
    expect(screen.queryByTestId('s-watch-list')).toBeNull();
    expect(screen.queryByTestId('s-team-picker')).toBeNull();
    expect(document.getElementById('bento-client-edit')).toBeNull();
    expect(document.getElementById('bento-contact-edit')).toBeNull();
  });
});
