import { describe, expect, it } from "vitest";

import { persistInvoiceCharges } from "@alga-psa/billing/services/invoiceService";

type Row = Record<string, any>;

function normalizeTableName(tableName: string) {
  return tableName.split(/\s+as\s+/i)[0].trim();
}

function buildPredicate(
  columnOrCriteria: Record<string, unknown> | string,
  value?: unknown,
) {
  if (typeof columnOrCriteria === "string") {
    return (row: Row) => row[columnOrCriteria] === value;
  }

  return (row: Row) =>
    Object.entries(columnOrCriteria).every(
      ([column, expected]) => row[column] === expected,
    );
}

function projectRow(row: Row | undefined, columns?: string[] | string) {
  if (!row || !columns) {
    return row;
  }

  const selectedColumns = Array.isArray(columns) ? columns : [columns];
  return Object.fromEntries(
    selectedColumns.map((column) => [column, row[column]]),
  );
}

class MockWhereGroup {
  private predicates: Array<(row: Row) => boolean> = [];

  where(columnOrCriteria: Record<string, unknown> | string, value?: unknown) {
    this.predicates.push(buildPredicate(columnOrCriteria, value));
    return this;
  }

  orWhere(columnOrCriteria: Record<string, unknown> | string, value?: unknown) {
    this.predicates.push(buildPredicate(columnOrCriteria, value));
    return this;
  }

  matches(row: Row) {
    return this.predicates.some((predicate) => predicate(row));
  }
}

class MockQueryBuilder {
  private predicates: Array<(row: Row) => boolean> = [];

  constructor(
    private readonly tables: Record<string, Row[]>,
    private readonly inserts: Record<string, Row[]>,
    private readonly tableName: string,
    private readonly missingTables: Set<string>,
  ) {}

  private get rows() {
    this.tables[this.tableName] ??= [];
    return this.tables[this.tableName];
  }

  private filteredRows() {
    return this.rows.filter((row) =>
      this.predicates.every((predicate) => predicate(row)),
    );
  }

  where(
    columnOrCriteria:
      | Record<string, unknown>
      | string
      | ((this: MockWhereGroup) => void),
    value?: unknown,
  ) {
    if (typeof columnOrCriteria === "function") {
      const group = new MockWhereGroup();
      columnOrCriteria.call(group);
      this.predicates.push((row) => group.matches(row));
      return this;
    }

    this.predicates.push(buildPredicate(columnOrCriteria, value));
    return this;
  }

  andWhere(columnOrCriteria: Record<string, unknown> | string, value?: unknown) {
    return this.where(columnOrCriteria, value);
  }

  whereIn(column: string, values: readonly unknown[]) {
    this.predicates.push((row) => values.includes(row[column]));
    return this;
  }

  whereNull(column: string) {
    this.predicates.push((row) => row[column] == null);
    return this;
  }

  async first(columns?: string[] | string) {
    if (this.missingTables.has(this.tableName)) {
      throw new Error(`relation "${this.tableName}" does not exist`);
    }
    return projectRow(this.filteredRows()[0], columns);
  }

  async select(...columns: string[]) {
    if (this.missingTables.has(this.tableName)) {
      throw new Error(`relation "${this.tableName}" does not exist`);
    }
    if (columns.length === 0) {
      return this.filteredRows();
    }

    return this.filteredRows().map((row) => projectRow(row, columns));
  }

  async update(payload: Row) {
    const rows = this.filteredRows();
    for (const row of rows) {
      Object.assign(row, payload);
    }
    return rows.length;
  }

  async insert(payload: Row) {
    this.inserts[this.tableName] ??= [];
    this.inserts[this.tableName].push(payload);
    this.rows.push(payload);
    return [payload];
  }
}

