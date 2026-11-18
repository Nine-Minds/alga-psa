import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IRmaCase } from '@alga-psa/types';

const whereIn = vi.fn();
const scope = vi.fn();
const filter = vi.fn();

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  withTransaction: vi.fn(async (_knex: unknown, fn: (trx: unknown) => unknown) => fn({})),
}));
vi.mock('@alga-psa/assets/lib/ticketLinkedAssetLabels', () => ({
  serialSuffixOf: (serial?: string | null) => ((serial ?? '').trim().length >= 8 ? (serial as string).trim().slice(-4) : null),
}));
vi.mock('./rmaCaseQuery', () => ({ rmaCaseQuery: () => ({ whereIn }) }));
vi.mock('./rma/rmaReadAccess', () => ({
  resolveRmaReadScope: (...args: unknown[]) => scope(...args),
  filterReadableRmaCases: (...args: unknown[]) => filter(...args),
}));

import {
  buildRmaLabelViewModel,
  buildRmaReturnSlipViewModel,
  loadReadableRmaCases,
  rmaStatusLabel,
} from './rmaPrintData';

const ID = '11111111-1111-4111-8111-111111111111';
const BASE = 'https://psa.test';

const assetCase = {
  rma_id: ID,
  rma_number: 'RMA-00007',
  status: 'sent_to_vendor',
  client_id: 'c1',
  client_name: 'Emerald City Dental',
  asset_id: 'a1',
  asset_name: 'Front desk laptop',
  asset_tag: 'AT-000123',
  asset_serial_number: 'SN-48QX7K2Q',
  vendor_name: 'Contoso',
  rma_reference: 'CD-884213',
  return_by: '2026-11-15',
  outbound_carrier: 'UPS',
  outbound_tracking_number: '1Z999',
  return_ship_to: 'RMA Dept',
  replacement_serial_number: 'NEW-SERIAL-1',
  ticket_number: 'TIC-001042',
  returned_unit_id: null,
} as unknown as IRmaCase;

describe('rmaPrintData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scope.mockResolvedValue({ allowed: true, unitCases: true });
    filter.mockImplementation(async (_trx, _tenant, _user, rows) => rows);
    whereIn.mockResolvedValue([assetCase]);
  });

  it('refuses everything (and never queries) when the caller has neither warranty:read nor inventory:read', async () => {
    scope.mockResolvedValue({ allowed: false, unitCases: false });
    expect(await loadReadableRmaCases({ tenant: 't', user: {} }, [ID])).toEqual([null]);
    expect(whereIn).not.toHaveBeenCalled();
  });

  it('returns null for missing and for asset-unreadable cases alike, in request order', async () => {
    const other = '22222222-2222-4222-8222-222222222222';
    whereIn.mockResolvedValue([assetCase, { ...assetCase, rma_id: other }]);
    filter.mockImplementation(async (_t, _tn, _u, rows: IRmaCase[]) => rows.filter((r) => r.rma_id === ID));
    const missing = '33333333-3333-4333-8333-333333333333';
    const result = await loadReadableRmaCases({ tenant: 't', user: {} }, [other, ID, missing]);
    expect(result.map((r) => r?.rma_id ?? null)).toEqual([null, ID, null]);
    expect(filter.mock.calls[0][4]).toEqual({ allowed: true, unitCases: true });
  });

  it('builds the RMA tag for a client-asset claim with the canonical RMA URL and a serial suffix only', () => {
    const vm = buildRmaLabelViewModel(assetCase, BASE);
    expect(vm).toMatchObject({
      labelClass: 'rma-work-tag',
      entityType: 'rma',
      recordId: ID,
      url: `${BASE}/msp/inventory/rma?rmaId=${ID}`,
      identifier: 'RMA-00007',
      title: 'Front desk laptop',
      clientName: 'Emerald City Dental',
      detail: 'Contoso · Ref CD-884213',
      secondaryIdentifier: 'AT-000123',
      serialSuffix: '7K2Q',
      rma: { statusLabel: 'Sent to vendor', returnBy: '2026-11-15', shipping: 'UPS 1Z999', ticketNumber: 'TIC-001042' },
    });
    expect(JSON.stringify(vm)).not.toContain('SN-48QX7K2Q');
  });

  it('builds the RMA tag for a stock-unit RMA (no asset) without crashing', () => {
    const unitCase = {
      rma_id: ID, rma_number: 'RMA-00002', status: 'open', returned_unit_id: 'u1', asset_id: null,
      service_name: 'Switch 24p', returned_serial_number: 'UNIT-SERIAL-9', client_name: null,
      vendor_name: null, rma_reference: null, return_by: null, ticket_number: null,
    } as unknown as IRmaCase;
    const vm = buildRmaLabelViewModel(unitCase, BASE);
    expect(vm.title).toBe('Switch 24p');
    expect(vm.secondaryIdentifier).toBeNull();
    expect(vm.serialSuffix).toBe('AL-9');
    expect(vm.detail).toBeNull();
    expect(vm.rma).toMatchObject({ shipping: null, returnBy: null, ticketNumber: null });
  });

  it('prefers the inbound leg on the tag once the vendor shipped back', () => {
    const vm = buildRmaLabelViewModel({ ...assetCase, inbound_carrier: 'FedEx', inbound_tracking_number: '99' } as IRmaCase, BASE);
    expect(vm.rma?.shipping).toBe('FedEx 99');
  });

  it('builds the return slip with replacement serial, both shipping legs, and the print date', () => {
    const slip = buildRmaReturnSlipViewModel(
      { ...assetCase, inbound_carrier: 'FedEx', inbound_tracking_number: '99' } as IRmaCase,
      BASE,
      new Date('2026-10-25T12:00:00Z')
    );
    expect(slip.rma).toMatchObject({
      number: 'RMA-00007',
      recordUrl: `${BASE}/msp/inventory/rma?rmaId=${ID}`,
      returnBy: '2026-11-15',
      returnShipTo: 'RMA Dept',
      vendorName: 'Contoso',
      vendorReference: 'CD-884213',
      shippingSummary: 'Out: UPS 1Z999 / In: FedEx 99',
      ticketNumber: 'TIC-001042',
      printedOn: '2026-10-25',
    });
    expect(slip.asset).toEqual({
      name: 'Front desk laptop', serialNumber: 'SN-48QX7K2Q', tag: 'AT-000123', replacementSerialNumber: 'NEW-SERIAL-1',
    });
    expect(slip.client.name).toBe('Emerald City Dental');
  });

  it('humanises statuses', () => {
    expect(rmaStatusLabel('warranty_review')).toBe('Warranty review');
    expect(rmaStatusLabel(null)).toBeNull();
  });
});
