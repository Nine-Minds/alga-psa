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

const LOCATIONS = [
  {
    location_id: 'loc-main',
    location_name: 'Main Office',
    address_line1: '1 Yellow Brick Rd',
    city: 'Emerald City',
    state_province: 'OZ',
    postal_code: '00001',
    is_default: true,
  },
  {
    location_id: 'loc-warehouse',
    location_name: 'Warehouse',
    address_line1: '9 Poppy Field',
    city: 'Munchkinland',
    is_default: false,
  },
];

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

describe('TicketBentoLayout location row', () => {
  it("shows the ticket's own location", () => {
    render(
      <TicketBentoLayout
        {...baseProps({
          ticket: { ...(baseProps().ticket as any), location_id: 'loc-warehouse' },
          locations: LOCATIONS,
        })}
      />,
    );

    expect(document.getElementById('bento-location-value')).toHaveTextContent(
      'Warehouse - 9 Poppy Field - Munchkinland',
    );
  });

  it('falls back to the client default and marks it as such', () => {
    render(<TicketBentoLayout {...baseProps({ locations: LOCATIONS })} />);

    expect(document.getElementById('bento-location-value')).toHaveTextContent(
      'Main Office - 1 Yellow Brick Rd - Emerald City, OZ - 00001 (Default)',
    );
  });

  it('says so when the client has no locations at all', () => {
    render(<TicketBentoLayout {...baseProps({ locations: [] })} />);

    expect(document.getElementById('bento-location-value')).toHaveTextContent('No location specified');
    expect(document.getElementById('bento-location-edit')).toBeNull();
  });

  it('saves a picked location through onChangeLocation', () => {
    const onChangeLocation = vi.fn();
    render(<TicketBentoLayout {...baseProps({ locations: LOCATIONS, onChangeLocation })} />);

    fireEvent.click(document.getElementById('bento-location-edit')!);
    fireEvent.change(document.getElementById('bento-location-select')!, { target: { value: 'loc-warehouse' } });
    fireEvent.click(screen.getByTestId('bento-location-save'));

    expect(onChangeLocation).toHaveBeenCalledWith('loc-warehouse');
    expect(document.getElementById('bento-location-select')).toBeNull();
  });

  it('clears the location when "no specific location" is picked', () => {
    const onChangeLocation = vi.fn();
    render(
      <TicketBentoLayout
        {...baseProps({
          ticket: { ...(baseProps().ticket as any), location_id: 'loc-warehouse' },
          locations: LOCATIONS,
          onChangeLocation,
        })}
      />,
    );

    fireEvent.click(document.getElementById('bento-location-edit')!);
    fireEvent.change(document.getElementById('bento-location-select')!, { target: { value: 'none' } });
    fireEvent.click(screen.getByTestId('bento-location-save'));

    expect(onChangeLocation).toHaveBeenCalledWith(null);
  });

  it('does not save when the picked location is unchanged', () => {
    const onChangeLocation = vi.fn();
    render(
      <TicketBentoLayout
        {...baseProps({
          ticket: { ...(baseProps().ticket as any), location_id: 'loc-warehouse' },
          locations: LOCATIONS,
          onChangeLocation,
        })}
      />,
    );

    fireEvent.click(document.getElementById('bento-location-edit')!);
    fireEvent.click(screen.getByTestId('bento-location-save'));

    expect(onChangeLocation).not.toHaveBeenCalled();
  });
});

describe('TicketBentoLayout billing profile row', () => {
  it("renders the picker with the ticket's client and profile", () => {
    render(
      <TicketBentoLayout
        {...baseProps({
          ticket: { ...(baseProps().ticket as any), billing_profile_id: 'profile-2' },
          onChangeBillingProfile: vi.fn(),
        })}
      />,
    );

    const picker = screen.getByTestId('bento-billing-profile-picker');
    expect(picker).toHaveAttribute('data-client-id', 'client-1');
    expect(picker).toHaveAttribute('data-value', 'profile-2');
  });

  it('stays out of the tile when no save handler is wired', () => {
    render(<TicketBentoLayout {...baseProps()} />);

    expect(screen.queryByTestId('bento-billing-profile-picker')).toBeNull();
  });
});