function createMockTx(
  initialTables: Record<string, Row[]> = {},
  options?: { missingTables?: string[] },
) {
  const tables = Object.fromEntries(
    Object.entries(initialTables).map(([tableName, rows]) => [
      normalizeTableName(tableName),
      rows.map((row) => ({ ...row })),
    ]),
  ) as Record<string, Row[]>;
  const missingTables = new Set(options?.missingTables ?? []);
  const inserts: Record<string, Row[]> = {
    invoice_charges: [],
    invoice_charge_details: [],
    invoice_charge_fixed_details: [],
  };

  const tx: any = (tableName: string) =>
    new MockQueryBuilder(
      tables,
      inserts,
      normalizeTableName(tableName),
      missingTables,
    );

  return { tx, inserts, tables };
}

describe("invoiceService fixed recurring persistence", () => {
  it("T069: recurring product invoice detail rows persist canonical service-period metadata correctly", async () => {
    const { tx, inserts } = createMockTx();

    const subtotal = await persistInvoiceCharges(
      tx,
      "invoice-1",
      [
        {
          type: "product",
          serviceId: "service-1",
          serviceName: "Managed Router",
          quantity: 2,
          rate: 4500,
          total: 9000,
          tax_amount: 0,
          tax_rate: 0,
          tax_region: "US-NY",
          is_taxable: false,
          servicePeriodStart: "2025-01-10",
          servicePeriodEnd: "2025-01-31",
          billingTiming: "arrears",
          tenant: "tenant-1",
        },
      ],
      {
        client_id: "client-1",
        tax_region: "US-NY",
      },
      {
        user: {
          id: "user-1",
        },
      } as any,
      "tenant-1",
    );

    expect(subtotal).toBe(9000);
    expect(inserts.invoice_charges).toHaveLength(1);
    expect(inserts.invoice_charge_details).toEqual([
      expect.objectContaining({
        item_id: inserts.invoice_charges[0].item_id,
        service_id: "service-1",
        quantity: 2,
        rate: 4500,
        service_period_start: "2025-01-10",
        service_period_end: "2025-01-31",
        billing_timing: "arrears",
      }),
    ]);
  });

  it("T070: recurring license invoice detail rows persist canonical service-period metadata correctly", async () => {
    const { tx, inserts } = createMockTx();

    const subtotal = await persistInvoiceCharges(
      tx,
      "invoice-1",
      [
        {
          type: "license",
          serviceId: "service-2",
          serviceName: "Microsoft 365 Business Premium",
          quantity: 3,
          rate: 3200,
          total: 9600,
          tax_amount: 0,
          tax_rate: 0,
          tax_region: "US-NY",
          is_taxable: false,
          servicePeriodStart: "2025-02-01",
          servicePeriodEnd: "2025-02-28",
          billingTiming: "advance",
          tenant: "tenant-1",
        },
      ],
      {
        client_id: "client-1",
        tax_region: "US-NY",
      },
      {
        user: {
          id: "user-1",
        },
      } as any,
      "tenant-1",
    );

    expect(subtotal).toBe(9600);
    expect(inserts.invoice_charges).toHaveLength(1);
    expect(inserts.invoice_charge_details).toEqual([
      expect.objectContaining({
        item_id: inserts.invoice_charges[0].item_id,
        service_id: "service-2",
        quantity: 3,
        rate: 3200,
        service_period_start: "2025-02-01",
        service_period_end: "2025-02-28",
        billing_timing: "advance",
      }),
    ]);
  });

  it("T053: fixed recurring parent invoice lines preserve client contract linkage for PO-scoped invoice association", async () => {
    const { tx, inserts } = createMockTx();

    await persistInvoiceCharges(
      tx,
      "invoice-1",
      [
        {
          type: "fixed",
          serviceId: "service-1",
          serviceName: "Managed Support",
          quantity: 1,
          rate: 10000,
          total: 10000,
          tax_amount: 0,
          tax_rate: 0,
          tax_region: "US-NY",
          is_taxable: false,
          client_contract_line_id: "contract-line-1",
          client_contract_id: "assignment-1",
          contract_name: "Acme Corp",
          config_id: "config-1",
          base_rate: 10000,
          enable_proration: false,
          fmv: 10000,
          proportion: 1,
          allocated_amount: 10000,
          servicePeriodStart: "2024-12-01",
          servicePeriodEnd: "2024-12-31",
          billingTiming: "arrears",
          tenant: "tenant-1",
        },
      ],
      {
        client_id: "client-1",
        tax_region: "US-NY",
      },
      {
        user: {
          id: "user-1",
        },
      } as any,
      "tenant-1",
    );

    expect(inserts.invoice_charges).toHaveLength(1);
    expect(inserts.invoice_charge_details).toHaveLength(1);
    expect(inserts.invoice_charges[0]).toMatchObject({
      invoice_id: "invoice-1",
      client_contract_id: "assignment-1",
      net_amount: 10000,
    });
    expect(inserts.invoice_charge_details[0]).toMatchObject({
      item_id: inserts.invoice_charges[0].item_id,
      service_id: "service-1",
      service_period_start: "2024-12-01",
      service_period_end: "2024-12-31",
      billing_timing: "arrears",
    });
  });

  it("T050: fixed recurring invoice detail rows persist canonical service-period metadata without subtotal drift", async () => {
    const { tx, inserts } = createMockTx();

    const subtotal = await persistInvoiceCharges(
      tx,
      "invoice-1",
      [
        {
          type: "fixed",
          serviceId: "service-1",
          serviceName: "Managed Support",
          quantity: 1,
          rate: 6000,
          total: 6000,
          tax_amount: 0,
          tax_rate: 0,
          tax_region: "US-NY",
          is_taxable: false,
          client_contract_line_id: "contract-line-1",
          client_contract_id: "assignment-1",
          contract_name: "Acme Corp",
          config_id: "config-1",
          base_rate: 10000,
          enable_proration: false,
          fmv: 6000,
          proportion: 0.6,
          allocated_amount: 6000,
          servicePeriodStart: "2024-12-01",
          servicePeriodEnd: "2024-12-31",
          billingTiming: "arrears",
          tenant: "tenant-1",
        },
        {
          type: "fixed",
          serviceId: "service-2",
          serviceName: "Managed Support",
          quantity: 1,
          rate: 4000,
          total: 4000,
          tax_amount: 0,
          tax_rate: 0,
          tax_region: "US-NY",
          is_taxable: false,
          client_contract_line_id: "contract-line-1",
          client_contract_id: "assignment-1",
          contract_name: "Acme Corp",
          config_id: "config-2",
          base_rate: 10000,
          enable_proration: false,
          fmv: 4000,
          proportion: 0.4,
          allocated_amount: 4000,
          servicePeriodStart: "2024-12-01",
          servicePeriodEnd: "2024-12-31",
          billingTiming: "arrears",
          tenant: "tenant-1",
        },
      ],
      {
        client_id: "client-1",
        tax_region: "US-NY",
      },
      {
        user: {
          id: "user-1",
        },
      } as any,
      "tenant-1",
    );

    expect(subtotal).toBe(10000);
    expect(inserts.invoice_charges).toHaveLength(1);
    expect(inserts.invoice_charge_details).toHaveLength(2);
    expect(inserts.invoice_charge_fixed_details).toHaveLength(2);

    const parentCharge = inserts.invoice_charges[0];
    expect(parentCharge).toMatchObject({
      invoice_id: "invoice-1",
      client_contract_id: "assignment-1",
      net_amount: 10000,
      total_price: 10000,
    });

    expect(inserts.invoice_charge_details).toEqual([
      expect.objectContaining({
        item_id: parentCharge.item_id,
        service_id: "service-1",
        service_period_start: "2024-12-01",
        service_period_end: "2024-12-31",
        billing_timing: "arrears",
      }),
      expect.objectContaining({
        item_id: parentCharge.item_id,
        service_id: "service-2",
        service_period_start: "2024-12-01",
        service_period_end: "2024-12-31",
        billing_timing: "arrears",
      }),
    ]);

    const allocatedSubtotal = inserts.invoice_charge_fixed_details.reduce(
      (sum, row) => sum + Number(row.allocated_amount || 0),
      0,
    );
    expect(allocatedSubtotal).toBe(10000);
    expect(allocatedSubtotal).toBe(parentCharge.net_amount);
  });

  it("links a client-cadence recurring detail row through canonical client-contract-line identity without a billing-cycle bridge", async () => {
    const { tx, inserts, tables } = createMockTx({
      invoices: [
        {
          invoice_id: "invoice-1",
          tenant: "tenant-1",
          billing_period_start: "2025-02-01",
          billing_period_end: "2025-03-01",
          billing_cycle_id: null,
        },
      ],
      contract_line_service_configuration: [
        {
          tenant: "tenant-1",
          config_id: "config-1",
          contract_line_id: "contract-line-1",
        },
      ],
      recurring_service_periods: [
        {
          record_id: "rsp-client-1",
          tenant: "tenant-1",
          charge_family: "product",
          due_position: "arrears",
          obligation_type: "client_contract_line",
          obligation_id: "contract-line-1",
          lifecycle_state: "generated",
          invoice_charge_detail_id: null,
          service_period_start: "2025-01-01",
          service_period_end: "2025-02-01",
          invoice_window_start: "2025-02-01",
          invoice_window_end: "2025-03-01",
        },
      ],
    }, {
      missingTables: ["client_contract_lines"],
    });

    await persistInvoiceCharges(
      tx,
      "invoice-1",
      [
        {
          type: "product",
          serviceId: "service-1",
          serviceName: "Firewall License",
          quantity: 1,
          rate: 9000,
          total: 9000,
          tax_amount: 0,
          tax_rate: 0,
          tax_region: "US-NY",
          is_taxable: false,
          config_id: "config-1",
          servicePeriodStart: "2025-01-01",
          servicePeriodEnd: "2025-02-01",
          billingTiming: "arrears",
          tenant: "tenant-1",
        },
      ],
      {
        client_id: "client-1",
        tax_region: "US-NY",
      },
      {
        user: {
          id: "user-1",
        },
      } as any,
      "tenant-1",
    );

    expect(tables.recurring_service_periods[0]).toMatchObject({
      record_id: "rsp-client-1",
      lifecycle_state: "billed",
      invoice_id: "invoice-1",
      invoice_charge_id: inserts.invoice_charges[0].item_id,
      invoice_charge_detail_id: inserts.invoice_charge_details[0].item_detail_id,
    });
    expect(tables.recurring_service_periods[0].invoice_linked_at).toEqual(
      tables.recurring_service_periods[0].updated_at,
    );
  });

  it("links a contract-cadence recurring detail row through canonical contract-line identity without consulting billing-cycle bridge metadata", async () => {
    const { tx, inserts, tables } = createMockTx({
      invoices: [
        {
          invoice_id: "invoice-1",
          tenant: "tenant-1",
          billing_period_start: "2025-03-01",
          billing_period_end: "2025-04-01",
          billing_cycle_id: null,
        },
      ],
      contract_line_service_configuration: [
        {
          tenant: "tenant-1",
          config_id: "config-2",
          contract_line_id: "contract-line-2",
        },
      ],
      recurring_service_periods: [
        {
          record_id: "rsp-contract-1",
          tenant: "tenant-1",
          charge_family: "fixed",
          due_position: "advance",
          obligation_type: "contract_line",
          obligation_id: "contract-line-2",
          lifecycle_state: "locked",
          invoice_charge_detail_id: null,
          service_period_start: "2025-03-01",
          service_period_end: "2025-03-31",
          invoice_window_start: "2025-03-01",
          invoice_window_end: "2025-04-01",
        },
      ],
    }, {
      missingTables: ["client_contract_lines"],
    });

    await persistInvoiceCharges(
      tx,
      "invoice-1",
      [
        {
          type: "fixed",
          serviceId: "service-2",
          serviceName: "Managed Support",
          quantity: 1,
          rate: 12000,
          total: 12000,
          tax_amount: 0,
          tax_rate: 0,
          tax_region: "US-NY",
          is_taxable: false,
          client_contract_line_id: "contract-line-2",
          client_contract_id: "assignment-2",
          contract_name: "Acme Corp",
          config_id: "config-2",
          base_rate: 12000,
          enable_proration: false,
          fmv: 12000,
          proportion: 1,
          allocated_amount: 12000,
          servicePeriodStart: "2025-03-01",
          servicePeriodEnd: "2025-03-31",
          billingTiming: "advance",
          tenant: "tenant-1",
        },
      ],
      {
        client_id: "client-1",
        tax_region: "US-NY",
      },
      {
        user: {
          id: "user-1",
        },
      } as any,
      "tenant-1",
    );

    expect(tables.recurring_service_periods[0]).toMatchObject({
      record_id: "rsp-contract-1",
      lifecycle_state: "billed",
      invoice_id: "invoice-1",
      invoice_charge_id: inserts.invoice_charges[0].item_id,
      invoice_charge_detail_id: inserts.invoice_charge_details[0].item_detail_id,
    });
    expect(tables.recurring_service_periods[0].invoice_linked_at).toEqual(
      tables.recurring_service_periods[0].updated_at,
    );
  });

  it("T038: fixed recurring consolidation keeps sibling assignment charges separated when they share a base contract line", async () => {
    const { tx, inserts } = createMockTx({
      contract_line_service_configuration: [
        {
          tenant: "tenant-1",
          config_id: "config-a",
          contract_line_id: "contract-line-shared",
        },
        {
          tenant: "tenant-1",
          config_id: "config-b",
          contract_line_id: "contract-line-shared",
        },
      ],
    });

    await persistInvoiceCharges(
      tx,
      "invoice-1",
      [
        {
          type: "fixed",
          serviceId: "service-1",
          serviceName: "Managed Support",
          quantity: 1,
          rate: 6000,
          total: 6000,
          tax_amount: 0,
          tax_rate: 0,
          tax_region: "US-NY",
          is_taxable: false,
          client_contract_line_id: "contract-line-shared",
          client_contract_id: "assignment-1",
          contract_name: "Acme Corp",
          config_id: "config-a",
          base_rate: 6000,
          enable_proration: false,
          fmv: 6000,
          proportion: 1,
          allocated_amount: 6000,
          servicePeriodStart: "2025-03-01",
          servicePeriodEnd: "2025-03-31",
          billingTiming: "advance",
          tenant: "tenant-1",
        },
        {
          type: "fixed",
          serviceId: "service-2",
          serviceName: "Managed Support",
          quantity: 1,
          rate: 4000,
          total: 4000,
          tax_amount: 0,
          tax_rate: 0,
          tax_region: "US-NY",
          is_taxable: false,
          client_contract_line_id: "contract-line-shared",
          client_contract_id: "assignment-2",
          contract_name: "Acme Corp",
          config_id: "config-b",
          base_rate: 4000,
          enable_proration: false,
          fmv: 4000,
          proportion: 1,
          allocated_amount: 4000,
          servicePeriodStart: "2025-03-01",
          servicePeriodEnd: "2025-03-31",
          billingTiming: "advance",
          tenant: "tenant-1",
        },
      ],
      {
        client_id: "client-1",
        tax_region: "US-NY",
      },
      {
        user: {
          id: "user-1",
        },
      } as any,
      "tenant-1",
    );

    expect(inserts.invoice_charges).toHaveLength(2);
    expect(
      inserts.invoice_charges
        .map((charge) => charge.client_contract_id)
        .sort(),
    ).toEqual(["assignment-1", "assignment-2"]);
    expect(
      inserts.invoice_charges
        .map((charge) => charge.net_amount)
        .sort((left, right) => left - right),
    ).toEqual([4000, 6000]);
    expect(inserts.invoice_charge_fixed_details).toHaveLength(2);
  });
});
