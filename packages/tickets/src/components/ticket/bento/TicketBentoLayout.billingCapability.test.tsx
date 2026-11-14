/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

/**
 * The grid layout used to hide two fields the list layout always showed: the
 * ticket's location (a bare, unlabelled line that only appeared for an
 * explicitly set location) and its billing profile (absent entirely). Both
 * decide where work happens and who is charged for it, so the tile shows them.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TicketBentoLayout, type TicketBentoLayoutProps } from './TicketBentoLayout';
import { TicketDataSourceProvider } from '../TicketDataSourceContext';
import { nativeTicketDataSource } from '../../../lib/nativeTicketDataSource';
import { composeTicketDataSource, SEAT_TECHNICIAN_TICKET_CAPABILITIES } from '../../../lib/ticketDataSource';

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

vi.mock('@alga-psa/ui/components/CustomSelect', () => ({
  __esModule: true,
  default: ({
    id,
    value,
    options,
    onValueChange,
  }: {
    id?: string;
    value?: string;
    options: { value: string; label: string }[];
    onValueChange?: (value: string) => void;
  }) => (
    <select id={id} value={value} onChange={(event) => onValueChange?.(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@alga-psa/ui/components/BillingProfilePicker', () => ({
  BillingProfilePicker: ({ id, clientId, value }: { id: string; clientId?: string | null; value?: string | null }) => (
    <div data-testid={id} data-client-id={clientId ?? ''} data-value={value ?? ''} />
  ),
}));

vi.mock('@alga-psa/ui/components', () => ({
  ContentCardVariantProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@alga-psa/ui/ui-reflection/withDataAutomationId', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/ui/ui-reflection/withDataAutomationId')>()),
  withDataAutomationId: ({ id }: { id: string }) => ({ 'data-testid': id }),
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getUserAvatarUrlsBatchAction: vi.fn().mockResolvedValue({}),
}));

vi.mock('@alga-psa/teams/actions', () => ({
  getTeamAvatarUrlsBatchAction: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../actions/clientLookupActions', () => ({
  getClientBillingProfiles: vi.fn().mockResolvedValue([]),
  searchClientsForPicker: vi.fn(),
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

vi.mock('@alga-psa/ui/components/bento/BentoTile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/ui/components/bento/BentoTile')>()),
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
  BillingSummary: () => null,
}));
vi.mock('./TimeLoggedSummary', () => ({ TimeLoggedSummary: () => null }));
vi.mock('./useTeamAvatarUrl', () => ({ useTeamAvatarUrl: () => null }));
vi.mock('../TicketChecklistSection', () => ({ __esModule: true, default: () => null }));
vi.mock('../TicketCredentialsSection', () => ({ TicketCredentialsSection: () => null }));
vi.mock('../TicketExternalLinksSection', () => ({ TicketExternalLinksSection: () => null }));
vi.mock('./DocumentsTile', () => ({ DocumentsTile: () => null }));
vi.mock('../TicketStopwatchControls', () => ({ TicketStopwatchControls: () => null }));
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
    client: { client_id: 'client-1', client_name: 'Emerald City Co' } as any,
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
    ...overrides,
  } as TicketBentoLayoutProps;
}

const seatDataSource = composeTicketDataSource(nativeTicketDataSource, { capabilities: { ...SEAT_TECHNICIAN_TICKET_CAPABILITIES } });

describe('TicketBentoLayout billing profile picker (F049)', () => {
  const props = () => baseProps({
    ticket: { ...(baseProps().ticket as any), billing_profile_id: 'profile-2' },
    onChangeBillingProfile: vi.fn(),
  });

  it('is rendered for a native viewer', () => {
    render(<TicketBentoLayout {...props()} />);
    expect(screen.queryByTestId('bento-billing-profile-picker')).not.toBeNull();
  });

  it('is absent from the tree when the billing capability is off', () => {
    render(
      <TicketDataSourceProvider dataSource={seatDataSource}>
        <TicketBentoLayout {...props()} />
      </TicketDataSourceProvider>,
    );
    expect(screen.queryByTestId('bento-billing-profile-picker')).toBeNull();
    expect(document.getElementById('bento-billing-profile-picker')).toBeNull();
  });
});
