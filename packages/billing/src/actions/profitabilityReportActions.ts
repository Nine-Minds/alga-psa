'use server';

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import type { Knex } from 'knex';

const COUNTABLE_INVOICE_STATUSES = [
  'sent',
  'paid',
  'partially_applied',
  'overdue',
  'open',
  'completed',
  'Unpaid',
] as const;

type ProfitabilityDateInput = {
  startDate?: string;
  endDate?: string;
  start?: string;
  end?: string;
};

export interface ProfitabilityMetricFields {
  revenue: number;
  laborCost: number;
  materialCost: number;
  margin: number;
  marginPct: number | null;
  totalMinutes: number;
  effectiveHourlyRate: number | null;
  uncostedMinutes: number;
  unattributedMinutes: number;
  unapprovedMinutes: number;
  zeroDurationEntryCount: number;
  uncostedMaterialCount: number;
  unconvertedRevenueCount: number;
  materialCurrencyMismatchCount: number;
}

export interface ProfitabilitySummary extends ProfitabilityMetricFields {
  costRatesConfigured: boolean;
}

export interface ClientProfitabilityRow extends ProfitabilityMetricFields {
  clientId: string | null;
  clientName: string;
}

export interface ContractLineProfitabilityRow extends ProfitabilityMetricFields {
  contractLineId: string | null;
  contractLineName: string;
  rowType: 'contract_line' | 'unassigned';
}

export interface AgreementProfitabilityRow extends ProfitabilityMetricFields {
  clientId: string | null;
  clientName: string;
  clientContractId: string | null;
  contractId: string | null;
  contractName: string;
  rowType: 'agreement' | 'ad_hoc' | 'unattributed';
  lines: ContractLineProfitabilityRow[];
}

export interface TicketProfitabilityRow extends ProfitabilityMetricFields {
  ticketId: string;
  ticketNumber: string | null;
  title: string | null;
  clientId: string | null;
  clientName: string;
  clientContractId: string | null;
  attribution: 'exact' | 'allocated' | 'none';
  billableMinutes: number;
  uncosted: boolean;
}

interface RevenueFact {
  item_id: string;
  client_id: string | null;
  client_name: string | null;
  client_contract_id: string | null;
  contract_id: string | null;
  contract_name: string | null;
  contract_line_id: string | null;
  contract_line_name: string | null;
  amount_cents: number | null;
  unconverted: boolean;
}

interface LaborFact {
  entry_id: string;
  work_date: string;
  work_item_type: string | null;
  work_item_id: string | null;
  client_id: string | null;
  client_name: string | null;
  ticket_number: string | null;
  ticket_title: string | null;
  contract_line_id: string | null;
  contract_line_name: string | null;
  client_contract_id: string | null;
  contract_id: string | null;
  contract_name: string | null;
  actual_minutes: number;
  billable_minutes: number;
  cost_rate: number | null;
  approval_status: string | null;
}

interface MaterialFact {
  material_type: 'ticket' | 'project';
  material_id: string;
  ticket_id: string | null;
  project_id: string | null;
  client_id: string | null;
  client_name: string | null;
  quantity: number;
  rate: number;
  material_currency_code: string | null;
  service_cost: number | null;
  billed_invoice_id: string | null;
  invoice_currency_code: string | null;
  exchange_rate_basis_points: number | null;
  revenue_cents: number | null;
  cost_cents: number | null;
  currency_mismatch: boolean;
  uncosted: boolean;
}

interface TicketRevenueFact {
  ticket_id: string;
  amount_cents: number | null;
  unconverted: boolean;
  attribution: 'exact' | 'allocated';
}

interface TicketAllocationChargeFact {
  item_detail_id: string;
  contract_line_id: string;
  line_type: string | null;
  amount_cents: number | null;
  unconverted: boolean;
  window_start: string | null;
  window_end: string | null;
  approximate: boolean;
}

type FactBundle = {
  defaultCurrency: string;
  costRatesConfigured: boolean;
  revenueFacts: RevenueFact[];
  laborFacts: LaborFact[];
  materialFacts: MaterialFact[];
  ticketRevenueFacts: TicketRevenueFact[];
};

class MetricAccumulator {
  revenue = 0;
  laborCost = 0;
  materialCost = 0;
  totalMinutes = 0;
  uncostedMinutes = 0;
  unattributedMinutes = 0;
  unapprovedMinutes = 0;
  zeroDurationEntryCount = 0;
  uncostedMaterialCount = 0;
  unconvertedRevenueCount = 0;
  materialCurrencyMismatchCount = 0;

  addRevenue(amount: number | null, unconverted: boolean) {
    if (unconverted) {
      this.unconvertedRevenueCount += 1;
      return;
    }
    this.revenue += amount ?? 0;
  }

  addLabor(fact: LaborFact, unattributed: boolean) {
    const minutes = Math.max(0, Math.round(Number(fact.actual_minutes) || 0));
    this.totalMinutes += minutes;
    if (fact.cost_rate === null || fact.cost_rate === undefined) {
      this.uncostedMinutes += minutes;
    } else {
      this.laborCost += Math.round((minutes * Number(fact.cost_rate)) / 60);
    }
    if (unattributed) {
      this.unattributedMinutes += minutes;
    }
    if (fact.approval_status !== 'APPROVED') {
      this.unapprovedMinutes += minutes;
    }
    if (minutes === 0) {
      this.zeroDurationEntryCount += 1;
    }
  }

