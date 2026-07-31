/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TabContent } from '@alga-psa/ui/components/CustomTabs';
import type { ClientPulse } from '../../../lib/commandCenterTypes';
import ClientCommandCenter from './ClientCommandCenter';

const getClientPulseMock = vi.fn();
const listClientTimelineMock = vi.fn();
const pushMock = vi.fn();
const openContactQuickViewMock = vi.fn();

vi.mock('../../../actions/clientPulseActions', () => ({
  getClientPulse: (...args: unknown[]) => getClientPulseMock(...args),
}));

vi.mock('../../../actions/clientTimelineActions', () => ({
  listClientTimeline: (...args: unknown[]) => listClientTimelineMock(...args),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('../../contacts/bento/useContactQuickViewDrawer', () => ({
  useContactQuickViewDrawer: () => openContactQuickViewMock,
}));

vi.mock('@alga-psa/ui/lib', () => ({
  useCurrencyFormat: () => ({ money: (cents: number) => `$${cents / 100}` }),
}));

vi.mock('@alga-psa/ui/components/ContactAvatar', () => ({
  __esModule: true,
  default: ({ contactName }: { contactName: string }) => <span>{contactName[0]}</span>,
}));

vi.mock('@alga-psa/ui/components/Drawer', () => ({
  __esModule: true,
  default: ({ id, isOpen, children }: { id: string; isOpen: boolean; children: React.ReactNode }) =>
    (isOpen ? <div id={id}>{children}</div> : null),
}));

vi.mock('@alga-psa/ui/components/ConfirmationDialog', () => ({
  ConfirmationDialog: ({ id, isOpen, onConfirm, title, confirmLabel }: {
    id: string;
    isOpen: boolean;
    onConfirm: () => void;
    title: string;
    confirmLabel: string;
  }) => (isOpen ? (
    <div id={id}>
      <span>{title}</span>
      <button type="button" onClick={onConfirm}>{confirmLabel}</button>
    </div>
  ) : null),
}));

vi.mock('@alga-psa/ui/components/bento', async () => {
  const actual = await vi.importActual<typeof import('@alga-psa/ui/components/bento')>(
    '@alga-psa/ui/components/bento',
  );
  return {
    ...actual,
    BentoTile: ({ id, title, action, children }: {
      id: string;
      title?: string;
      action?: React.ReactNode;
      children: React.ReactNode;
    }) => (
      <section id={id}>
        {title ? <h3>{title}</h3> : null}
        {action}
        {children}
      </section>
    ),
    BentoTileSkeleton: ({ id }: { id: string }) => <div id={id} />,
  };
});

const t = (key: string, options?: Record<string, unknown>) => {
  const count = typeof options?.count === 'number' ? options.count : null;
  const plural = count === 1 ? options?.defaultValue_one : options?.defaultValue_other;
  const value = options?.defaultValue ?? plural ?? key;
  return String(value).replace(/\{\{(\w+)\}\}/g, (_m, name) => String(options?.[name] ?? ''));
};

const pulse = (overrides: Partial<ClientPulse> = {}): ClientPulse => ({
  generatedAt: new Date().toISOString(),
  permissions: { tickets: true, billing: true, inventory: true, assets: true, documents: true },
  attention: [],
  service: { openCount: 1, oldestOpenDays: 2, overdueCount: 0, topOpen: [] },
  money: {
    aging: { currentCents: 0, d30Cents: 0, d60Cents: 0, d90PlusCents: 0 },
    outstandingTotalCents: 0,
    unpaidInvoiceCount: 0,
    draftInvoices: [],
    draftInvoiceCount: 0,
    activeContractCount: 1,
    currencyCode: 'USD',
  },
  installBase: { managedAssetCount: 3, soldUnitCount: 2, openRmaCount: 0, recentUnits: [] },
  people: { totalCount: 0, top: [] },
  locations: [],
  documents: { totalCount: 0, recent: [] },
  notes: { hasNotes: false, previewLines: [], lastEditedAt: null },
  record: {
    url: 'example.com', accountManagerName: null, defaultContactName: null,
    inboundDomains: [], taxRegion: null, clientSince: null, isInactive: false,
  },
  ...overrides,
});

const tab = (id: string, label: string): TabContent => ({ id, label, content: <div>{label} view</div> });

const baseProps = {
  idPrefix: 'cc',
  clientId: 'client-1',
  onTabUrlChange: vi.fn(),
  hasUnsavedRecordChanges: false,
  onDiscardRecordChanges: vi.fn(),
  onNewTicket: vi.fn(),
  onManageLocations: vi.fn(),
  surveySummary: null,
  renderSurveySummaryCard: () => null,
  t,
};

const renderCenter = (props: Partial<React.ComponentProps<typeof ClientCommandCenter>> = {}) =>
  render(<ClientCommandCenter {...baseProps} tabs={[tab('details', 'Details')]} {...props} />);

describe('ClientCommandCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getClientPulseMock.mockResolvedValue(pulse());
    listClientTimelineMock.mockResolvedValue({ events: [], nextCursor: null });
  });

  it('surfaces a pulse load failure instead of an empty page', async () => {
    getClientPulseMock.mockRejectedValue(new Error('boom'));
    renderCenter();

    await waitFor(() => {
      expect(document.getElementById('cc-pulse-error')).toHaveTextContent('Could not load the client snapshot.');
    });
  });

  describe('deep links', () => {
    it('waits for an asynchronously registered tab before consuming ?tab=', async () => {
      const { rerender } = render(
        <ClientCommandCenter {...baseProps} tabs={[tab('details', 'Details')]} initialTabId="equipment" />,
      );

      await waitFor(() => expect(getClientPulseMock).toHaveBeenCalled());
      expect(screen.queryByText('Equipment view')).toBeNull();

      rerender(
        <ClientCommandCenter
          {...baseProps}
          tabs={[tab('details', 'Details'), tab('equipment', 'Equipment')]}
          initialTabId="equipment"
        />,
      );

      expect(await screen.findByText('Equipment view')).toBeInTheDocument();
    });

    it('consumes the deep link exactly once', async () => {
      const tabs = [tab('details', 'Details')];
      const { rerender } = render(
        <ClientCommandCenter {...baseProps} tabs={tabs} initialTabId="details" />,
      );

      expect(await screen.findByText('Details view')).toBeInTheDocument();

      fireEvent.click(document.getElementById('cc-focus-close')!);
      expect(screen.queryByText('Details view')).toBeNull();

      // A re-render with the same initialTabId must not re-open the focus view.
      rerender(<ClientCommandCenter {...baseProps} tabs={[...tabs]} initialTabId="details" />);
      expect(screen.queryByText('Details view')).toBeNull();
    });
  });

  describe('unsaved-record guard', () => {
    it('confirms before discarding pending record-form edits', async () => {
      const onDiscardRecordChanges = vi.fn();
      const onTabUrlChange = vi.fn();
      render(
        <ClientCommandCenter
          {...baseProps}
          tabs={[tab('details', 'Details')]}
          initialTabId="details"
          hasUnsavedRecordChanges
          onDiscardRecordChanges={onDiscardRecordChanges}
          onTabUrlChange={onTabUrlChange}
        />,
      );

      expect(await screen.findByText('Details view')).toBeInTheDocument();
      fireEvent.click(document.getElementById('cc-focus-close')!);

      expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
      expect(onDiscardRecordChanges).not.toHaveBeenCalled();
      expect(screen.getByText('Details view')).toBeInTheDocument();

      fireEvent.click(screen.getByText('Discard changes'));

      expect(onDiscardRecordChanges).toHaveBeenCalledTimes(1);
      expect(onTabUrlChange).toHaveBeenLastCalledWith(null);
      expect(screen.queryByText('Details view')).toBeNull();
    });

    it('does not guard focus views that do not edit the record buffer', async () => {
      render(
        <ClientCommandCenter
          {...baseProps}
          tabs={[tab('tickets', 'Tickets')]}
          initialTabId="tickets"
          hasUnsavedRecordChanges
        />,
      );

      expect(await screen.findByText('Tickets view')).toBeInTheDocument();
      fireEvent.click(document.getElementById('cc-focus-close')!);

      expect(screen.queryByText('Unsaved changes')).toBeNull();
      expect(screen.queryByText('Tickets view')).toBeNull();
    });
  });

  describe('refetching', () => {
    it('refetches the pulse when refreshNonce bumps', async () => {
      const { rerender } = renderCenter();
      await waitFor(() => expect(getClientPulseMock).toHaveBeenCalledTimes(1));

      rerender(<ClientCommandCenter {...baseProps} tabs={[tab('details', 'Details')]} refreshNonce={1} />);
      await waitFor(() => expect(getClientPulseMock).toHaveBeenCalledTimes(2));
    });

    it('refetches the pulse after a contact quick view saves changes', async () => {
      getClientPulseMock.mockResolvedValue(pulse({
        people: {
          totalCount: 1,
          top: [{ contact_name_id: 'c-1', full_name: 'Ada Lovelace', role: null, email: null, phone: null, is_default: false, avatarUrl: null }],
        },
      }));
      renderCenter();

      fireEvent.click(await screen.findByText('Ada Lovelace'));
      expect(openContactQuickViewMock).toHaveBeenCalledWith('c-1', expect.objectContaining({
        onChangesSaved: expect.any(Function),
      }));

      await waitFor(() => expect(getClientPulseMock).toHaveBeenCalledTimes(1));
      openContactQuickViewMock.mock.calls[0][1].onChangesSaved();
      await waitFor(() => expect(getClientPulseMock).toHaveBeenCalledTimes(2));
    });
  });

  describe('AlgaDesk mode', () => {
    it('drops the billing and inventory tiles', async () => {
      renderCenter({ isAlgaDeskMode: true });

      await waitFor(() => expect(screen.getByText('Service')).toBeInTheDocument());
      expect(document.getElementById('cc-card-money')).toBeNull();
      expect(document.getElementById('cc-card-install-base')).toBeNull();
      expect(document.getElementById('cc-card-people')).not.toBeNull();
      expect(document.getElementById('cc-card-record')).not.toBeNull();
    });

    it('keeps them for PSA tenants', async () => {
      renderCenter();

      await waitFor(() => expect(document.getElementById('cc-card-money')).not.toBeNull());
      expect(document.getElementById('cc-card-install-base')).not.toBeNull();
    });
  });

  describe('flag routing', () => {
    const routed = async (
      refType: string,
      refId: string,
      tabs: TabContent[] = [tab('details', 'Details')],
      extra: Partial<React.ComponentProps<typeof ClientCommandCenter>> = {},
    ) => {
      getClientPulseMock.mockResolvedValue(pulse({
        attention: [{ kind: 'ticket_overdue', severity: 'amber', count: 1, refType: refType as never, refId, refLabel: '#1' }],
      }));
      renderCenter({ tabs, ...extra });
      const button = await screen.findByText(/overdue ticket/);
      fireEvent.click(button.closest('button')!);
    };

    it('navigates to an invoice', async () => {
      await routed('invoice', 'inv-1');
      expect(pushMock).toHaveBeenCalledWith('/msp/invoices/inv-1');
    });

    it('navigates to the sales order list', async () => {
      await routed('sales_order', 'so-1');
      expect(pushMock).toHaveBeenCalledWith('/msp/inventory/sales-orders');
    });

    it('navigates to the RMA list', async () => {
      await routed('rma', 'rma-1');
      expect(pushMock).toHaveBeenCalledWith('/msp/inventory/rma');
    });

    it('navigates to a ticket when no drawer is composed in', async () => {
      await routed('ticket', 'tk-1');
      expect(pushMock).toHaveBeenCalledWith('/msp/tickets/tk-1');
    });

    it('prefers the composed ticket drawer over navigation', async () => {
      const onOpenTicketDetails = vi.fn();
      await routed('ticket', 'tk-1', [tab('details', 'Details')], { onOpenTicketDetails });

      expect(onOpenTicketDetails).toHaveBeenCalledWith('tk-1');
      expect(pushMock).not.toHaveBeenCalled();
    });

    it('opens the equipment focus view for a stock unit', async () => {
      await routed('stock_unit', 'u-1', [tab('details', 'Details'), tab('equipment', 'Equipment')]);
      expect(await screen.findByText('Equipment view')).toBeInTheDocument();
    });

    it('opens the interactions focus view for an interaction', async () => {
      await routed('interaction', 'i-1', [tab('details', 'Details'), tab('interactions', 'Interactions')]);
      expect(await screen.findByText('Interactions view')).toBeInTheDocument();
    });
  });
});
