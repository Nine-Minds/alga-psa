import { beforeEach, describe, expect, it, vi } from 'vitest';

import InvoiceModel from '@alga-psa/billing/models/invoice';
import { InvoiceService } from '../../../lib/api/services/InvoiceService';
import { auditLog } from '../../../lib/logging/auditLog';
import { publishEvent, publishWorkflowEvent } from '../../../lib/eventBus/publishers';

const state = {
  invoice: {
    invoice_id: 'invoice-1',
    tenant: 'tenant-1',
    client_id: 'client-1',
    status: 'draft',
  } as Record<string, any> | null,
  hasPayments: false,
  invoiceUpdates: [] as Array<Record<string, unknown>>,
  deletedTables: [] as string[],
};

function createBuilder(table: string) {
  const builder: any = {};
  builder.where = vi.fn(() => builder);
  builder.first = vi.fn(async () => {
    if (table === 'invoices') {
      return state.invoice;
    }

    if (table === 'invoice_payments') {
      return state.hasPayments ? { payment_id: 'payment-1' } : undefined;
    }

    return undefined;
  });
  builder.update = vi.fn(async (data: Record<string, unknown>) => {
    state.invoiceUpdates.push(data);
    return 1;
  });
  builder.del = vi.fn(async () => {
    state.deletedTables.push(table);
    return 1;
  });
  return builder;
}

function createMockTrx() {
  return ((table: string) => createBuilder(table)) as any;
}

vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return {
    ...actual,
    withTransaction: vi.fn(async (_knex: any, callback: any) => callback(createMockTrx())),
  };
});

vi.mock('@alga-psa/billing/models/invoice', () => ({
  default: {
    getInvoiceCharges: vi.fn(),
  },
}));

vi.mock('../../../lib/logging/auditLog', () => ({
  auditLog: vi.fn(async () => undefined),
}));

vi.mock('../../../lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

describe('InvoiceService delete recurring detail safeguards', () => {
  beforeEach(() => {
    state.invoice = {
      invoice_id: 'invoice-1',
      tenant: 'tenant-1',
      client_id: 'client-1',
      status: 'draft',
    };
    state.hasPayments = false;
    state.invoiceUpdates = [];
    state.deletedTables = [];

    vi.mocked(InvoiceModel.getInvoiceCharges).mockResolvedValue([
      {
        item_id: 'charge-1',
        recurring_detail_periods: [
          {
            service_period_start: '2025-01-01T00:00:00.000Z',
            service_period_end: '2025-02-01T00:00:00.000Z',
            billing_timing: 'advance',
          },
        ],
      },
    ] as any);
    vi.mocked(auditLog).mockReset().mockResolvedValue(undefined);
    vi.mocked(publishEvent).mockReset().mockResolvedValue(undefined);
    vi.mocked(publishWorkflowEvent).mockReset().mockResolvedValue(undefined);
  });

  it('T205: soft-cancels draft invoices instead of hard deleting them when canonical recurring detail periods already exist', async () => {
    const service = new InvoiceService();
    vi.spyOn(service as any, 'validatePermissions').mockResolvedValue(undefined);
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: {} });

    await service.delete('invoice-1', { tenant: 'tenant-1', userId: 'user-1' } as any);

    expect(state.invoiceUpdates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: 'cancelled',
          updated_by: 'user-1',
        }),
      ])
    );
    expect(state.deletedTables).not.toContain('invoice_line_items');
    expect(state.deletedTables).not.toContain('invoices');
    expect(auditLog).toHaveBeenCalled();
    expect(publishWorkflowEvent).toHaveBeenCalled();
    expect(publishEvent).toHaveBeenCalled();
  });
});