  addMaterial(fact: MaterialFact, includeRevenue: boolean, includeCost: boolean) {
    if (fact.currency_mismatch) {
      this.materialCurrencyMismatchCount += 1;
      return;
    }
    if (includeRevenue) {
      this.revenue += fact.revenue_cents ?? 0;
    }
    if (fact.uncosted) {
      this.uncostedMaterialCount += 1;
    } else if (includeCost) {
      this.materialCost += fact.cost_cents ?? 0;
    }
  }

  toFields(): ProfitabilityMetricFields {
    const totalCost = this.laborCost + this.materialCost;
    const margin = this.revenue - totalCost;
    return {
      revenue: this.revenue,
      laborCost: this.laborCost,
      materialCost: this.materialCost,
      margin,
      marginPct: this.revenue === 0 ? null : Math.round((margin / this.revenue) * 10000) / 100,
      totalMinutes: this.totalMinutes,
      effectiveHourlyRate: this.totalMinutes === 0 ? null : Math.round((this.revenue * 60) / this.totalMinutes),
      uncostedMinutes: this.uncostedMinutes,
      unattributedMinutes: this.unattributedMinutes,
      unapprovedMinutes: this.unapprovedMinutes,
      zeroDurationEntryCount: this.zeroDurationEntryCount,
      uncostedMaterialCount: this.uncostedMaterialCount,
      unconvertedRevenueCount: this.unconvertedRevenueCount,
      materialCurrencyMismatchCount: this.materialCurrencyMismatchCount,
    };
  }
}

function requireTenant(tenant: string | null | undefined): string {
  if (!tenant) {
    throw new Error('No tenant context');
  }
  return tenant;
}

function normalizeDateInput(input: ProfitabilityDateInput): { startDate: string; endDate: string } {
  const startDate = input.startDate ?? input.start;
  const endDate = input.endDate ?? input.end;
  if (!startDate || !endDate) {
    throw new Error('startDate and endDate are required');
  }
  return { startDate, endDate };
}

async function getTenantDefaultCurrency(knex: Knex, tenant: string): Promise<string> {
  const row = await tenantDb(knex, tenant).table('default_billing_settings')
    .select('default_currency_code')
    .first();
  return row?.default_currency_code || 'USD';
}

