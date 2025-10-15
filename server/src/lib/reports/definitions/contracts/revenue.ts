// Contract Revenue Report Definition
// Shows monthly recurring revenue and year-to-date billing by contract

import { ReportDefinition } from '../../core/types';

export const contractRevenueReport: ReportDefinition = {
  id: 'contracts.revenue',
  name: 'Contract Revenue Report',
  description: 'Overview of monthly recurring revenue and year-to-date billing by contract',
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
        table: 'contracts',
        aggregation: 'count',
        filters: [
          { field: 'tenant', operator: 'eq', value: '{{tenant}}' },
          { field: 'is_active', operator: 'eq', value: true }
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
        table: 'contracts',
        joins: [
          {
            type: 'inner',
            table: 'contract_line_mappings',
            on: [
              { left: 'contracts.contract_id', right: 'contract_line_mappings.contract_id' },
              { left: 'contracts.tenant', right: 'contract_line_mappings.tenant' }
            ]
          },
          {
            type: 'left',
            table: 'contract_line_fixed_config',
            on: [
              { left: 'contract_line_mappings.contract_line_id', right: 'contract_line_fixed_config.contract_line_id' },
              { left: 'contract_line_mappings.tenant', right: 'contract_line_fixed_config.tenant' }
            ]
          }
        ],
        fields: ['COALESCE(contract_line_mappings.custom_rate, contract_line_fixed_config.base_rate, 0)'],
        aggregation: 'sum',
        filters: [
          { field: 'contracts.tenant', operator: 'eq', value: '{{tenant}}' },
          { field: 'contracts.is_active', operator: 'eq', value: true }
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
      description: 'Total amount billed year-to-date from invoices',
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
      id: 'active_client_contracts',
      name: 'Active Client Contract Assignments',
      description: 'Number of active contracts assigned to clients',
      type: 'count',
      query: {
        table: 'client_contracts',
        aggregation: 'count',
        filters: [
          { field: 'tenant', operator: 'eq', value: '{{tenant}}' },
          { field: 'is_active', operator: 'eq', value: true }
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
