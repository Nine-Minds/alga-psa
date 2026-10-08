/**
 * Behavioral unit tests for AccountingExportValidation.ensureMappingsForBatch
 * (packages/billing/src/services/accountingExportValidation.ts).
 *
 * Verifies the rules that decide whether an invoice export batch is 'ready'
 * vs 'needs_attention': unmapped services/tax regions/payment terms, missing
 * charge/service references, QuickBooks realm + client requirements, and the
 * canonical service-period projection checks.
 *
 * Repository, mapping resolver and knex are all faked; no database.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  repo: undefined as any,
  resolver: undefined as any,
  knex: undefined as any,
}));

// The adapter decides whether the target company restricts line tax codes
// (QuickBooks: TAX/NON only on a US Automated Sales Tax company). Defaults to
// unrestricted so every pre-existing expectation is untouched.
const allowedLineTaxCodesMock = vi.hoisted(() =>
  vi.fn(async (): Promise<ReadonlySet<string> | null> => null)
);
const PSEUDO_CODES: ReadonlySet<string> = new Set(['TAX', 'NON']);
const adapters = {
  get: (adapterType: string) =>
    adapterType === 'quickbooks_online'
      ? ({ type: adapterType, allowedLineTaxCodes: allowedLineTaxCodesMock } as any)
      : undefined,
};

vi.mock('../../src/repositories/accountingExportRepository', () => ({
  AccountingExportRepository: { create: vi.fn(async () => h.repo) },
}));

vi.mock('../../src/services/accountingMappingResolver', () => ({
  AccountingMappingResolver: { create: vi.fn(async () => h.resolver) },
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: h.knex, tenant: 'tenant-1' })),
  tenantDb: vi.fn((knex: any) => ({
    table: (table: string) => knex(table),
  })),
}));

import { AccountingExportValidation } from '../../src/services/accountingExportValidation';

const TENANT = 'tenant-1';
const P1_START = '2025-01-01T00:00:00.000Z';
const P1_END = '2025-02-01T00:00:00.000Z';
const P2_START = '2025-02-01T00:00:00.000Z';
const P2_END = '2025-03-01T00:00:00.000Z';

type FakeState = {
  batch: any;
  lines: any[];
  charges: any[];
  chargeDetails: any[];
  invoices: any[];
  clients: any[];
  services: any[];
};

function createFakeKnex(state: FakeState) {
  const updates: Array<{ table: string; patch: any }> = [];
  const tableData: Record<string, () => any[]> = {
    invoice_charges: () => state.charges.map((charge) => ({ net_amount: 100, ...charge })),
    invoice_charge_details: () => state.chargeDetails,
    invoices: () => state.invoices,
    clients: () => state.clients,
    service_catalog: () => state.services,
    accounting_export_errors: () => [],
    tenant_settings: () => [{ settings: { accountingSync: { autoProvisionCustomers: true } } }],
  };

  const knex: any = (table: string) => {
    const builder: any = {};
    for (const method of ['where', 'andWhere', 'whereIn', 'select', 'orderBy']) {
      builder[method] = (...args: any[]) => {
        for (const arg of args) {
          if (typeof arg === 'function') arg.call(builder, builder);
        }
        return builder;
      };
    }
    builder.update = (patch: any) => {
      updates.push({ table, patch });
      return Promise.resolve(1);
    };
    builder.first = () => Promise.resolve(tableData[table]?.()[0]);
    builder.then = (onFulfilled: any, onRejected: any) =>
      Promise.resolve(tableData[table]?.() ?? []).then(onFulfilled, onRejected);
    return builder;
  };
  knex.__updates = updates;
  return knex;
}

function createFakeRepo(state: FakeState) {
  const errors: any[] = [];
  return {
    errors,
    getBatch: vi.fn(async () => state.batch),
    listLines: vi.fn(async () => state.lines),
    addError: vi.fn(async (error: any) => {
      errors.push({ ...error, resolution_state: 'open' });
    }),
    listErrors: vi.fn(async () => errors),
    updateBatchStatus: vi.fn(async () => {}),
  };
}

function createFakeResolver(overrides: Partial<Record<string, any>> = {}) {
  return {
    resolveServiceMapping: vi.fn(async () => ({ external_entity_id: 'item-1', source: 'service' })),
    resolveTaxCodeMapping: vi.fn(async () => ({ external_entity_id: 'tax-1', source: 'tax_code' })),
    resolvePaymentTermMapping: vi.fn(async () => ({ external_entity_id: 'term-1', source: 'payment_term' })),
    resolveDiscountMapping: vi.fn(async () => ({ external_entity_id: 'discount-item', source: 'discount' })),
    ...overrides,
  };
}

function makeCanonicalLine(overrides: Partial<any> = {}) {
  return {
    line_id: 'line-1',
    document_id: 'inv-1',
    document_line_id: 'charge-1',
    service_period_start: P1_START,
    service_period_end: P1_END,
    payload: {
      service_period_source: 'canonical_detail_periods',
      recurring_detail_periods: [
        { service_period_start: P1_START, service_period_end: P1_END, billing_timing: 'advance' },
      ],
    },
    ...overrides,
  };
}

function baseState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    batch: { batch_id: 'batch-1', tenant: TENANT, adapter_type: 'xero_csv', target_realm: null },
    lines: [makeCanonicalLine()],
    charges: [{ item_id: 'charge-1', invoice_id: 'inv-1', service_id: 'svc-1', tax_region: null }],
    chargeDetails: [
      { item_id: 'charge-1', service_period_start: P1_START, service_period_end: P1_END, billing_timing: 'advance' },
    ],
    invoices: [{ invoice_id: 'inv-1', client_id: 'client-1', tax_source: 'internal' }],
    clients: [{ client_id: 'client-1', payment_terms: 'net_30' }],
    services: [{ service_id: 'svc-1', service_name: 'Managed Backup' }],
    ...overrides,
  };
}

async function run(state: FakeState, resolver = createFakeResolver()) {
  h.repo = createFakeRepo(state);
  h.resolver = resolver;
  h.knex = createFakeKnex(state);
  await AccountingExportValidation.ensureMappingsForBatch('batch-1', adapters);
  return { repo: h.repo, resolver, knex: h.knex };
}

describe('AccountingExportValidation.ensureMappingsForBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allowedLineTaxCodesMock.mockReset();
    allowedLineTaxCodesMock.mockResolvedValue(null);
  });

  it('throws when the batch does not exist', async () => {
    h.repo = { getBatch: vi.fn(async () => null) };
    await expect(AccountingExportValidation.ensureMappingsForBatch('missing')).rejects.toThrow(
      'Export batch missing not found'
    );
  });

  it('marks a fully mapped batch ready and resolves prior open errors', async () => {
    const { repo, knex } = await run(baseState());

    expect(repo.addError).not.toHaveBeenCalled();
    expect(repo.updateBatchStatus).toHaveBeenCalledWith('batch-1', { status: 'ready' });
    // Prior open validation errors are reset at the start of each run.
    expect(knex.__updates).toContainEqual({
      table: 'accounting_export_errors',
      patch: expect.objectContaining({ resolution_state: 'resolved' }),
    });
  });

  it('flags lines without an invoice charge id', async () => {
    const state = baseState({
      lines: [makeCanonicalLine({ document_line_id: null })],
    });
    const { repo } = await run(state);

    expect(repo.errors).toEqual([
      expect.objectContaining({ code: 'missing_charge_id', line_id: 'line-1' }),
    ]);
    expect(repo.updateBatchStatus).toHaveBeenCalledWith('batch-1', { status: 'needs_attention' });
  });

  it('flags charges that have no associated service', async () => {
    const state = baseState({
      charges: [{ item_id: 'charge-1', invoice_id: 'inv-1', service_id: null, tax_region: null }],
    });
    const { repo } = await run(state);

    expect(repo.errors).toEqual([
      expect.objectContaining({ code: 'missing_service', line_id: 'line-1' }),
    ]);
  });

  it('accepts a service-less discount line when the realm has a discount mapping', async () => {
    const state = baseState({
      charges: [{ item_id: 'charge-1', invoice_id: 'inv-1', service_id: null, tax_region: null, is_discount: true, net_amount: -500 }],
    });
    const resolver = createFakeResolver();
    const { repo } = await run(state, resolver);

    expect(repo.errors.map((e: any) => e.code)).not.toContain('missing_service');
    expect(repo.errors.map((e: any) => e.code)).not.toContain('missing_discount_mapping');
    expect(resolver.resolveServiceMapping).not.toHaveBeenCalled();
  });

  it('reports a missing discount mapping once per realm instead of missing_service', async () => {
    const state = baseState({
      lines: [
        makeCanonicalLine({ line_id: 'line-1', document_line_id: 'charge-1' }),
        makeCanonicalLine({ line_id: 'line-2', document_line_id: 'charge-2' }),
      ],
      charges: [
        { item_id: 'charge-1', invoice_id: 'inv-1', service_id: null, tax_region: null, is_discount: true, net_amount: -500 },
        { item_id: 'charge-2', invoice_id: 'inv-1', service_id: null, tax_region: null, is_discount: true, net_amount: -250 },
      ],
      chargeDetails: [
        { item_id: 'charge-1', service_period_start: P1_START, service_period_end: P1_END, billing_timing: 'advance' },
        { item_id: 'charge-2', service_period_start: P1_START, service_period_end: P1_END, billing_timing: 'advance' },
      ],
    });
    const resolver = createFakeResolver({ resolveDiscountMapping: vi.fn(async () => null) });
    const { repo } = await run(state, resolver);

    const discountErrors = repo.errors.filter((e: any) => e.code === 'missing_discount_mapping');
    expect(discountErrors).toHaveLength(1);
    expect(repo.errors.map((e: any) => e.code)).not.toContain('missing_service');
    expect(repo.updateBatchStatus).toHaveBeenCalledWith('batch-1', { status: 'needs_attention' });
  });

  it('reports an unmapped service once per service+realm, with the service name', async () => {
    const state = baseState({
      lines: [
        makeCanonicalLine({ line_id: 'line-1' }),
        makeCanonicalLine({ line_id: 'line-2' }),
      ],
    });
    const resolver = createFakeResolver({ resolveServiceMapping: vi.fn(async () => null) });
    const { repo } = await run(state, resolver);

    const serviceErrors = repo.errors.filter((e: any) => e.code === 'missing_service_mapping');
    expect(serviceErrors).toHaveLength(1);
    expect(serviceErrors[0].message).toBe('No mapping for service "Managed Backup"');
    expect(serviceErrors[0].metadata).toMatchObject({
      service_id: 'svc-1',
      service_name: 'Managed Backup',
      service_period_start: P1_START,
      service_period_end: P1_END,
    });
    expect(resolver.resolveServiceMapping).toHaveBeenCalledTimes(1);
    expect(repo.updateBatchStatus).toHaveBeenCalledWith('batch-1', { status: 'needs_attention' });
  });

  it('rejects export lines whose projected service periods diverge from canonical charge details', async () => {
    const state = baseState({
      lines: [
        makeCanonicalLine({
          // Line claims a financial-document fallback even though canonical
          // detail periods exist for the charge.
          service_period_start: null,
          service_period_end: null,
          payload: { service_period_source: 'financial_document_fallback' },
        }),
      ],
    });
    const { repo } = await run(state);

    expect(repo.errors).toEqual([
      expect.objectContaining({
        code: 'service_period_projection_mismatch',
        metadata: expect.objectContaining({
          expected_source: 'canonical_detail_periods',
          actual_source: 'financial_document_fallback',
          expected_summary: { service_period_start: P1_START, service_period_end: P1_END },
        }),
      }),
    ]);
  });

  it('uses first-start/last-end of multi-period charges for the expected summary', async () => {
    const state = baseState({
      chargeDetails: [
        { item_id: 'charge-1', service_period_start: P1_START, service_period_end: P1_END, billing_timing: 'arrears' },
        { item_id: 'charge-1', service_period_start: P2_START, service_period_end: P2_END, billing_timing: 'arrears' },
      ],
      lines: [
        makeCanonicalLine({
          service_period_start: P1_START,
          service_period_end: P2_END,
          payload: {
            service_period_source: 'canonical_detail_periods',
            recurring_detail_periods: [
              { service_period_start: P1_START, service_period_end: P1_END, billing_timing: 'arrears' },
              { service_period_start: P2_START, service_period_end: P2_END, billing_timing: 'arrears' },
            ],
          },
        }),
      ],
    });
    const { repo } = await run(state);

    expect(repo.errors).toEqual([]);
    expect(repo.updateBatchStatus).toHaveBeenCalledWith('batch-1', { status: 'ready' });
  });

  it('rejects historical/financial lines that claim canonical recurring detail periods', async () => {
    const state = baseState({
      chargeDetails: [],
      lines: [
        makeCanonicalLine({
          service_period_start: null,
          service_period_end: null,
          payload: {
            service_period_source: 'financial_document_fallback',
            recurring_detail_periods: [
              { service_period_start: P1_START, service_period_end: P1_END, billing_timing: 'advance' },
            ],
          },
        }),
      ],
    });
    const { repo } = await run(state);

    expect(repo.errors).toEqual([
      expect.objectContaining({
        code: 'service_period_projection_mismatch',
        message: 'Historical or financial export lines must not claim canonical recurring detail periods',
      }),
    ]);
  });

  it('accepts invoice-header fallback lines that carry summary periods but no detail periods', async () => {
    const state = baseState({
      chargeDetails: [],
      lines: [
        makeCanonicalLine({
          payload: { service_period_source: 'invoice_header_fallback' },
        }),
      ],
    });
    const { repo } = await run(state);

    expect(repo.errors).toEqual([]);
    expect(repo.updateBatchStatus).toHaveBeenCalledWith('batch-1', { status: 'ready' });
  });

  describe('QuickBooks-specific rules', () => {
    function qboState(overrides: Partial<FakeState> = {}): FakeState {
      return baseState({
        batch: { batch_id: 'batch-1', tenant: TENANT, adapter_type: 'quickbooks_online', target_realm: 'realm-9' },
        ...overrides,
      });
    }

    it('requires a target realm for QuickBooks Online batches', async () => {
      const state = qboState({
        batch: { batch_id: 'batch-1', tenant: TENANT, adapter_type: 'quickbooks_online', target_realm: null },
      });
      const { repo } = await run(state);

      expect(repo.errors).toContainEqual(
        expect.objectContaining({ code: 'missing_target_realm' })
      );
    });

    it('flags unmapped tax regions on internally-taxed invoices', async () => {
      const state = qboState({
        charges: [{ item_id: 'charge-1', invoice_id: 'inv-1', service_id: 'svc-1', tax_region: 'US-NY' }],
      });
      const resolver = createFakeResolver({ resolveTaxCodeMapping: vi.fn(async () => null) });
      const { repo } = await run(state, resolver);

      expect(repo.errors).toEqual([
        expect.objectContaining({
          code: 'missing_tax_mapping',
          message: 'No tax code mapping for region US-NY',
        }),
      ]);
    });

    it('skips tax-mapping checks when the invoice delegates tax externally', async () => {
      const state = qboState({
        charges: [{ item_id: 'charge-1', invoice_id: 'inv-1', service_id: 'svc-1', tax_region: 'US-NY' }],
        invoices: [{ invoice_id: 'inv-1', client_id: 'client-1', tax_source: 'external' }],
      });
      const resolver = createFakeResolver({ resolveTaxCodeMapping: vi.fn(async () => null) });
      const { repo } = await run(state, resolver);

      expect(resolver.resolveTaxCodeMapping).not.toHaveBeenCalled();
      expect(repo.errors).toEqual([]);
    });

    /**
     * Intuit accepts only the TAX/NON pseudo codes as a line TaxCodeRef on a
     * US Automated Sales Tax company; anything else fails delivery with the
     * opaque "Invalid Line TaxCode" (6100). A mapping that names a real
     * catalog code used to pass validation and fail at delivery forever.
     */
    describe('Automated Sales Tax tax-code mappings', () => {
      function astState(charge: Record<string, unknown> = {}) {
        return qboState({
          charges: [
            {
              item_id: 'charge-1',
              invoice_id: 'inv-1',
              service_id: 'svc-1',
              tax_region: 'DEFAULT',
              is_taxable: true,
              ...charge,
            },
          ],
        });
      }

      function mappedTo(externalEntityId: string, metadata: Record<string, unknown> = {}) {
        return createFakeResolver({
          resolveTaxCodeMapping: vi.fn(async () => ({
            external_entity_id: externalEntityId,
            metadata,
            source: 'tax_code',
          })),
        });
      }

      it('flags a taxable line mapped to a catalog code on a US AST company', async () => {
        allowedLineTaxCodesMock.mockResolvedValue(PSEUDO_CODES);
        const resolver = mappedTo('2', { externalDisplayName: 'Out of scope (0%)' });

        const { repo } = await run(astState(), resolver);

        expect(repo.errors).toEqual([
          expect.objectContaining({
            code: 'invalid_tax_mapping',
            message:
              'Tax region DEFAULT is mapped to QuickBooks tax code "Out of scope (0%)", which QuickBooks rejects on Automated Sales Tax companies. Map it to TAX or NON under Settings → Integrations → Accounting → QuickBooks → Tax Codes.',
            metadata: expect.objectContaining({
              tax_region: 'DEFAULT',
              external_entity_id: '2',
              external_display_name: 'Out of scope (0%)',
            }),
          }),
        ]);
        expect(repo.updateBatchStatus).toHaveBeenCalledWith('batch-1', { status: 'needs_attention' });
      });

      it('names the bare QuickBooks id when the mapping kept no display name', async () => {
        allowedLineTaxCodesMock.mockResolvedValue(PSEUDO_CODES);

        const { repo } = await run(astState(), mappedTo('4'));

        expect(repo.errors[0].message).toContain('QuickBooks tax code "4"');
      });

      it.each(['TAX', 'NON'])('accepts the %s pseudo code on a US AST company', async (pseudo) => {
        allowedLineTaxCodesMock.mockResolvedValue(PSEUDO_CODES);

        const { repo } = await run(astState(), mappedTo(pseudo));

        expect(repo.errors).toEqual([]);
        expect(repo.updateBatchStatus).toHaveBeenCalledWith('batch-1', { status: 'ready' });
      });

      it('does not flag a non-taxable line: the exporter sends NON for it', async () => {
        allowedLineTaxCodesMock.mockResolvedValue(PSEUDO_CODES);
        const resolver = mappedTo('2', { externalDisplayName: 'Out of scope (0%)' });

        const { repo } = await run(astState({ is_taxable: false }), resolver);

        expect(repo.errors).toEqual([]);
      });

      it('leaves an unrestricted company alone — custom codes are legitimate there', async () => {
        // Canadian AST files really do bill through "HST ON" / "GST" / "PST BC".
        allowedLineTaxCodesMock.mockResolvedValue(null);

        const { repo } = await run(astState(), mappedTo('HST-ON'));

        expect(repo.errors).toEqual([]);
        expect(allowedLineTaxCodesMock).toHaveBeenCalledWith(TENANT, 'realm-9');
      });

      it('skips the rule when no adapter lookup is supplied', async () => {
        allowedLineTaxCodesMock.mockResolvedValue(PSEUDO_CODES);
        const state = astState();
        h.repo = createFakeRepo(state);
        h.resolver = mappedTo('2');
        h.knex = createFakeKnex(state);

        await AccountingExportValidation.ensureMappingsForBatch('batch-1');

        expect(h.repo.errors).toEqual([]);
        expect(allowedLineTaxCodesMock).not.toHaveBeenCalled();
      });

      it('still reports a missing mapping rather than an invalid one', async () => {
        allowedLineTaxCodesMock.mockResolvedValue(PSEUDO_CODES);
        const resolver = createFakeResolver({ resolveTaxCodeMapping: vi.fn(async () => null) });

        const { repo } = await run(astState(), resolver);

        expect(repo.errors).toEqual([
          expect.objectContaining({ code: 'missing_tax_mapping' }),
        ]);
      });

      it('reports one invalid mapping per region, and judges each line taxability', async () => {
        // The region's mapping is resolved once, but taxability is per charge:
        // a non-taxable line must not consume the region's only check and hide
        // a taxable line that follows it.
        allowedLineTaxCodesMock.mockResolvedValue(PSEUDO_CODES);
        const state = qboState({
          lines: [
            makeCanonicalLine({ line_id: 'line-1', document_line_id: 'charge-1' }),
            makeCanonicalLine({ line_id: 'line-2', document_line_id: 'charge-2' }),
          ],
          charges: [
            { item_id: 'charge-1', invoice_id: 'inv-1', service_id: 'svc-1', tax_region: 'DEFAULT', is_taxable: false },
            { item_id: 'charge-2', invoice_id: 'inv-1', service_id: 'svc-1', tax_region: 'DEFAULT', is_taxable: true },
          ],
          chargeDetails: [
            { item_id: 'charge-1', service_period_start: P1_START, service_period_end: P1_END, billing_timing: 'advance' },
            { item_id: 'charge-2', service_period_start: P1_START, service_period_end: P1_END, billing_timing: 'advance' },
          ],
        });
        const resolver = mappedTo('2');

        const { repo } = await run(state, resolver);

        const invalid = repo.errors.filter((e: any) => e.code === 'invalid_tax_mapping');
        expect(invalid).toHaveLength(1);
        expect(invalid[0].line_id).toBe('line-2');
        expect(resolver.resolveTaxCodeMapping).toHaveBeenCalledTimes(1);
      });

      it('does not apply the rule to QuickBooks CSV batches', async () => {
        allowedLineTaxCodesMock.mockResolvedValue(PSEUDO_CODES);
        const state = astState();
        state.batch = { batch_id: 'batch-1', tenant: TENANT, adapter_type: 'quickbooks_csv', target_realm: 'realm-9' };

        const { repo } = await run(state, mappedTo('2'));

        expect(repo.errors).toEqual([]);
      });
    });

    it('flags invoices without a client association', async () => {
      const state = qboState({
        invoices: [{ invoice_id: 'inv-1', client_id: null, tax_source: 'internal' }],
      });
      const { repo } = await run(state);

      expect(repo.errors).toContainEqual(
        expect.objectContaining({
          code: 'missing_client_reference',
          message: 'Invoice inv-1 is missing a client association',
        })
      );
    });

    it('flags unmapped client payment terms', async () => {
      const resolver = createFakeResolver({ resolvePaymentTermMapping: vi.fn(async () => null) });
      const { repo } = await run(qboState(), resolver);

      expect(repo.errors).toContainEqual(
        expect.objectContaining({
          code: 'missing_payment_term_mapping',
          message: 'No payment term mapping for net_30',
          metadata: expect.objectContaining({ client_id: 'client-1', payment_terms: 'net_30' }),
        })
      );
    });

    it('does not apply QuickBooks rules to non-QuickBooks adapters', async () => {
      const state = baseState({
        batch: { batch_id: 'batch-1', tenant: TENANT, adapter_type: 'xero', target_realm: null },
        charges: [{ item_id: 'charge-1', invoice_id: 'inv-1', service_id: 'svc-1', tax_region: 'US-NY' }],
      });
      const resolver = createFakeResolver({
        resolveTaxCodeMapping: vi.fn(async () => null),
        resolvePaymentTermMapping: vi.fn(async () => null),
      });
      const { repo } = await run(state, resolver);

      expect(resolver.resolveTaxCodeMapping).not.toHaveBeenCalled();
      expect(resolver.resolvePaymentTermMapping).not.toHaveBeenCalled();
      expect(repo.errors).toEqual([]);
    });
  });
});
