/* @vitest-environment jsdom */
// Grid layout: the Assets tile mounts the associated-assets panel with Receive equipment in its footer (alga-2026-0002683 C4 follow-up 1/3).
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
  ContentCardFooter: ({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) => <div>{children}{footer}</div>,
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
    receiveEquipmentActions: <button type="button" data-testid="s-receive-equipment">Receive equipment</button>,
    ...overrides,
  } as TicketBentoLayoutProps;
}


function renderWith(ds: typeof nativeTicketDataSource, overrides: Partial<TicketBentoLayoutProps> = {}) {
  return render(
    <TicketDataSourceProvider dataSource={ds}>
      <TicketBentoLayout {...baseProps(overrides)} />
    </TicketDataSourceProvider>,
  );
}

describe('Grid layout Assets tile', () => {
  it('mounts the associatedAssets panel with Receive equipment in the same tile container', () => {
    renderWith(nativeTicketDataSource);
    const container = document.getElementById('bento-assets-container')!;
    expect(container).not.toBeNull();
    expect(container.contains(screen.getByTestId('s-assets'))).toBe(true);
    expect(container.contains(screen.getByTestId('s-receive-equipment'))).toBe(true);
  });

  it('omits the tile, and Receive equipment with it, when the assets capability is off', () => {
    renderWith(composeTicketDataSource(nativeTicketDataSource, {
      capabilities: { ...NATIVE_TICKET_CAPABILITIES, assets: false },
    }));
    expect(screen.queryByTestId('s-assets')).toBeNull();
    expect(screen.queryByTestId('s-receive-equipment')).toBeNull();
  });

  it('keeps the panel mounted (same node) across a re-render, so a receive refreshes it through SWR rather than a remount', () => {
    const { rerender } = renderWith(nativeTicketDataSource);
    const before = screen.getByTestId('s-assets');
    rerender(
      <TicketDataSourceProvider dataSource={nativeTicketDataSource}>
        <TicketBentoLayout {...baseProps({ timelineRefreshKey: 1 })} />
      </TicketDataSourceProvider>,
    );
    expect(screen.getByTestId('s-assets')).toBe(before);
  });
});
