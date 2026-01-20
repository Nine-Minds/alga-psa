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
      id: 'ytd_gross_profit',
      name: 'Year-to-Date Gross Profit',
      description: 'Revenue minus labor cost (simplified profitability)',
      type: 'sum',
      query: {
        table: 'invoices',
        joins: [
          {
            type: 'left',
            table: 'time_entries',
            on: [
              { left: 'invoices.client_id', right: 'time_entries.user_id' },
              { left: 'invoices.tenant', right: 'time_entries.tenant' }
            ]
          }
        ],
        fields: [
          'invoices.total_amount - COALESCE(time_entries.billable_duration * 833.33, 0)'
        ],
        aggregation: 'sum',
        filters: [
          { field: 'invoices.tenant', operator: 'eq', value: '{{tenant}}' },
          { field: 'invoices.invoice_date', operator: 'gte', value: '{{start_of_year}}' },
          { field: 'invoices.invoice_date', operator: 'lt', value: '{{end_of_year}}' },
          { field: 'invoices.status', operator: 'in', value: ['paid', 'completed', 'sent', 'open', 'overdue'] }
        ]
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
        table: 'invoices',
        joins: [
          {
            type: 'left',
            table: 'time_entries',
            on: [
              { left: 'invoices.client_id', right: 'time_entries.user_id' },
              { left: 'invoices.tenant', right: 'time_entries.tenant' }
            ]
          }
        ],
        fields: [
          '(SUM(invoices.total_amount) - COALESCE(SUM(time_entries.billable_duration * 833.33), 0)) / NULLIF(SUM(invoices.total_amount), 0) * 100'
        ],
        aggregation: 'sum',
        filters: [
          { field: 'invoices.tenant', operator: 'eq', value: '{{tenant}}' },
          { field: 'invoices.invoice_date', operator: 'gte', value: '{{start_of_year}}' },
          { field: 'invoices.invoice_date', operator: 'lt', value: '{{end_of_year}}' },
          { field: 'invoices.status', operator: 'in', value: ['paid', 'completed', 'sent', 'open', 'overdue'] }
        ]
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
        table: 'invoices',
        joins: [
          {
            type: 'left',
            table: 'time_entries',
            on: [
              { left: 'invoices.client_id', right: 'time_entries.user_id' },
              { left: 'invoices.tenant', right: 'time_entries.tenant' }
            ]
          }
        ],
        fields: [
          '(invoices.total_amount - COALESCE(time_entries.billable_duration * 833.33, 0)) / NULLIF(invoices.total_amount, 0) * 100'
        ],
        aggregation: 'avg',
        filters: [
          { field: 'invoices.tenant', operator: 'eq', value: '{{tenant}}' },
          { field: 'invoices.invoice_date', operator: 'gte', value: '{{start_of_year}}' },
          { field: 'invoices.invoice_date', operator: 'lt', value: '{{end_of_year}}' },
          { field: 'invoices.status', operator: 'in', value: ['paid', 'completed', 'sent', 'open', 'overdue'] }
        ]
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
