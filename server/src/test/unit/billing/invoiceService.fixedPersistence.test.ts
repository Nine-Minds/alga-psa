import { describe, expect, it } from "vitest";

import { persistInvoiceCharges } from "@alga-psa/billing/services/invoiceService";

function createMockTx() {
  const inserts: Record<string, any[]> = {
    invoice_charges: [],
    invoice_charge_details: [],
    invoice_charge_fixed_details: [],
  };

  const tx: any = (tableName: string) => ({
    insert: async (payload: any) => {
      inserts[tableName].push(payload);
      return [payload];
    },
  });

  return { tx, inserts };
}

describe("invoiceService fixed recurring persistence", () => {
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
});
