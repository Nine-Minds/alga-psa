// Contract Profitability Report Definition
// Basic profit margins and revenue vs. cost analysis by contract

import { ReportDefinition } from '../../core/types';

const ELIGIBLE_INVOICE_FILTER = `
  inv.tenant = {{tenant}}
  AND inv.invoice_date >= {{start_of_year}}
  AND inv.invoice_date < {{end_of_year}}
  AND inv.status IN ('paid', 'completed', 'sent', 'open', 'overdue')
`;

const HARDWARE_COGS_SOURCE_SQL = `
  SELECT DISTINCT
    sm.tenant,
    sm.movement_id,
    COALESCE(sm.cogs_cost, 0) AS cogs_cost
  FROM invoices AS inv
  JOIN invoice_charges AS ic
    ON ic.invoice_id = inv.invoice_id
   AND ic.tenant = inv.tenant
  JOIN sales_order_lines AS sol
    ON sol.so_line_id = ic.so_line_id
   AND sol.tenant = ic.tenant
  JOIN stock_movements AS sm
    ON sm.tenant = inv.tenant
   AND sm.movement_type = 'consume'
   AND sm.source_doc_type = 'sales_order'
   AND sm.source_doc_id = sol.so_id
   AND sm.service_id = sol.service_id
  WHERE ${ELIGIBLE_INVOICE_FILTER}
    AND ic.so_line_id IS NOT NULL

  UNION

  SELECT DISTINCT
    sm.tenant,
    sm.movement_id,
    COALESCE(sm.cogs_cost, 0) AS cogs_cost
  FROM invoices AS inv
  JOIN ticket_materials AS tm
    ON tm.billed_invoice_id = inv.invoice_id
   AND tm.tenant = inv.tenant
  JOIN stock_movements AS sm
    ON sm.tenant = tm.tenant
   AND sm.movement_type = 'consume'
   AND sm.source_doc_type = 'ticket_material'
   AND sm.source_doc_id = tm.ticket_material_id
  WHERE ${ELIGIBLE_INVOICE_FILTER}

  UNION

  SELECT DISTINCT
    sm.tenant,
    sm.movement_id,
    COALESCE(sm.cogs_cost, 0) AS cogs_cost
  FROM invoices AS inv
  JOIN project_materials AS pm
    ON pm.billed_invoice_id = inv.invoice_id
   AND pm.tenant = inv.tenant
  JOIN stock_movements AS sm
    ON sm.tenant = pm.tenant
   AND sm.movement_type = 'consume'
   AND sm.source_doc_type = 'project_material'
   AND sm.source_doc_id = pm.project_material_id
  WHERE ${ELIGIBLE_INVOICE_FILTER}
`;

const HARDWARE_COGS_SUM_SQL = `
  SELECT COALESCE(SUM(hardware_cogs.cogs_cost), 0)
  FROM (
    ${HARDWARE_COGS_SOURCE_SQL}
  ) AS hardware_cogs
`;

const REVENUE_SUM_SQL = `
  SELECT COALESCE(SUM(inv.total_amount), 0)
  FROM invoices AS inv
  WHERE ${ELIGIBLE_INVOICE_FILTER}
`;

const LABOR_COST_SUM_SQL = `
  SELECT COALESCE(SUM(te.billable_duration * 833.33), 0)
  FROM time_entries AS te
  WHERE te.tenant = {{tenant}}
    AND te.start_time >= {{start_of_year}}
    AND te.start_time < {{end_of_year}}
`;

