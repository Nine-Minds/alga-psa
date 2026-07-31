/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientPulse } from '../../../lib/commandCenterTypes';
import ClientCommandCenter from './ClientCommandCenter';

const getClientPulseMock = vi.fn();

vi.mock('../../../actions/clientPulseActions', () => ({
  getClientPulse: (...args: unknown[]) => getClientPulseMock(...args),
}));

vi.mock('../../../actions/clientTimelineActions', () => ({
  listClientTimeline: vi.fn().mockResolvedValue({ events: [], nextCursor: null }),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock('../../contacts/bento/useContactQuickViewDrawer', () => ({
  useContactQuickViewDrawer: () => vi.fn(),
}));

vi.mock('@alga-psa/ui/lib', () => ({
  useCurrencyFormat: () => ({ money: (cents: number) => `$${cents / 100}` }),
}));

vi.mock('@alga-psa/ui/components/ContactAvatar', () => ({
  __esModule: true,
  default: () => null,
}));

vi.mock('@alga-psa/ui/components/Drawer', () => ({ __esModule: true, default: () => null }));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({ ConfirmationDialog: () => null }));

vi.mock('@alga-psa/ui/components/bento', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/ui/components/bento')>(
    '@alga-psa/ui/components/bento',
  );
  return {
    ...actual,
    BentoTile: ({ id, children }: { id: string; children: React.ReactNode }) => <section id={id}>{children}</section>,
    BentoTileSkeleton: ({ id }: { id: string }) => <div id={id} />,
  };
});

const t = (key: string, options?: Record<string, unknown>) =>
  String(options?.defaultValue ?? options?.defaultValue_other ?? key);

const fullPulse: ClientPulse = {
  generatedAt: new Date().toISOString(),
  permissions: { tickets: true, billing: true, inventory: true, assets: true, documents: true },
  attention: [{ kind: 'ticket_overdue', severity: 'amber', count: 1, refType: 'ticket', refId: 'tk-1', refLabel: '#1' }],
  service: { openCount: 1, oldestOpenDays: 1, overdueCount: 1, topOpen: [] },
  money: {
    aging: { currentCents: 0, d30Cents: 0, d60Cents: 0, d90PlusCents: 0 },
    outstandingTotalCents: 0,
    unpaidInvoiceCount: 0,
    draftInvoices: [],
    draftInvoiceCount: 0,
    activeContractCount: 1,
    currencyCode: 'USD',
  },
  installBase: { managedAssetCount: 1, soldUnitCount: 1, openRmaCount: 0, recentUnits: [] },
  people: { totalCount: 0, top: [] },
  locations: [],
  documents: { totalCount: 0, recent: [] },
  notes: { hasNotes: false, previewLines: [], lastEditedAt: null },
  record: {
    url: null, accountManagerName: null, defaultContactName: null,
    inboundDomains: [], taxRegion: null, clientSince: null, isInactive: false,
  },
};

const PRODUCT_AGNOSTIC_CARDS = [
  'cc-card-concerns',
  'cc-card-service',
  'cc-card-record',
  'cc-card-people',
  'cc-card-locations',
  'cc-card-documents',
  'cc-card-notes',
];

const PSA_ONLY_CARDS = ['cc-card-money', 'cc-card-install-base'];

const renderCenter = (isAlgaDeskMode: boolean) => render(
  <ClientCommandCenter
    idPrefix="cc"
    clientId="client-1"
    tabs={[]}
    onTabUrlChange={vi.fn()}
    hasUnsavedRecordChanges={false}
    onDiscardRecordChanges={vi.fn()}
    onNewTicket={vi.fn()}
    onManageLocations={vi.fn()}
    surveySummary={null}
    renderSurveySummaryCard={() => null}
    isAlgaDeskMode={isAlgaDeskMode}
    t={t}
  />,
);

/**
 * Pins which pulse cards each product composes. AlgaDesk has no billing or
 * inventory surface, so Money and Install base must not appear even when the
 * pulse action happens to return their facts.
 */
describe('client command center card composition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getClientPulseMock.mockResolvedValue(fullPulse);
  });

  it('composes every card for PSA tenants', async () => {
    renderCenter(false);

    await waitFor(() => expect(document.getElementById('cc-card-service')).not.toBeNull());
    for (const id of [...PRODUCT_AGNOSTIC_CARDS, ...PSA_ONLY_CARDS]) {
      expect(document.getElementById(id), id).not.toBeNull();
    }
  });

  it('drops Money and Install base for AlgaDesk tenants', async () => {
    renderCenter(true);

    await waitFor(() => expect(document.getElementById('cc-card-service')).not.toBeNull());
    for (const id of PRODUCT_AGNOSTIC_CARDS) {
      expect(document.getElementById(id), id).not.toBeNull();
    }
    for (const id of PSA_ONLY_CARDS) {
      expect(document.getElementById(id), id).toBeNull();
    }
  });
});
