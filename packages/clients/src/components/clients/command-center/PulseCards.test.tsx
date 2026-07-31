/* @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom/vitest" />

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  ClientPulseDocuments,
  ClientPulseInstallBase,
  ClientPulseLocation,
  ClientPulseMoney,
  ClientPulsePeople,
  ClientPulseService,
} from '../../../lib/commandCenterTypes';
import {
  DocumentsCard,
  InstallBaseCard,
  LocationsCard,
  MoneyCard,
  NotesCard,
  PeopleCard,
  RecordCard,
  ServiceCard,
} from './PulseCards';

vi.mock('@alga-psa/ui/components/ContactAvatar', () => ({
  __esModule: true,
  default: ({ contactName }: { contactName: string }) => <span>{contactName[0]}</span>,
}));

vi.mock('@alga-psa/ui/components/bento', () => ({
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
  BentoTileEmpty: ({ id, children }: { id: string; children: React.ReactNode }) => <p id={id}>{children}</p>,
  BentoRowList: ({ children }: { children: React.ReactNode }) => <ul>{children}</ul>,
  BentoRow: ({ id, meta, children }: { id?: string; meta?: React.ReactNode; children: React.ReactNode }) => (
    <li id={id}>
      {children}
      {meta != null ? <span>{meta}</span> : null}
    </li>
  ),
  BentoRowMeta: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  BentoStat: ({ value, label }: { value: React.ReactNode; label: string }) => (
    <div>
      <span>{value}</span>
      <span>{label}</span>
    </div>
  ),
  BentoChip: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  BentoFooterLinks: ({ idPrefix, links }: {
    idPrefix: string;
    links: Array<{ id: string; label: string; onClick: () => void } | null | undefined>;
  }) => (
    <div>
      {links.filter(Boolean).map((link) => (
        <button key={link!.id} id={`${idPrefix}-link-${link!.id}`} type="button" onClick={link!.onClick}>
          {link!.label}
        </button>
      ))}
    </div>
  ),
}));

const t = (key: string, options?: Record<string, unknown>) => {
  const count = typeof options?.count === 'number' ? options.count : null;
  const plural = count === 1 ? options?.defaultValue_one : options?.defaultValue_other;
  const value = options?.defaultValue ?? plural ?? key;
  return String(value).replace(/\{\{(\w+)\}\}/g, (_m, name) => String(options?.[name] ?? ''));
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const daysAgoIso = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

describe('ServiceCard', () => {
  const base: ClientPulseService = { openCount: 0, oldestOpenDays: null, overdueCount: 0, topOpen: [] };

  it('shows an empty state instead of an empty list', () => {
    render(<ServiceCard id="svc" data={base} onOpen={null} onOpenTicket={vi.fn()} onNewTicket={vi.fn()} t={t} />);

    expect(document.getElementById('svc-empty')).toHaveTextContent('No open tickets.');
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('renders the top open tickets with their SLA state', () => {
    render(
      <ServiceCard
        id="svc"
        data={{
          ...base,
          openCount: 4,
          oldestOpenDays: 9,
          overdueCount: 1,
          topOpen: [
            {
              ticket_id: 'tk-1', ticket_number: '42', title: 'Printer down',
              priority_name: 'High', priority_color: '#ff0000',
              entered_at: daysAgoIso(3), is_overdue: false,
              assigned_to_name: null,
              sla: { status: 'at_risk', remainingMinutes: 45 },
            },
          ],
        }}
        onOpen={null}
        onOpenTicket={vi.fn()}
        onNewTicket={vi.fn()}
        t={t}
      />,
    );

    expect(screen.getByText('#42 Printer down')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('Unassigned')).toBeInTheDocument();
    expect(screen.getByText('SLA 45m left')).toBeInTheDocument();
  });

  it('routes a ticket click to onOpenTicket', () => {
    const onOpenTicket = vi.fn();
    render(
      <ServiceCard
        id="svc"
        data={{
          ...base,
          topOpen: [{
            ticket_id: 'tk-1', ticket_number: '42', title: 'Printer down',
            priority_name: null, priority_color: null, entered_at: daysAgoIso(1), is_overdue: true,
          }],
        }}
        onOpen={null}
        onOpenTicket={onOpenTicket}
        onNewTicket={vi.fn()}
        t={t}
      />,
    );

    fireEvent.click(screen.getByText('#42 Printer down'));
    expect(onOpenTicket).toHaveBeenCalledWith('tk-1');
  });
});

describe('MoneyCard', () => {
  const base: ClientPulseMoney = {
    aging: { currentCents: 0, d30Cents: 0, d60Cents: 0, d90PlusCents: 0 },
    outstandingTotalCents: 0,
    unpaidInvoiceCount: 0,
    draftInvoices: [],
    draftInvoiceCount: 0,
    activeContractCount: 2,
    currencyCode: 'USD',
  };

  const renderMoney = (data: ClientPulseMoney) => render(
    <MoneyCard
      id="money"
      data={data}
      formatMoney={money}
      onOpen={null}
      onOpenInvoice={vi.fn()}
      onOpenBillingSetup={null}
      onOpenTaxSettings={null}
      t={t}
    />,
  );

  it('says nothing is outstanding rather than charting zeros', () => {
    renderMoney(base);

    expect(document.getElementById('money-empty')).toHaveTextContent('Nothing outstanding on finalized invoices.');
  });

  it('caps the draft preview and counts the overflow', () => {
    renderMoney({
      ...base,
      outstandingTotalCents: 5000,
      aging: { currentCents: 5000, d30Cents: 0, d60Cents: 0, d90PlusCents: 0 },
      draftInvoices: [
        { invoice_id: 'inv-1', invoice_number: 'INV-1', totalCents: 1000, created_at: daysAgoIso(1) },
        { invoice_id: 'inv-2', invoice_number: 'INV-2', totalCents: 2000, created_at: daysAgoIso(2) },
      ],
      draftInvoiceCount: 5,
    });

    expect(screen.getByText('INV-1')).toBeInTheDocument();
    expect(screen.getByText('INV-2')).toBeInTheDocument();
    expect(document.getElementById('money-more-drafts')).toHaveTextContent('+3 more drafts');
  });

  it('reports unbilled time in hours and materials in money', () => {
    renderMoney({
      ...base,
      wip: {
        unbilledHours: 6.5,
        unbilledEntryCount: 3,
        unbilledMaterialsCents: 12_300,
        unbilledMaterialCount: 2,
        oldestUnbilledDays: 20,
      },
    });

    expect(screen.getByText('6.5h · $123.00 materials')).toBeInTheDocument();
  });
});

describe('InstallBaseCard', () => {
  const base: ClientPulseInstallBase = {
    managedAssetCount: null,
    soldUnitCount: 0,
    openRmaCount: 0,
    recentUnits: [],
  };

  const renderInstallBase = (data: ClientPulseInstallBase, onOpenAsset = vi.fn()) => {
    render(<InstallBaseCard id="ib" data={data} onOpen={null} onOpenAssetList={null} onOpenAsset={onOpenAsset} t={t} />);
    return onOpenAsset;
  };

  it('shows an empty state when nothing has been delivered', () => {
    renderInstallBase(base);
    expect(document.getElementById('ib-empty')).toHaveTextContent('No delivered equipment yet.');
  });

  it('omits the warranty line when no unit tracks a warranty', () => {
    renderInstallBase(base);
    expect(document.getElementById('ib-warranty')).toBeNull();
  });

  it('renders the warranty line when warranty facts exist', () => {
    renderInstallBase({ ...base, warranty: { expiredCount: 2, expiringSoonCount: 1, trackedCount: 9 } });

    expect(document.getElementById('ib-warranty')).toHaveTextContent('2 out of warranty');
    expect(document.getElementById('ib-warranty')).toHaveTextContent('(of 9 tracked)');
  });

  it('opens a unit’s asset when it has one', () => {
    const onOpenAsset = renderInstallBase({
      ...base,
      recentUnits: [{
        unit_id: 'u-1', product_name: 'Switch 24p', serial_number: 'SN9',
        status: 'delivered', delivered_at: daysAgoIso(5), asset_id: 'as-1',
      }],
    });

    fireEvent.click(screen.getByText('asset'));
    expect(onOpenAsset).toHaveBeenCalledWith('as-1');
  });
});

describe('PeopleCard', () => {
  const base: ClientPulsePeople = { totalCount: 0, top: [] };

  it('shows an empty state with no contacts', () => {
    render(<PeopleCard id="ppl" data={base} onOpen={null} t={t} />);
    expect(document.getElementById('ppl-empty')).toHaveTextContent('No contacts yet.');
  });

  it('counts the contacts the preview left out', () => {
    render(
      <PeopleCard
        id="ppl"
        data={{
          totalCount: 7,
          top: [{
            contact_name_id: 'c-1', full_name: 'Ada Lovelace', role: 'Ops',
            email: 'ada@example.com', phone: null, is_default: true, avatarUrl: null,
          }],
        }}
        onOpen={null}
        t={t}
      />,
    );

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(document.getElementById('ppl-more')).toHaveTextContent('+6 more');
  });

  it('says so when a contact has neither phone nor email', () => {
    render(
      <PeopleCard
        id="ppl"
        data={{
          totalCount: 1,
          top: [{
            contact_name_id: 'c-1', full_name: 'Ada Lovelace', role: null,
            email: null, phone: null, is_default: false, avatarUrl: null,
          }],
        }}
        onOpen={null}
        t={t}
      />,
    );

    expect(screen.getByText('no contact info on file')).toBeInTheDocument();
  });
});

describe('LocationsCard', () => {
  const location = (id: string): ClientPulseLocation => ({
    location_id: id, location_name: `Site ${id}`, address_line1: '1 Main St', city: 'Springfield',
    phone: null, email: null, is_default: false, is_billing: false, is_shipping: false,
  });

  it('shows an empty state with no locations', () => {
    render(<LocationsCard id="loc" locations={[]} onManage={null} t={t} />);
    expect(document.getElementById('loc-empty')).toHaveTextContent('No locations yet.');
  });

  it('previews three locations and counts the rest', () => {
    render(<LocationsCard id="loc" locations={['a', 'b', 'c', 'd', 'e'].map(location)} onManage={null} t={t} />);

    expect(screen.getByText('Site a')).toBeInTheDocument();
    expect(screen.getByText('Site c')).toBeInTheDocument();
    expect(screen.queryByText('Site d')).toBeNull();
    expect(document.getElementById('loc-more')).toHaveTextContent('+2 more');
  });
});

describe('DocumentsCard', () => {
  const base: ClientPulseDocuments = { totalCount: 0, recent: [] };

  it('shows an empty state with no documents', () => {
    render(<DocumentsCard id="doc" data={base} onOpen={null} t={t} />);
    expect(document.getElementById('doc-empty')).toHaveTextContent('No documents yet.');
  });

  it('lists the recent documents and counts the overflow', () => {
    render(
      <DocumentsCard
        id="doc"
        data={{ totalCount: 4, recent: [{ document_id: 'd-1', document_name: 'MSA.pdf', updated_at: daysAgoIso(2) }] }}
        onOpen={null}
        t={t}
      />,
    );

    expect(screen.getByText('MSA.pdf')).toBeInTheDocument();
    expect(document.getElementById('doc-more')).toHaveTextContent('+3 more');
  });
});

describe('NotesCard', () => {
  it('offers to add a note when there are none', () => {
    const onOpen = vi.fn();
    render(<NotesCard id="note" data={{ hasNotes: false, previewLines: [], lastEditedAt: null }} onOpen={onOpen} t={t} />);

    expect(document.getElementById('note-empty')).toHaveTextContent('No notes yet.');
    fireEvent.click(screen.getByText('Add note'));
    expect(onOpen).toHaveBeenCalled();
  });

  it('previews the shared note when one exists', () => {
    render(
      <NotesCard
        id="note"
        data={{ hasNotes: true, previewLines: ['Gate code 1234'], lastEditedAt: daysAgoIso(3) }}
        onOpen={null}
        t={t}
      />,
    );

    expect(screen.getByText('Gate code 1234')).toBeInTheDocument();
    expect(screen.getByText('Shared client note · edited 3d ago')).toBeInTheDocument();
  });
});

describe('RecordCard', () => {
  it('marks unset facts rather than hiding the row', () => {
    render(
      <RecordCard
        id="rec"
        data={{
          url: null, accountManagerName: 'Dorothy Gale', defaultContactName: null,
          inboundDomains: [], taxRegion: null, clientSince: '2019-04-01T00:00:00.000Z', isInactive: false,
        }}
        onOpen={null}
        onOpenAdditionalInfo={null}
        t={t}
      />,
    );

    expect(screen.getByText('Dorothy Gale')).toBeInTheDocument();
    expect(screen.getByText('not set')).toBeInTheDocument();
    expect(screen.getByText('2019')).toBeInTheDocument();
  });

  it('renders the additional-info footer link only when it has a destination', () => {
    const onOpenAdditionalInfo = vi.fn();
    const data = {
      url: null, accountManagerName: null, defaultContactName: null,
      inboundDomains: [], taxRegion: null, clientSince: null, isInactive: false,
    };

    const { rerender } = render(
      <RecordCard id="rec" data={data} onOpen={null} onOpenAdditionalInfo={null} t={t} />,
    );
    expect(document.getElementById('rec-link-additional-info')).toBeNull();

    rerender(<RecordCard id="rec" data={data} onOpen={null} onOpenAdditionalInfo={onOpenAdditionalInfo} t={t} />);
    fireEvent.click(document.getElementById('rec-link-additional-info')!);
    expect(onOpenAdditionalInfo).toHaveBeenCalled();
  });
});
