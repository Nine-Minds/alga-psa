/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TicketBentoLayout, type TicketBentoLayoutProps } from './TicketBentoLayout';

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
vi.mock('@alga-psa/ui/components/MultiUserAndTeamPicker', () => ({ __esModule: true, default: () => null }));
vi.mock('@alga-psa/ui/components/CallLink', () => ({ CallLink: () => null }));

vi.mock('@alga-psa/ui/components', () => ({
  ContentCardVariantProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
  BentoTile: ({ children }: { children?: React.ReactNode }) => <div data-testid="bento-tile">{children}</div>,
  BentoTileEmpty: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  BentoTileSkeleton: () => <div />,
}));

vi.mock('./BentoHero', () => ({ BentoHero: () => <div data-testid="bento-hero" /> }));
vi.mock('./BentoTimelineTile', () => ({ BentoTimelineTile: () => <div data-testid="bento-timeline" /> }));
vi.mock('./SlaClocksTile', () => ({ SlaClocksTile: () => <div data-testid="sla-clocks" /> }));
vi.mock('./dataTiles', () => ({
  ScheduledWorkTile: () => null,
  AppointmentRequestsTile: () => null,
  CallsEmailsTile: () => null,
  BillingTile: () => null,
}));
vi.mock('./TimeLoggedSummary', () => ({ TimeLoggedSummary: () => null }));
vi.mock('./useTeamAvatarUrl', () => ({ useTeamAvatarUrl: () => null }));
vi.mock('../TicketChecklistSection', () => ({ __esModule: true, default: () => null }));
vi.mock('../TicketCredentialsSection', () => ({ TicketCredentialsSection: () => null }));
vi.mock('../TicketExternalLinksSection', () => ({ TicketExternalLinksSection: () => null }));
vi.mock('./DocumentsTile', () => ({ DocumentsTile: () => null }));
vi.mock('../TicketTimeEntries', () => ({ __esModule: true, default: () => null }));
vi.mock('../TicketMaterialsCard', () => ({ __esModule: true, default: () => null }));
vi.mock('../TicketWatchListCard', () => ({ __esModule: true, default: () => null }));

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
    elapsedTime: 0,
    isRunning: false,
    timeDescription: '',
    onTimeDescriptionChange: vi.fn(),
    onStart: vi.fn(),
    onPause: vi.fn(),
    onStop: vi.fn(),
    onAddTimeEntry: vi.fn(),
    additionalAgents: [],
    availableAgents: [],
    onAddAgent: vi.fn(),
    onRemoveAgent: vi.fn(),
    documents: [],
    onDocumentCreated: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as TicketBentoLayoutProps;
}

describe('TicketBentoLayout add time entry button', () => {
  it('disables the button and shows the spinner while a launch is pending', () => {
    render(<TicketBentoLayout {...baseProps({ isLaunchingTimeEntry: true })} />);

    const button = screen.getByTestId('bento-add-time-entry');
    expect(button).toBeDisabled();
    expect(button.querySelector('[role="status"]')).not.toBeNull();
    expect(button).toHaveTextContent('Add time entry');
  });

  it('keeps the button enabled without a spinner when no launch is pending', () => {
    render(<TicketBentoLayout {...baseProps({ isLaunchingTimeEntry: false })} />);

    const button = screen.getByTestId('bento-add-time-entry');
    expect(button).not.toBeDisabled();
    expect(button.querySelector('[role="status"]')).toBeNull();
  });
});