export const contractProfitabilityReport: ReportDefinition = {
  id: 'contracts.profitability',
  name: 'Contract Profitability Report',
  description: 'Basic profit margins and revenue vs. cost analysis by contract',
  category: 'billing',
  version: '1.0.0',

  permissions: {
    roles: ['admin', 'billing_manager', 'financial_analyst'],
    resources: ['billing.read', 'contracts.read', 'financial.read']
  },

  metrics: [
    {
      id: 'ytd_total_revenue',
      name: 'Year-to-Date Revenue',
      description: 'Total revenue from invoices year-to-date',
      type: 'sum',
      query: {
        table: 'invoices',
        fields: ['total_amount'],
        aggregation: 'sum',
        filters: [
          { field: 'tenant', operator: 'eq', value: '{{tenant}}' },
          { field: 'invoice_date', operator: 'gte', value: '{{start_of_year}}' },
          { field: 'invoice_date', operator: 'lt', value: '{{end_of_year}}' },
          { field: 'status', operator: 'in', value: ['paid', 'completed', 'sent', 'open', 'overdue'] }
        ]
      },
      formatting: {
        type: 'currency',
        currency: 'USD',
        divisor: 100
      }
    },

    {
      id: 'ytd_total_labor_cost',
      name: 'Year-to-Date Labor Cost',
      description: 'Estimated labor cost from billable time entries (using standard hourly rate)',
      type: 'sum',
      query: {
        table: 'time_entries',
        joins: [
          {
            type: 'left',
            table: 'users',
            on: [
              { left: 'time_entries.user_id', right: 'users.user_id' },
              { left: 'time_entries.tenant', right: 'users.tenant' }
            ]
          }
        ],
        fields: [
          'COALESCE(time_entries.billable_duration * 833.33, 0)' // $50/hr = 5000 cents/hr = 833.33 cents/min * billable_duration in minutes
        ],
        aggregation: 'sum',
        filters: [
          { field: 'time_entries.tenant', operator: 'eq', value: '{{tenant}}' },
          { field: 'time_entries.start_time', operator: 'gte', value: '{{start_of_year}}' },
          { field: 'time_entries.start_time', operator: 'lt', value: '{{end_of_year}}' }
        ]
      },
      formatting: {
        type: 'currency',
        currency: 'USD',
        divisor: 100
      }
    },

    {
      id: 'ytd_total_hardware_cogs',
      name: 'Year-to-Date Hardware COGS',
      description: 'Hardware cost from inventory consume movements attached to exported invoice lines and billed materials',
      type: 'sum',
      query: {
        table: 'raw_sql',
        fields: [`
          SELECT (${HARDWARE_COGS_SUM_SQL}) AS sum
        `],
        aggregation: 'sum',
        filters: []
      },
      formatting: {
        type: 'currency',
        currency: 'USD',
        divisor: 100
      }
    },

    {
      id: 'ytd_gross_profit',
      name: 'Year-to-Date Gross Profit',
      description: 'Revenue minus labor cost and hardware COGS',
      type: 'sum',
      query: {
        table: 'raw_sql',
        fields: [`
          SELECT (
            (${REVENUE_SUM_SQL})
            - (${LABOR_COST_SUM_SQL})
            - (${HARDWARE_COGS_SUM_SQL})
          ) AS sum
        `],
        aggregation: 'sum',
        filters: []
      },
      formatting: {
        type: 'currency',
        currency: 'USD',
        divisor: 100
      }
    },

    {
      id: 'ytd_gross_margin_percentage',
      name: 'Year-to-Date Gross Margin %',
      description: 'Gross profit as a percentage of revenue',
      type: 'ratio',
      query: {
        table: 'raw_sql',
        fields: [`
          SELECT
            (
              (
                (${REVENUE_SUM_SQL})
                - (${LABOR_COST_SUM_SQL})
                - (${HARDWARE_COGS_SUM_SQL})
              ) / NULLIF((${REVENUE_SUM_SQL}), 0)
            ) AS sum
        `],
        aggregation: 'sum',
        filters: []
      },
      formatting: {
        type: 'percentage',
        decimals: 1
      }
    },

    {
      id: 'average_contract_margin',
      name: 'Average Contract Margin',
      description: 'Average profit margin across all contracts',
      type: 'average',
      query: {
        table: 'raw_sql',
        fields: [`
          SELECT AVG(contract_profit.margin_ratio) AS avg
          FROM (
            SELECT
              revenue.client_contract_id,
              (
                revenue.revenue_cents
                - COALESCE(labor.labor_cost_cents, 0)
                - COALESCE(hardware.hardware_cogs_cents, 0)
              ) / NULLIF(revenue.revenue_cents, 0) AS margin_ratio
            FROM (
              SELECT
                cc.tenant,
                cc.client_contract_id,
                cc.contract_id,
                COALESCE(SUM(inv.total_amount), 0) AS revenue_cents
              FROM client_contracts AS cc
              JOIN invoices AS inv
                ON inv.tenant = cc.tenant
               AND inv.client_contract_id = cc.client_contract_id
              WHERE cc.tenant = {{tenant}}
                AND inv.invoice_date >= {{start_of_year}}
                AND inv.invoice_date < {{end_of_year}}
                AND inv.status IN ('paid', 'completed', 'sent', 'open', 'overdue')
              GROUP BY cc.tenant, cc.client_contract_id, cc.contract_id
            ) AS revenue
            LEFT JOIN (
              SELECT
                cc.tenant,
                cc.client_contract_id,
                COALESCE(SUM(te.billable_duration * 833.33), 0) AS labor_cost_cents
              FROM client_contracts AS cc
              JOIN contract_lines AS cl
                ON cl.tenant = cc.tenant
               AND cl.contract_id = cc.contract_id
              JOIN time_entries AS te
                ON te.tenant = cl.tenant
               AND te.contract_line_id = cl.contract_line_id
              WHERE cc.tenant = {{tenant}}
                AND te.start_time >= {{start_of_year}}
                AND te.start_time < {{end_of_year}}
              GROUP BY cc.tenant, cc.client_contract_id
            ) AS labor
              ON labor.tenant = revenue.tenant
             AND labor.client_contract_id = revenue.client_contract_id
            LEFT JOIN (
              SELECT
                hardware_sources.tenant,
                hardware_sources.client_contract_id,
                COALESCE(SUM(hardware_sources.cogs_cost), 0) AS hardware_cogs_cents
              FROM (
                SELECT DISTINCT
                  inv.tenant,
                  COALESCE(ic.client_contract_id, inv.client_contract_id) AS client_contract_id,
                  sm.movement_id,
                  COALESCE(sm.cogs_cost, 0) AS cogs_cost
                FROM invoices AS inv
                JOIN invoice_charges AS ic
                  ON ic.invoice_id = inv.invoice_id
                 AND ic.tenant = inv.tenant
                JOIN sales_order_lines AS sol
                  ON sol.so_line_id = ic.so_line_id
                 AND sol.tenant = ic.tenant
                JOIN stock_movements AS sm
                  ON sm.tenant = inv.tenant
                 AND sm.movement_type = 'consume'
                 AND sm.source_doc_type = 'sales_order'
                 AND sm.source_doc_id = sol.so_id
                 AND sm.service_id = sol.service_id
                WHERE ${ELIGIBLE_INVOICE_FILTER}
                  AND ic.so_line_id IS NOT NULL
                  AND COALESCE(ic.client_contract_id, inv.client_contract_id) IS NOT NULL

                UNION

                SELECT DISTINCT
                  inv.tenant,
                  inv.client_contract_id,
                  sm.movement_id,
                  COALESCE(sm.cogs_cost, 0) AS cogs_cost
                FROM invoices AS inv
                JOIN ticket_materials AS tm
                  ON tm.billed_invoice_id = inv.invoice_id
                 AND tm.tenant = inv.tenant
                JOIN stock_movements AS sm
                  ON sm.tenant = tm.tenant
                 AND sm.movement_type = 'consume'
                 AND sm.source_doc_type = 'ticket_material'
                 AND sm.source_doc_id = tm.ticket_material_id
                WHERE ${ELIGIBLE_INVOICE_FILTER}
                  AND inv.client_contract_id IS NOT NULL

                UNION

                SELECT DISTINCT
                  inv.tenant,
                  inv.client_contract_id,
                  sm.movement_id,
                  COALESCE(sm.cogs_cost, 0) AS cogs_cost
                FROM invoices AS inv
                JOIN project_materials AS pm
                  ON pm.billed_invoice_id = inv.invoice_id
                 AND pm.tenant = inv.tenant
                JOIN stock_movements AS sm
                  ON sm.tenant = pm.tenant
                 AND sm.movement_type = 'consume'
                 AND sm.source_doc_type = 'project_material'
                 AND sm.source_doc_id = pm.project_material_id
                WHERE ${ELIGIBLE_INVOICE_FILTER}
                  AND inv.client_contract_id IS NOT NULL
              ) AS hardware_sources
              GROUP BY hardware_sources.tenant, hardware_sources.client_contract_id
            ) AS hardware
              ON hardware.tenant = revenue.tenant
             AND hardware.client_contract_id = revenue.client_contract_id
          ) AS contract_profit
        `],
        aggregation: 'avg',
        filters: []
      },
      formatting: {
        type: 'percentage',
        decimals: 1
      }
    }
  ],

  caching: {
    ttl: 600, // 10 minutes (less frequent updates for profitability)
    key: 'contracts.profitability.{{tenant}}',
    invalidateOn: ['invoice.created', 'invoice.updated', 'time_entries.created', 'time_entries.updated', 'stock_movements.created']
  }
};
