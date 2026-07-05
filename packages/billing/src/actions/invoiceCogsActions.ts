'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import type { InvoiceLineCogsRow } from '@alga-psa/inventory/lib/integrationTypes';

export type { InvoiceLineCogsRow } from '@alga-psa/inventory/lib/integrationTypes';

type InvoiceLineCogsSqlRow = {
  item_id: string;
  so_id: string | null;
  so_number: string | null;
  so_line_id: string | null;
  cogs_total: string | number | null;
  line_amount: string | number | null;
};

/**
 * Testable tenant-scoped implementation behind the server action.
 *
 * SO fulfillment movements currently carry source_doc_id = sales_orders.so_id, not the
 * line id, so SO COGS is recovered through invoice_charges.so_line_id -> sales_order_lines
 * and then matched to consume movements by (tenant, so_id, service_id).
 *
 * Material invoice charges do not persist a material id. The read side pairs billed
 * materials back to product invoice charges by the same fields billing used to create
 * those charges, plus a row_number to keep identical material rows one-to-one.
 */
export async function getInvoiceLineCogsForTenant(
  trx: Knex.Transaction | Knex,
  tenant: string,
  invoiceId: string,
): Promise<InvoiceLineCogsRow[]> {
  const result = await trx.raw(
    `
      WITH invoice_lines AS (
        SELECT
          ic.tenant,
          ic.invoice_id,
          ic.item_id,
          ic.service_id,
          ic.so_line_id,
          ic.quantity,
          ic.unit_price,
          ic.net_amount,
          ic.description,
          ic.created_at,
          ROW_NUMBER() OVER (
            PARTITION BY
              ic.tenant,
              ic.invoice_id,
              ic.service_id,
              ic.quantity,
              ic.unit_price,
              regexp_replace(COALESCE(ic.description, ''), '^Product: ', '')
            ORDER BY ic.created_at ASC, ic.item_id ASC
          ) AS material_match_seq
        FROM invoice_charges ic
        WHERE ic.tenant = ?
          AND ic.invoice_id = ?
      ),
      so_line_cogs AS (
        SELECT
          il.item_id,
          so.so_id,
          so.so_number,
          sol.so_line_id,
          SUM(sm.cogs_cost) AS cogs_total
        FROM invoice_lines il
        JOIN sales_order_lines sol
          ON sol.tenant = il.tenant
         AND sol.so_line_id = il.so_line_id
        JOIN sales_orders so
          ON so.tenant = sol.tenant
         AND so.so_id = sol.so_id
        LEFT JOIN stock_movements sm
          ON sm.tenant = il.tenant
         AND sm.movement_type = 'consume'
         AND sm.source_doc_type = 'sales_order'
         AND sm.source_doc_id = so.so_id
         AND sm.service_id = sol.service_id
        WHERE il.so_line_id IS NOT NULL
        GROUP BY il.item_id, so.so_id, so.so_number, sol.so_line_id
      ),
      material_candidates AS (
        SELECT
          tm.tenant,
          tm.billed_invoice_id AS invoice_id,
          tm.service_id,
          tm.quantity,
          tm.rate,
          COALESCE(tm.description, sc.service_name, 'Material') AS material_description,
          'ticket_material'::text AS source_doc_type,
          tm.ticket_material_id AS source_doc_id,
          tm.created_at
        FROM ticket_materials tm
        LEFT JOIN service_catalog sc
          ON sc.tenant = tm.tenant
         AND sc.service_id = tm.service_id
        WHERE tm.tenant = ?
          AND tm.billed_invoice_id = ?

        UNION ALL

        SELECT
          pm.tenant,
          pm.billed_invoice_id AS invoice_id,
          pm.service_id,
          pm.quantity,
          pm.rate,
          COALESCE(pm.description, sc.service_name, 'Material') AS material_description,
          'project_material'::text AS source_doc_type,
          pm.project_material_id AS source_doc_id,
          pm.created_at
        FROM project_materials pm
        LEFT JOIN service_catalog sc
          ON sc.tenant = pm.tenant
         AND sc.service_id = pm.service_id
        WHERE pm.tenant = ?
          AND pm.billed_invoice_id = ?
      ),
      numbered_materials AS (
        SELECT
          mc.*,
          ROW_NUMBER() OVER (
            PARTITION BY
              mc.tenant,
              mc.invoice_id,
              mc.service_id,
              mc.quantity,
              mc.rate,
              mc.material_description
            ORDER BY mc.created_at ASC, mc.source_doc_id ASC
          ) AS material_match_seq
        FROM material_candidates mc
      ),
      material_line_cogs AS (
        SELECT
          il.item_id,
          SUM(sm.cogs_cost) AS cogs_total
        FROM invoice_lines il
        JOIN numbered_materials nm
          ON nm.tenant = il.tenant
         AND nm.invoice_id = il.invoice_id
         AND nm.service_id = il.service_id
         AND nm.quantity::numeric = il.quantity::numeric
         AND nm.rate = il.unit_price
         AND nm.material_description = regexp_replace(COALESCE(il.description, ''), '^Product: ', '')
         AND nm.material_match_seq = il.material_match_seq
        LEFT JOIN stock_movements sm
          ON sm.tenant = il.tenant
         AND sm.movement_type = 'consume'
         AND sm.source_doc_type = nm.source_doc_type
         AND sm.source_doc_id = nm.source_doc_id
        WHERE il.so_line_id IS NULL
        GROUP BY il.item_id
      )
      SELECT
        il.item_id,
        slc.so_id,
        slc.so_number,
        il.so_line_id,
        CASE
          WHEN il.so_line_id IS NOT NULL THEN slc.cogs_total
          ELSE mlc.cogs_total
        END AS cogs_total,
        COALESCE(il.net_amount, 0) AS line_amount
      FROM invoice_lines il
      LEFT JOIN so_line_cogs slc
        ON slc.item_id = il.item_id
      LEFT JOIN material_line_cogs mlc
        ON mlc.item_id = il.item_id
      ORDER BY il.created_at ASC, il.item_id ASC
    `,
    [tenant, invoiceId, tenant, invoiceId, tenant, invoiceId],
  );

  const rows = (result.rows ?? result) as InvoiceLineCogsSqlRow[];
  return rows.map((row) => {
    const lineAmount = Math.round(Number(row.line_amount ?? 0));
    const cogsTotal = row.cogs_total === null || row.cogs_total === undefined
      ? null
      : Math.round(Number(row.cogs_total));

    return {
      item_id: row.item_id,
      so_id: row.so_id ?? null,
      so_number: row.so_number ?? null,
      so_line_id: row.so_line_id ?? null,
      cogs_total: cogsTotal,
      line_amount: lineAmount,
      margin_ratio: cogsTotal === null || lineAmount === 0
        ? null
        : (lineAmount - cogsTotal) / lineAmount,
    };
  });
}

/**
 * Per-line COGS + margin for an invoice's lines (F039), joined from stock_movements via
 * so_line_id / material backlinks. Internal views only — never customer-facing output.
 * Lines without COGS data return cogs_total=null (not 0). Requires billing:read.
 */
export const getInvoiceLineCogs = withAuth(async (
  user,
  { tenant },
  invoiceId: string
): Promise<InvoiceLineCogsRow[]> => {
  if (!(await hasPermission(user, 'billing', 'read'))) {
    throw new Error('Permission denied: billing read required');
  }
  const { knex } = await createTenantKnex();
  return withTransaction(knex, (trx: Knex.Transaction) =>
    getInvoiceLineCogsForTenant(trx, tenant, invoiceId),
  );
});