function rawRows<T>(result: unknown): T[] {
  if (result && typeof result === 'object' && 'rows' in result && Array.isArray((result as { rows: unknown[] }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return Array.isArray(result) ? result as T[] : [];
}

async function fetchRevenueFacts(
  knex: Knex,
  tenant: string,
  startDate: string,
  endDate: string,
  defaultCurrency: string
): Promise<RevenueFact[]> {
  const result = await knex.raw(`
    WITH charge_details AS (
      SELECT
        ic.tenant,
        ic.item_id,
        ic.client_contract_id,
        inv.client_id,
        cl.client_name,
        cc.contract_id,
        c.contract_name,
        inv.currency_code,
        inv.exchange_rate_basis_points,
        CASE
          WHEN COUNT(iifd.item_detail_id) FILTER (WHERE iifd.item_detail_id IS NOT NULL) > 0
            THEN COALESCE(SUM(iifd.allocated_amount), 0)
          ELSE MAX(ic.net_amount)
        END AS amount_cents
      FROM invoice_charges ic
      JOIN invoices inv
        ON inv.tenant = ic.tenant
       AND inv.invoice_id = ic.invoice_id
      LEFT JOIN clients cl
        ON cl.tenant = inv.tenant
       AND cl.client_id = inv.client_id
      LEFT JOIN client_contracts cc
        ON cc.tenant = ic.tenant
       AND cc.client_contract_id = ic.client_contract_id
      LEFT JOIN contracts c
        ON c.tenant = cc.tenant
       AND c.contract_id = cc.contract_id
      LEFT JOIN invoice_charge_details iid
        ON iid.tenant = ic.tenant
       AND iid.item_id = ic.item_id
      LEFT JOIN invoice_charge_fixed_details iifd
        ON iifd.tenant = iid.tenant
       AND iifd.item_detail_id = iid.item_detail_id
      WHERE ic.tenant = ?
        AND inv.tenant = ?
        AND inv.status = ANY(?::text[])
        AND inv.invoice_date::date >= ?::date
        AND inv.invoice_date::date <= ?::date
      GROUP BY
        ic.tenant,
        ic.item_id,
        ic.client_contract_id,
        inv.client_id,
        cl.client_name,
        cc.contract_id,
        c.contract_name,
        inv.currency_code,
        inv.exchange_rate_basis_points
    ),
    line_candidates AS (
      SELECT DISTINCT ON (ic.item_id)
        ic.item_id,
        COALESCE(te.contract_line_id, clsc.contract_line_id) AS contract_line_id,
        cli.contract_line_name AS contract_line_name
      FROM invoice_charges ic
      LEFT JOIN invoice_charge_details iid
        ON iid.tenant = ic.tenant
       AND iid.item_id = ic.item_id
      LEFT JOIN contract_line_service_configuration clsc
        ON clsc.tenant = iid.tenant
       AND clsc.config_id = iid.config_id
      LEFT JOIN invoice_time_entries ite
        ON ite.tenant = ic.tenant
       AND ite.item_id = ic.item_id
      LEFT JOIN time_entries te
        ON te.tenant = ite.tenant
       AND te.entry_id = ite.entry_id
      LEFT JOIN contract_lines cli
        ON cli.tenant = ic.tenant
       AND cli.contract_line_id = COALESCE(te.contract_line_id, clsc.contract_line_id)
      WHERE ic.tenant = ?
      ORDER BY ic.item_id, COALESCE(te.contract_line_id, clsc.contract_line_id) NULLS LAST
    )
    SELECT
      cd.item_id,
      cd.client_id,
      cd.client_name,
      cd.client_contract_id,
      cd.contract_id,
      cd.contract_name,
      lc.contract_line_id,
      lc.contract_line_name,
      CASE
        WHEN COALESCE(cd.currency_code, ?) = ? THEN cd.amount_cents::bigint
        WHEN cd.exchange_rate_basis_points IS NULL THEN NULL
        ELSE ROUND((cd.amount_cents::numeric * cd.exchange_rate_basis_points::numeric) / 10000)::bigint
      END AS amount_cents,
      (COALESCE(cd.currency_code, ?) <> ? AND cd.exchange_rate_basis_points IS NULL) AS unconverted
    FROM charge_details cd
    LEFT JOIN line_candidates lc
      ON lc.item_id = cd.item_id
  `, [
    tenant,
    tenant,
    COUNTABLE_INVOICE_STATUSES,
    startDate,
    endDate,
    tenant,
    defaultCurrency,
    defaultCurrency,
    defaultCurrency,
    defaultCurrency,
  ]);

  return rawRows<Record<string, unknown>>(result).map((row) => ({
    item_id: String(row.item_id),
    client_id: row.client_id ? String(row.client_id) : null,
    client_name: row.client_name ? String(row.client_name) : null,
    client_contract_id: row.client_contract_id ? String(row.client_contract_id) : null,
    contract_id: row.contract_id ? String(row.contract_id) : null,
    contract_name: row.contract_name ? String(row.contract_name) : null,
    contract_line_id: row.contract_line_id ? String(row.contract_line_id) : null,
    contract_line_name: row.contract_line_name ? String(row.contract_line_name) : null,
    amount_cents: row.amount_cents === null || row.amount_cents === undefined ? null : Number(row.amount_cents),
    unconverted: Boolean(row.unconverted),
  }));
}

async function fetchLaborFacts(knex: Knex, tenant: string, startDate: string, endDate: string): Promise<LaborFact[]> {
  const result = await knex.raw(`
    SELECT
      te.entry_id,
      te.work_date::text AS work_date,
      te.work_item_type,
      te.work_item_id,
      CASE
        WHEN te.work_item_type = 'ticket' THEN t.client_id
        WHEN te.work_item_type = 'project_task' THEN p.client_id
        WHEN te.work_item_type = 'interaction' THEN i.client_id
        WHEN te.work_item_type = 'appointment_request' THEN ar.client_id
        ELSE NULL
      END AS client_id,
      cl.client_name,
      t.ticket_number::text AS ticket_number,
      t.title AS ticket_title,
      te.contract_line_id,
      cli.contract_line_name AS contract_line_name,
      cc.client_contract_id,
      c.contract_id,
      c.contract_name,
      GREATEST(0, EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 60) AS actual_minutes,
      COALESCE(te.billable_duration, 0) AS billable_minutes,
      rate.cost_rate,
      te.approval_status
    FROM time_entries te
    LEFT JOIN tickets t
      ON t.tenant = te.tenant
     AND te.work_item_type = 'ticket'
     AND t.ticket_id = te.work_item_id
    LEFT JOIN project_tasks pt
      ON pt.tenant = te.tenant
     AND te.work_item_type = 'project_task'
     AND pt.task_id = te.work_item_id
    LEFT JOIN project_phases pp
      ON pp.tenant = pt.tenant
     AND pp.phase_id = pt.phase_id
    LEFT JOIN projects p
      ON p.tenant = pp.tenant
     AND p.project_id = pp.project_id
    LEFT JOIN interactions i
      ON i.tenant = te.tenant
     AND te.work_item_type = 'interaction'
     AND i.interaction_id = te.work_item_id
    LEFT JOIN appointment_requests ar
      ON ar.tenant = te.tenant
     AND te.work_item_type = 'appointment_request'
     AND ar.appointment_request_id = te.work_item_id
    LEFT JOIN clients cl
      ON cl.tenant = te.tenant
     AND cl.client_id = CASE
        WHEN te.work_item_type = 'ticket' THEN t.client_id
        WHEN te.work_item_type = 'project_task' THEN p.client_id
        WHEN te.work_item_type = 'interaction' THEN i.client_id
        WHEN te.work_item_type = 'appointment_request' THEN ar.client_id
        ELSE NULL
      END
    LEFT JOIN contract_lines cli
      ON cli.tenant = te.tenant
     AND cli.contract_line_id = te.contract_line_id
    LEFT JOIN contracts c
      ON c.tenant = cli.tenant
     AND c.contract_id = cli.contract_id
    LEFT JOIN LATERAL (
      SELECT cc_inner.client_contract_id
      FROM client_contracts cc_inner
      WHERE cc_inner.tenant = te.tenant
        AND cc_inner.contract_id = c.contract_id
        AND cc_inner.start_date <= te.work_date
        AND (cc_inner.end_date IS NULL OR cc_inner.end_date >= te.work_date)
      ORDER BY cc_inner.start_date DESC, cc_inner.client_contract_id
      LIMIT 1
    ) cc ON true
    LEFT JOIN LATERAL (
      SELECT ucr.cost_rate
      FROM user_cost_rates ucr
      WHERE ucr.tenant = te.tenant
        AND (ucr.user_id = te.user_id OR ucr.user_id IS NULL)
        AND ucr.effective_from <= te.work_date
        AND (ucr.effective_to IS NULL OR ucr.effective_to >= te.work_date)
      ORDER BY ucr.user_id IS NULL, ucr.effective_from DESC, ucr.rate_id
      LIMIT 1
    ) rate ON true
    WHERE te.tenant = ?
      AND te.work_date >= ?::date
      AND te.work_date <= ?::date
  `, [tenant, startDate, endDate]);

  return rawRows<Record<string, unknown>>(result).map((row) => ({
    entry_id: String(row.entry_id),
    work_date: String(row.work_date),
    work_item_type: row.work_item_type ? String(row.work_item_type) : null,
    work_item_id: row.work_item_id ? String(row.work_item_id) : null,
    client_id: row.client_id ? String(row.client_id) : null,
    client_name: row.client_name ? String(row.client_name) : null,
    ticket_number: row.ticket_number ? String(row.ticket_number) : null,
    ticket_title: row.ticket_title ? String(row.ticket_title) : null,
    contract_line_id: row.contract_line_id ? String(row.contract_line_id) : null,
    contract_line_name: row.contract_line_name ? String(row.contract_line_name) : null,
    client_contract_id: row.client_contract_id ? String(row.client_contract_id) : null,
    contract_id: row.contract_id ? String(row.contract_id) : null,
    contract_name: row.contract_name ? String(row.contract_name) : null,
    actual_minutes: Number(row.actual_minutes ?? 0),
    billable_minutes: Number(row.billable_minutes ?? 0),
    cost_rate: row.cost_rate === null || row.cost_rate === undefined ? null : Number(row.cost_rate),
    approval_status: row.approval_status ? String(row.approval_status) : null,
  }));
}

async function fetchMaterialFacts(
  knex: Knex,
  tenant: string,
  startDate: string,
  endDate: string,
  defaultCurrency: string
): Promise<MaterialFact[]> {
  const result = await knex.raw(`
    WITH material_rows AS (
      SELECT
        'ticket'::text AS material_type,
        tm.ticket_material_id AS material_id,
        tm.ticket_id,
        NULL::uuid AS project_id,
        tm.client_id,
        tm.service_id,
        tm.quantity,
        tm.rate,
        tm.currency_code,
        tm.billed_invoice_id,
        tm.created_at
      FROM ticket_materials tm
      WHERE tm.tenant = ?
      UNION ALL
      SELECT
        'project'::text AS material_type,
        pm.project_material_id AS material_id,
        NULL::uuid AS ticket_id,
        pm.project_id,
        pm.client_id,
        pm.service_id,
        pm.quantity,
        pm.rate,
        pm.currency_code,
        pm.billed_invoice_id,
        pm.created_at
      FROM project_materials pm
      WHERE pm.tenant = ?
    )
    SELECT
      mr.material_type,
      mr.material_id,
      mr.ticket_id,
      mr.project_id,
      mr.client_id,
      cl.client_name,
      mr.quantity,
      mr.rate,
      mr.currency_code AS material_currency_code,
      sc.cost AS service_cost,
      mr.billed_invoice_id,
      inv.currency_code AS invoice_currency_code,
      inv.exchange_rate_basis_points,
      CASE
        WHEN mr.billed_invoice_id IS NULL THEN NULL
        WHEN COALESCE(inv.currency_code, ?) = ? THEN (mr.quantity * mr.rate)::bigint
        WHEN inv.exchange_rate_basis_points IS NULL THEN NULL
        ELSE ROUND(((mr.quantity * mr.rate)::numeric * inv.exchange_rate_basis_points::numeric) / 10000)::bigint
      END AS revenue_cents,
      CASE
        WHEN sc.cost IS NULL THEN NULL
        ELSE (mr.quantity * sc.cost)::bigint
      END AS cost_cents,
      (COALESCE(mr.currency_code, ?) <> ?) AS currency_mismatch,
      (sc.cost IS NULL) AS uncosted
    FROM material_rows mr
    JOIN clients cl
      ON cl.tenant = ?
     AND cl.client_id = mr.client_id
    LEFT JOIN service_catalog sc
      ON sc.tenant = ?
     AND sc.service_id = mr.service_id
    LEFT JOIN invoices inv
      ON inv.tenant = ?
     AND inv.invoice_id = mr.billed_invoice_id
    WHERE (
        mr.billed_invoice_id IS NOT NULL
        AND inv.status = ANY(?::text[])
        AND inv.invoice_date::date >= ?::date
        AND inv.invoice_date::date <= ?::date
      )
      OR (
        mr.billed_invoice_id IS NULL
        AND (mr.created_at AT TIME ZONE 'UTC')::date >= ?::date
        AND (mr.created_at AT TIME ZONE 'UTC')::date <= ?::date
      )
  `, [
    tenant,
    tenant,
    defaultCurrency,
    defaultCurrency,
    defaultCurrency,
    defaultCurrency,
    tenant,
    tenant,
    tenant,
    COUNTABLE_INVOICE_STATUSES,
    startDate,
    endDate,
    startDate,
    endDate,
  ]);

  return rawRows<Record<string, unknown>>(result).map((row) => ({
    material_type: row.material_type === 'project' ? 'project' : 'ticket',
    material_id: String(row.material_id),
    ticket_id: row.ticket_id ? String(row.ticket_id) : null,
    project_id: row.project_id ? String(row.project_id) : null,
    client_id: row.client_id ? String(row.client_id) : null,
    client_name: row.client_name ? String(row.client_name) : null,
    quantity: Number(row.quantity ?? 0),
    rate: Number(row.rate ?? 0),
    material_currency_code: row.material_currency_code ? String(row.material_currency_code) : null,
    service_cost: row.service_cost === null || row.service_cost === undefined ? null : Number(row.service_cost),
    billed_invoice_id: row.billed_invoice_id ? String(row.billed_invoice_id) : null,
    invoice_currency_code: row.invoice_currency_code ? String(row.invoice_currency_code) : null,
    exchange_rate_basis_points: row.exchange_rate_basis_points === null || row.exchange_rate_basis_points === undefined ? null : Number(row.exchange_rate_basis_points),
    revenue_cents: row.revenue_cents === null || row.revenue_cents === undefined ? null : Number(row.revenue_cents),
    cost_cents: row.cost_cents === null || row.cost_cents === undefined ? null : Number(row.cost_cents),
    currency_mismatch: Boolean(row.currency_mismatch),
    uncosted: Boolean(row.uncosted),
  }));
}

async function fetchTicketRevenueFacts(
  knex: Knex,
  tenant: string,
  startDate: string,
  endDate: string,
  defaultCurrency: string
): Promise<TicketRevenueFact[]> {
  const result = await knex.raw(`
    WITH linked_time AS (
      SELECT
        ic.item_id,
        t.ticket_id,
        COALESCE(te.billable_duration, 0) AS billable_minutes,
        SUM(COALESCE(te.billable_duration, 0)) OVER (PARTITION BY ic.item_id) AS item_billable_minutes,
        COUNT(*) OVER (PARTITION BY ic.item_id) AS item_link_count,
        CASE
          WHEN COALESCE(inv.currency_code, ?) = ? THEN ic.net_amount::bigint
          WHEN inv.exchange_rate_basis_points IS NULL THEN NULL
          ELSE ROUND((ic.net_amount::numeric * inv.exchange_rate_basis_points::numeric) / 10000)::bigint
        END AS item_amount_cents,
        (COALESCE(inv.currency_code, ?) <> ? AND inv.exchange_rate_basis_points IS NULL) AS unconverted
      FROM invoice_time_entries ite
      JOIN invoice_charges ic
        ON ic.tenant = ite.tenant
       AND ic.item_id = ite.item_id
      JOIN invoices inv
        ON inv.tenant = ic.tenant
       AND inv.invoice_id = ic.invoice_id
      JOIN time_entries te
        ON te.tenant = ite.tenant
       AND te.entry_id = ite.entry_id
      JOIN tickets t
        ON t.tenant = te.tenant
       AND te.work_item_type = 'ticket'
       AND t.ticket_id = te.work_item_id
      WHERE ite.tenant = ?
        AND ite.item_id IS NOT NULL
        AND inv.status = ANY(?::text[])
        AND inv.invoice_date::date >= ?::date
        AND inv.invoice_date::date <= ?::date
    )
    SELECT
      ticket_id,
      CASE
        WHEN unconverted THEN NULL
        WHEN item_billable_minutes > 0
          THEN ROUND((item_amount_cents::numeric * billable_minutes::numeric) / item_billable_minutes)::bigint
        ELSE ROUND(item_amount_cents::numeric / NULLIF(item_link_count, 0))::bigint
      END AS amount_cents,
      unconverted
    FROM linked_time
  `, [
    defaultCurrency,
    defaultCurrency,
    defaultCurrency,
    defaultCurrency,
    tenant,
    COUNTABLE_INVOICE_STATUSES,
    startDate,
    endDate,
  ]);

  return rawRows<Record<string, unknown>>(result).map((row) => ({
    ticket_id: String(row.ticket_id),
    amount_cents: row.amount_cents === null || row.amount_cents === undefined ? null : Number(row.amount_cents),
    unconverted: Boolean(row.unconverted),
    attribution: 'exact',
  }));
}

async function fetchTicketAllocationChargeFacts(
  knex: Knex,
  tenant: string,
  startDate: string,
  endDate: string,
  defaultCurrency: string
): Promise<TicketAllocationChargeFact[]> {
  const result = await knex.raw(`
    WITH allocation_charges AS (
      SELECT
        iid.item_detail_id,
        clsc.contract_line_id,
        cl.contract_line_type,
        COALESCE(iid.service_period_start::date, inv.billing_period_start::date) AS window_start,
        COALESCE(iid.service_period_end::date, inv.billing_period_end::date) AS window_end,
        (iid.service_period_start IS NULL OR iid.service_period_end IS NULL) AS approximate,
        COALESCE(iifd.allocated_amount, ic.net_amount) AS amount_cents,
        inv.currency_code,
        inv.exchange_rate_basis_points
      FROM invoice_charges ic
      JOIN invoices inv
        ON inv.tenant = ic.tenant
       AND inv.invoice_id = ic.invoice_id
      JOIN invoice_charge_details iid
        ON iid.tenant = ic.tenant
       AND iid.item_id = ic.item_id
      JOIN contract_line_service_configuration clsc
        ON clsc.tenant = iid.tenant
       AND clsc.config_id = iid.config_id
      JOIN contract_lines cl
        ON cl.tenant = clsc.tenant
       AND cl.contract_line_id = clsc.contract_line_id
      LEFT JOIN invoice_charge_fixed_details iifd
        ON iifd.tenant = iid.tenant
       AND iifd.item_detail_id = iid.item_detail_id
      WHERE ic.tenant = ?
        AND inv.status = ANY(?::text[])
        AND inv.invoice_date::date >= ?::date
        AND inv.invoice_date::date <= ?::date
        AND LOWER(COALESCE(cl.contract_line_type, '')) IN ('fixed', 'bucket')
        AND COALESCE(iid.service_period_start::date, inv.billing_period_start::date) IS NOT NULL
        AND COALESCE(iid.service_period_end::date, inv.billing_period_end::date) IS NOT NULL
    )
    SELECT
      item_detail_id,
      contract_line_id,
      contract_line_type AS line_type,
      window_start::text,
      window_end::text,
      approximate,
      CASE
        WHEN COALESCE(currency_code, ?) = ? THEN amount_cents::bigint
        WHEN exchange_rate_basis_points IS NULL THEN NULL
        ELSE ROUND((amount_cents::numeric * exchange_rate_basis_points::numeric) / 10000)::bigint
      END AS amount_cents,
      (COALESCE(currency_code, ?) <> ? AND exchange_rate_basis_points IS NULL) AS unconverted
    FROM allocation_charges
  `, [
    tenant,
    COUNTABLE_INVOICE_STATUSES,
    startDate,
    endDate,
    defaultCurrency,
    defaultCurrency,
    defaultCurrency,
    defaultCurrency,
  ]);

  return rawRows<Record<string, unknown>>(result).map((row) => ({
    item_detail_id: String(row.item_detail_id),
    contract_line_id: String(row.contract_line_id),
    line_type: row.line_type ? String(row.line_type) : null,
    amount_cents: row.amount_cents === null || row.amount_cents === undefined ? null : Number(row.amount_cents),
    unconverted: Boolean(row.unconverted),
    window_start: row.window_start ? String(row.window_start) : null,
    window_end: row.window_end ? String(row.window_end) : null,
    approximate: Boolean(row.approximate),
  }));
}

function allocateCents(amount: number, weightedTickets: Array<{ ticketId: string; minutes: number }>): TicketRevenueFact[] {
  const totalMinutes = weightedTickets.reduce((sum, row) => sum + row.minutes, 0);
  if (totalMinutes <= 0 || amount === 0) {
    return [];
  }

  const sign = amount < 0 ? -1 : 1;
  const absoluteAmount = Math.abs(amount);
  const allocations = weightedTickets.map((row) => {
    const numerator = absoluteAmount * row.minutes;
    const floor = Math.floor(numerator / totalMinutes);
    return {
      ticketId: row.ticketId,
      floor,
      remainder: numerator - floor * totalMinutes,
    };
  });

  let remaining = absoluteAmount - allocations.reduce((sum, row) => sum + row.floor, 0);
  allocations.sort((left, right) => right.remainder - left.remainder || left.ticketId.localeCompare(right.ticketId));
  for (const allocation of allocations) {
    if (remaining <= 0) break;
    allocation.floor += 1;
    remaining -= 1;
  }

  return allocations
    .filter((allocation) => allocation.floor !== 0)
    .map((allocation) => ({
      ticket_id: allocation.ticketId,
      amount_cents: allocation.floor * sign,
      unconverted: false,
      attribution: 'allocated',
    }));
}

function buildAllocatedTicketRevenue(
  allocationCharges: TicketAllocationChargeFact[],
  laborFacts: LaborFact[]
): TicketRevenueFact[] {
  const ticketLabor = laborFacts.filter((fact) => (
    fact.work_item_type === 'ticket'
    && fact.work_item_id
    && fact.contract_line_id
    && Math.max(0, Number(fact.actual_minutes) || 0) > 0
  ));
  const allocated: TicketRevenueFact[] = [];

  for (const charge of allocationCharges) {
    if (charge.unconverted || charge.amount_cents === null || !charge.window_start || !charge.window_end) {
      continue;
    }

    const weightsByTicket = new Map<string, number>();
    for (const fact of ticketLabor) {
      if (fact.contract_line_id !== charge.contract_line_id) continue;
      if (fact.work_date < charge.window_start || fact.work_date > charge.window_end) continue;
      weightsByTicket.set(fact.work_item_id!, (weightsByTicket.get(fact.work_item_id!) ?? 0) + Math.max(0, Number(fact.actual_minutes) || 0));
    }

    allocated.push(...allocateCents(
      charge.amount_cents,
      Array.from(weightsByTicket.entries()).map(([ticketId, minutes]) => ({ ticketId, minutes }))
    ));
  }

  return allocated;
}

async function fetchFacts(knex: Knex, tenant: string, startDate: string, endDate: string): Promise<FactBundle> {
  const defaultCurrency = await getTenantDefaultCurrency(knex, tenant);
  const costRateCount = await tenantDb(knex, tenant).table('user_cost_rates').count<{ count: string }[]>({ count: '*' }).first();
  const [revenueFacts, laborFacts, materialFacts, exactTicketRevenueFacts, allocationChargeFacts] = await Promise.all([
    fetchRevenueFacts(knex, tenant, startDate, endDate, defaultCurrency),
    fetchLaborFacts(knex, tenant, startDate, endDate),
    fetchMaterialFacts(knex, tenant, startDate, endDate, defaultCurrency),
    fetchTicketRevenueFacts(knex, tenant, startDate, endDate, defaultCurrency),
    fetchTicketAllocationChargeFacts(knex, tenant, startDate, endDate, defaultCurrency),
  ]);
  const ticketRevenueFacts = [
    ...exactTicketRevenueFacts,
    ...buildAllocatedTicketRevenue(allocationChargeFacts, laborFacts),
  ];

  return {
    defaultCurrency,
    costRatesConfigured: Number(costRateCount?.count ?? 0) > 0,
    revenueFacts,
    laborFacts,
    materialFacts,
    ticketRevenueFacts,
  };
}

function clientKey(clientId: string | null) {
  return clientId ?? '__no_client__';
}

function clientName(clientId: string | null, name: string | null | undefined) {
  return clientId ? (name || 'Unknown Client') : 'No client';
}

function laborIsUnattributed(fact: LaborFact) {
  return !fact.contract_line_id || !fact.client_contract_id;
}

function applyAllFactsToAccumulator(acc: MetricAccumulator, facts: FactBundle) {
  for (const fact of facts.revenueFacts) {
    acc.addRevenue(fact.amount_cents, fact.unconverted);
  }
  for (const fact of facts.laborFacts) {
    acc.addLabor(fact, laborIsUnattributed(fact));
  }
  for (const fact of facts.materialFacts) {
    acc.addMaterial(fact, true, true);
  }
}

async function getFactBundleForAction(user: Parameters<typeof hasPermission>[0], tenant: string | null | undefined, input: ProfitabilityDateInput) {
  if (!await hasPermission(user, 'billing', 'read')) {
    throw new Error('Permission denied: billing read required');
  }
  const tenantId = requireTenant(tenant);
  const { startDate, endDate } = normalizeDateInput(input);
  const { knex } = await createTenantKnex();
  return fetchFacts(knex, tenantId, startDate, endDate);
}

export const getProfitabilitySummary = withAuth(async (
  user,
  { tenant },
  input: ProfitabilityDateInput
): Promise<ProfitabilitySummary> => {
  const facts = await getFactBundleForAction(user, tenant, input);
  const acc = new MetricAccumulator();
  applyAllFactsToAccumulator(acc, facts);
  return {
    ...acc.toFields(),
    costRatesConfigured: facts.costRatesConfigured,
  };
});

export const getClientProfitability = withAuth(async (
  user,
  { tenant },
  input: ProfitabilityDateInput
): Promise<ClientProfitabilityRow[]> => {
  const facts = await getFactBundleForAction(user, tenant, input);
  const rows = new Map<string, { clientId: string | null; clientName: string; acc: MetricAccumulator }>();

  const getRow = (id: string | null, name: string | null | undefined) => {
    const key = clientKey(id);
    if (!rows.has(key)) {
      rows.set(key, { clientId: id, clientName: clientName(id, name), acc: new MetricAccumulator() });
    }
    return rows.get(key)!;
  };

  for (const fact of facts.revenueFacts) {
    getRow(fact.client_id, fact.client_name).acc.addRevenue(fact.amount_cents, fact.unconverted);
  }
  for (const fact of facts.laborFacts) {
    getRow(fact.client_id, fact.client_name).acc.addLabor(fact, laborIsUnattributed(fact));
  }
  for (const fact of facts.materialFacts) {
    getRow(fact.client_id, fact.client_name).acc.addMaterial(fact, true, true);
  }

  return Array.from(rows.values()).map((row) => ({
    clientId: row.clientId,
    clientName: row.clientName,
    ...row.acc.toFields(),
  }));
});

type AgreementBucket = {
  clientId: string | null;
  clientName: string;
  clientContractId: string | null;
  contractId: string | null;
  contractName: string;
  rowType: AgreementProfitabilityRow['rowType'];
  acc: MetricAccumulator;
  lines: Map<string, { contractLineId: string | null; contractLineName: string; rowType: ContractLineProfitabilityRow['rowType']; acc: MetricAccumulator }>;
};

function agreementKey(clientId: string | null, rowType: AgreementProfitabilityRow['rowType'], clientContractId: string | null) {
  return `${clientKey(clientId)}:${rowType}:${clientContractId ?? rowType}`;
}

function lineKey(contractLineId: string | null) {
  return contractLineId ?? '__unassigned__';
}

function getLine(bucket: AgreementBucket, contractLineId: string | null, contractLineName: string | null | undefined) {
  const key = lineKey(contractLineId);
  if (!bucket.lines.has(key)) {
    bucket.lines.set(key, {
      contractLineId,
      contractLineName: contractLineId ? (contractLineName || 'Unnamed line') : 'Unassigned to line',
      rowType: contractLineId ? 'contract_line' : 'unassigned',
      acc: new MetricAccumulator(),
    });
  }
  return bucket.lines.get(key)!;
}

export const getAgreementProfitability = withAuth(async (
  user,
  { tenant },
  input: ProfitabilityDateInput & { clientId?: string | null }
): Promise<AgreementProfitabilityRow[]> => {
  const facts = await getFactBundleForAction(user, tenant, input);
  const buckets = new Map<string, AgreementBucket>();

  const getBucket = (
    clientIdValue: string | null,
    clientNameValue: string | null | undefined,
    rowType: AgreementProfitabilityRow['rowType'],
    clientContractId: string | null,
    contractId: string | null,
    contractNameValue: string | null | undefined
  ) => {
    const key = agreementKey(clientIdValue, rowType, clientContractId);
    if (!buckets.has(key)) {
      buckets.set(key, {
        clientId: clientIdValue,
        clientName: clientName(clientIdValue, clientNameValue),
        clientContractId,
        contractId,
        contractName: rowType === 'ad_hoc'
          ? 'Ad-hoc / manual'
          : rowType === 'unattributed'
            ? 'Unattributed'
            : (contractNameValue || 'Unknown agreement'),
        rowType,
        acc: new MetricAccumulator(),
        lines: new Map(),
      });
    }
    return buckets.get(key)!;
  };

  const includeClient = (clientIdValue: string | null) => !input.clientId || clientIdValue === input.clientId;

  for (const fact of facts.revenueFacts) {
    if (!includeClient(fact.client_id)) continue;
    const rowType = fact.client_contract_id ? 'agreement' : 'ad_hoc';
    const bucket = getBucket(fact.client_id, fact.client_name, rowType, fact.client_contract_id, fact.contract_id, fact.contract_name);
    bucket.acc.addRevenue(fact.amount_cents, fact.unconverted);
    getLine(bucket, fact.contract_line_id, fact.contract_line_name).acc.addRevenue(fact.amount_cents, fact.unconverted);
  }

  for (const fact of facts.laborFacts) {
    if (!includeClient(fact.client_id)) continue;
    const rowType = laborIsUnattributed(fact) ? 'unattributed' : 'agreement';
    const bucket = getBucket(
      fact.client_id,
      fact.client_name,
      rowType,
      rowType === 'agreement' ? fact.client_contract_id : null,
      rowType === 'agreement' ? fact.contract_id : null,
      rowType === 'agreement' ? fact.contract_name : null
    );
    bucket.acc.addLabor(fact, laborIsUnattributed(fact));
    getLine(bucket, rowType === 'agreement' ? fact.contract_line_id : null, fact.contract_line_name).acc.addLabor(fact, laborIsUnattributed(fact));
  }

  for (const fact of facts.materialFacts) {
    if (!includeClient(fact.client_id)) continue;
    if (fact.billed_invoice_id) {
      getBucket(fact.client_id, fact.client_name, 'ad_hoc', null, null, null).acc.addMaterial(fact, true, false);
    }
    getBucket(fact.client_id, fact.client_name, 'unattributed', null, null, null).acc.addMaterial(fact, false, true);
  }

  return Array.from(buckets.values()).map((bucket) => ({
    clientId: bucket.clientId,
    clientName: bucket.clientName,
    clientContractId: bucket.clientContractId,
    contractId: bucket.contractId,
    contractName: bucket.contractName,
    rowType: bucket.rowType,
    ...bucket.acc.toFields(),
    lines: Array.from(bucket.lines.values()).map((line) => ({
      contractLineId: line.contractLineId,
      contractLineName: line.contractLineName,
      rowType: line.rowType,
      ...line.acc.toFields(),
    })),
  }));
});

export const getTicketProfitability = withAuth(async (
  user,
  { tenant },
  input: ProfitabilityDateInput & { clientId?: string | null; clientContractId?: string | null }
): Promise<TicketProfitabilityRow[]> => {
  const facts = await getFactBundleForAction(user, tenant, input);
  const rows = new Map<string, {
    ticketId: string;
    ticketNumber: string | null;
    title: string | null;
    clientId: string | null;
    clientName: string;
    clientContractId: string | null;
    billableMinutes: number;
    attribution: TicketProfitabilityRow['attribution'];
    acc: MetricAccumulator;
  }>();

  const getTicket = (fact: LaborFact) => {
    const ticketId = fact.work_item_id!;
    if (!rows.has(ticketId)) {
      rows.set(ticketId, {
        ticketId,
        ticketNumber: fact.ticket_number,
        title: fact.ticket_title,
        clientId: fact.client_id,
        clientName: clientName(fact.client_id, fact.client_name),
        clientContractId: fact.client_contract_id,
        billableMinutes: 0,
        attribution: 'none',
        acc: new MetricAccumulator(),
      });
    }
    return rows.get(ticketId)!;
  };

  for (const fact of facts.laborFacts) {
    if (fact.work_item_type !== 'ticket' || !fact.work_item_id) continue;
    if (input.clientId && fact.client_id !== input.clientId) continue;
    if (input.clientContractId && fact.client_contract_id !== input.clientContractId) continue;
    const row = getTicket(fact);
    row.acc.addLabor(fact, laborIsUnattributed(fact));
    row.billableMinutes += Number(fact.billable_minutes) || 0;
  }

  for (const fact of facts.materialFacts) {
    if (fact.material_type !== 'ticket' || !fact.ticket_id) continue;
    const row = rows.get(fact.ticket_id);
    if (!row) continue;
    row.acc.addMaterial(fact, true, true);
  }

  for (const fact of facts.ticketRevenueFacts) {
    const row = rows.get(fact.ticket_id);
    if (!row) continue;
    row.acc.addRevenue(fact.amount_cents, fact.unconverted);
    if (!fact.unconverted) {
      row.attribution = fact.attribution;
    }
  }

  return Array.from(rows.values()).map((row) => {
    const fields = row.acc.toFields();
    return {
      ticketId: row.ticketId,
      ticketNumber: row.ticketNumber,
      title: row.title,
      clientId: row.clientId,
      clientName: row.clientName,
      clientContractId: row.clientContractId,
      attribution: row.attribution,
      billableMinutes: row.billableMinutes,
      uncosted: fields.uncostedMinutes > 0 || fields.uncostedMaterialCount > 0,
      ...fields,
    };
  });
});
