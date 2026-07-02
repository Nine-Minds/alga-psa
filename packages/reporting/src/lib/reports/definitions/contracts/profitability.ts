// Contract Profitability Report Definition
// Basic profit margins and revenue vs. cost analysis by contract

import { ReportDefinition } from '../../core/types';

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
          'COALESCE(time_entries.billable_duration * 83.33, 0)' // $50/hr = 5000 cents/hr = 83.33 cents/min * billable_duration
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
      id: 'ytd_gross_profit',
      name: 'Year-to-Date Gross Profit',
      description: 'Revenue minus labor cost (simplified profitability)',
      type: 'sum',
      query: {
        table: 'raw_sql',
        fields: [
          `
          SELECT
            COALESCE(revenue.total_revenue, 0) - COALESCE(cost.total_cost, 0) AS sum
          FROM (
            SELECT COALESCE(SUM(total_amount), 0) AS total_revenue
            FROM invoices
            WHERE tenant = {{tenant}}
              AND invoice_date >= {{start_of_year}}
              AND invoice_date < {{end_of_year}}
              AND status IN ('paid', 'completed', 'sent', 'open', 'overdue')
          ) revenue
          CROSS JOIN (
            SELECT COALESCE(SUM(COALESCE(billable_duration, 0) * 83.33), 0) AS total_cost
            FROM time_entries
            WHERE tenant = {{tenant}}
              AND start_time >= {{start_of_year}}
              AND start_time < {{end_of_year}}
          ) cost
          `
        ],
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
        fields: [
          `
          SELECT
            COALESCE(
              (revenue.total_revenue - cost.total_cost) / NULLIF(revenue.total_revenue, 0) * 100,
              0
            ) AS sum
          FROM (
            SELECT COALESCE(SUM(total_amount), 0) AS total_revenue
            FROM invoices
            WHERE tenant = {{tenant}}
              AND invoice_date >= {{start_of_year}}
              AND invoice_date < {{end_of_year}}
              AND status IN ('paid', 'completed', 'sent', 'open', 'overdue')
          ) revenue
          CROSS JOIN (
            SELECT COALESCE(SUM(COALESCE(billable_duration, 0) * 83.33), 0) AS total_cost
            FROM time_entries
            WHERE tenant = {{tenant}}
              AND start_time >= {{start_of_year}}
              AND start_time < {{end_of_year}}
          ) cost
          `
        ],
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
        fields: [
          `
          WITH invoice_totals AS (
            SELECT
              inv.invoice_id,
              inv.tenant,
              COALESCE(SUM(ic.net_amount), 0) AS invoice_revenue
            FROM invoices inv
            LEFT JOIN invoice_charges ic
              ON ic.invoice_id = inv.invoice_id
             AND ic.tenant = inv.tenant
            WHERE inv.tenant = {{tenant}}
              AND inv.invoice_date >= {{start_of_year}}
              AND inv.invoice_date < {{end_of_year}}
              AND inv.status IN ('paid', 'completed', 'sent', 'open', 'overdue')
            GROUP BY inv.invoice_id, inv.tenant
          ),
          invoice_costs AS (
            SELECT
              ite.invoice_id,
              ite.tenant,
              COALESCE(SUM(COALESCE(te.billable_duration, 0) * 83.33), 0) AS invoice_cost
            FROM invoice_time_entries ite
            JOIN time_entries te
              ON te.entry_id = ite.entry_id
             AND te.tenant = ite.tenant
            WHERE ite.tenant = {{tenant}}
              AND te.start_time >= {{start_of_year}}
              AND te.start_time < {{end_of_year}}
            GROUP BY ite.invoice_id, ite.tenant
          )
          SELECT COALESCE(
            AVG(
              CASE
                WHEN it.invoice_revenue > 0 THEN
                  (it.invoice_revenue - COALESCE(ic.invoice_cost, 0)) / it.invoice_revenue * 100
                ELSE NULL
              END
            ),
            0
          ) AS avg
          FROM invoice_totals it
          LEFT JOIN invoice_costs ic
            ON ic.invoice_id = it.invoice_id
           AND ic.tenant = it.tenant
          `
        ],
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
    invalidateOn: ['invoice.created', 'invoice.updated', 'time_entries.created', 'time_entries.updated']
  }
};
