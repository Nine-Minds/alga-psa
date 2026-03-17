// Contract Revenue Report Definition
// Shows monthly recurring revenue and year-to-date billing by contract

import { ReportDefinition } from '../../core/types';

export const contractRevenueReport: ReportDefinition = {
  id: 'contracts.revenue',
  name: 'Contract Revenue Report',
  description: 'Overview of monthly recurring revenue and year-to-date billed service periods by contract',
  category: 'billing',
  version: '1.0.0',

  permissions: {
    roles: ['admin', 'billing_manager', 'account_manager'],
    resources: ['billing.read', 'contracts.read']
  },

  metrics: [
    {
      id: 'active_contracts_count',
      name: 'Active Contracts',
      description: 'Total count of active contracts',
      type: 'count',
      query: {
        table: 'client_contracts',
        aggregation: 'count',
        filters: [
          { field: 'tenant', operator: 'eq', value: '{{tenant}}' },
          { field: 'is_active', operator: 'eq', value: true },
          { field: "raw:COALESCE(start_date, CURRENT_DATE)", operator: 'lte', value: '{{today}}' },
          { field: "raw:COALESCE(end_date, DATE '9999-12-31')", operator: 'gte', value: '{{today}}' }
        ]
      },
      formatting: {
        type: 'number',
        decimals: 0
      }
    },

    {
      id: 'total_monthly_revenue',
      name: 'Total Monthly Recurring Revenue',
      description: 'Sum of all monthly recurring revenue from active contracts',
      type: 'sum',
      query: {
        table: 'client_contracts',
        joins: [
          {
            type: 'inner',
            table: 'contract_lines',
            on: [
              { left: 'client_contracts.contract_id', right: 'contract_lines.contract_id' },
              { left: 'client_contracts.tenant', right: 'contract_lines.tenant' }
            ]
          }
        ],
        fields: ['COALESCE(contract_lines.custom_rate, 0)'],
        aggregation: 'sum',
        filters: [
          { field: 'client_contracts.tenant', operator: 'eq', value: '{{tenant}}' },
          { field: 'client_contracts.is_active', operator: 'eq', value: true },
          { field: "raw:COALESCE(client_contracts.start_date, CURRENT_DATE)", operator: 'lte', value: '{{today}}' },
          { field: "raw:COALESCE(client_contracts.end_date, DATE '9999-12-31')", operator: 'gte', value: '{{today}}' }
        ]
      },
      formatting: {
        type: 'currency',
        currency: 'USD',
        divisor: 100
      }
    },

    {
      id: 'ytd_total_billed',
      name: 'Year-to-Date Total Billed',
      description: 'Total amount billed year-to-date using canonical recurring service periods when detail rows exist, with invoice-date fallback for historical rows',
      type: 'sum',
      query: {
        table: 'raw_sql',
        fields: [`
          SELECT COALESCE(SUM(contract_revenue_facts.amount_cents), 0) AS sum
          FROM (
            SELECT
              ic.item_id,
              CASE
                WHEN COUNT(iid.item_detail_id) FILTER (WHERE iid.item_detail_id IS NOT NULL) = 0
                  THEN MAX(ic.net_amount)
                WHEN COUNT(iifd.item_detail_id) FILTER (WHERE iifd.item_detail_id IS NOT NULL) > 0
                  THEN COALESCE(SUM(iifd.allocated_amount), 0)
                ELSE MAX(ic.net_amount)
              END AS amount_cents,
              COALESCE(MAX(iid.service_period_end)::timestamp, MAX(inv.invoice_date)::timestamp) AS reporting_period_end
            FROM invoice_charges AS ic
            JOIN invoices AS inv
              ON inv.invoice_id = ic.invoice_id
             AND inv.tenant = ic.tenant
            LEFT JOIN invoice_charge_details AS iid
              ON iid.item_id = ic.item_id
             AND iid.tenant = ic.tenant
            LEFT JOIN invoice_charge_fixed_details AS iifd
              ON iifd.item_detail_id = iid.item_detail_id
             AND iifd.tenant = iid.tenant
            WHERE ic.tenant = {{tenant}}
              AND inv.status IN ('paid', 'completed', 'sent', 'open', 'overdue')
              AND ic.client_contract_id IS NOT NULL
            GROUP BY ic.item_id
          ) AS contract_revenue_facts
          WHERE contract_revenue_facts.reporting_period_end >= {{start_of_year}}
            AND contract_revenue_facts.reporting_period_end < {{end_of_year}}
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
      id: 'active_client_contracts',
      name: 'Active Client Contract Assignments',
      description: 'Number of active contracts assigned to clients',
      type: 'count',
      query: {
        table: 'client_contracts',
        aggregation: 'count',
        filters: [
          { field: 'tenant', operator: 'eq', value: '{{tenant}}' },
          { field: 'is_active', operator: 'eq', value: true },
          { field: "raw:COALESCE(start_date, CURRENT_DATE)", operator: 'lte', value: '{{today}}' },
          { field: "raw:COALESCE(end_date, DATE '9999-12-31')", operator: 'gte', value: '{{today}}' }
        ]
      },
      formatting: {
        type: 'number',
        decimals: 0
      }
    }
  ],

  caching: {
    ttl: 300, // 5 minutes
    key: 'contracts.revenue.{{tenant}}',
    invalidateOn: ['contract.created', 'contract.updated', 'client_contracts.created', 'client_contracts.updated', 'invoice.created']
  }
};
