// Contract Bucket Usage Report Definition
// Monitor bucket hours usage and identify overage situations

import { ReportDefinition } from '../../core/types';

export const contractBucketUsageReport: ReportDefinition = {
  id: 'contracts.bucket_usage',
  name: 'Contract Bucket Hours Utilization Report',
  description: 'Monitor bucket hours usage and identify overage situations',
  category: 'billing',
  version: '1.0.0',

  permissions: {
    roles: ['admin', 'billing_manager', 'account_manager'],
    resources: ['billing.read', 'contracts.read']
  },

  metrics: [
    {
      id: 'bucket_contracts_count',
      name: 'Bucket-Type Contracts',
      description: 'Count of active bucket/time-based contracts',
      type: 'count',
      query: {
        table: 'contract_lines',
        aggregation: 'count',
        filters: [
          { field: 'tenant', operator: 'eq', value: '{{tenant}}' },
          { field: 'is_active', operator: 'eq', value: true },
          { field: 'contract_line_type', operator: 'eq', value: 'Bucket' }
        ]
      },
      formatting: {
        type: 'number',
        decimals: 0
      }
    },

    {
      id: 'total_allocated_minutes',
      name: 'Total Allocated Minutes',
      description: 'Sum of all allocated bucket minutes across active bucket pools',
      type: 'sum',
      query: {
        table: 'contract_line_buckets',
        joins: [
          {
            type: 'inner',
            table: 'contract_lines',
            on: [
              { left: 'contract_line_buckets.contract_line_id', right: 'contract_lines.contract_line_id' },
              { left: 'contract_line_buckets.tenant', right: 'contract_lines.tenant' }
            ]
          }
        ],
        fields: ['contract_line_buckets.total_minutes'],
        aggregation: 'sum',
        filters: [
          { field: 'contract_line_buckets.tenant', operator: 'eq', value: '{{tenant}}' },
          { field: 'contract_lines.is_active', operator: 'eq', value: true }
        ]
      },
      formatting: {
        type: 'duration',
        unit: 'hours',
        decimals: 1
      }
    },

    {
      id: 'total_used_minutes',
      name: 'Total Used Minutes',
      description: 'Sum of weighted bucket minutes used across active pools',
      type: 'sum',
      query: {
        table: 'bucket_usage',
        joins: [
          {
            type: 'inner',
            table: 'contract_line_buckets',
            on: [
              { left: 'bucket_usage.bucket_id', right: 'contract_line_buckets.bucket_id' },
              { left: 'bucket_usage.tenant', right: 'contract_line_buckets.tenant' }
            ]
          },
          {
            type: 'inner',
            table: 'contract_lines',
            on: [
              { left: 'contract_line_buckets.contract_line_id', right: 'contract_lines.contract_line_id' },
              { left: 'contract_line_buckets.tenant', right: 'contract_lines.tenant' }
            ]
          }
        ],
        fields: ['bucket_usage.minutes_used'],
        aggregation: 'sum',
        filters: [
          { field: 'bucket_usage.tenant', operator: 'eq', value: '{{tenant}}' },
          { field: 'contract_lines.is_active', operator: 'eq', value: true }
        ]
      },
      formatting: {
        type: 'duration',
        unit: 'hours',
        decimals: 1
      }
    },

    {
      id: 'overage_minutes',
      name: 'Total Overage Minutes',
      description: 'Sum of weighted minutes exceeding allocated buckets',
      type: 'sum',
      query: {
        table: 'bucket_usage',
        joins: [
          {
            type: 'inner',
            table: 'contract_line_buckets',
            on: [
              { left: 'bucket_usage.bucket_id', right: 'contract_line_buckets.bucket_id' },
              { left: 'bucket_usage.tenant', right: 'contract_line_buckets.tenant' }
            ]
          },
          {
            type: 'inner',
            table: 'contract_lines',
            on: [
              { left: 'contract_line_buckets.contract_line_id', right: 'contract_lines.contract_line_id' },
              { left: 'contract_line_buckets.tenant', right: 'contract_lines.tenant' }
            ]
          }
        ],
        fields: ['bucket_usage.overage_minutes'],
        aggregation: 'sum',
        filters: [
          { field: 'bucket_usage.tenant', operator: 'eq', value: '{{tenant}}' },
          { field: 'contract_lines.is_active', operator: 'eq', value: true }
        ]
      },
      formatting: {
        type: 'duration',
        unit: 'hours',
        decimals: 1
      }
    },

    {
      id: 'contracts_in_overage',
      name: 'Contracts in Overage',
      description: 'Count of bucket pools currently in overage status',
      type: 'count',
      query: {
        table: 'bucket_usage',
        joins: [
          {
            type: 'inner',
            table: 'contract_line_buckets',
            on: [
              { left: 'bucket_usage.bucket_id', right: 'contract_line_buckets.bucket_id' },
              { left: 'bucket_usage.tenant', right: 'contract_line_buckets.tenant' }
            ]
          },
          {
            type: 'inner',
            table: 'contract_lines',
            on: [
              { left: 'contract_line_buckets.contract_line_id', right: 'contract_lines.contract_line_id' },
              { left: 'contract_line_buckets.tenant', right: 'contract_lines.tenant' }
            ]
          }
        ],
        aggregation: 'count',
        filters: [
          { field: 'bucket_usage.tenant', operator: 'eq', value: '{{tenant}}' },
          { field: 'contract_lines.is_active', operator: 'eq', value: true },
          { field: 'bucket_usage.overage_minutes', operator: 'gt', value: 0 }
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
    key: 'contracts.bucket_usage.{{tenant}}',
    invalidateOn: ['contract_lines.updated', 'contract_line_buckets.updated', 'bucket_usage.updated', 'time_entries.created', 'time_entries.updated']
  }
};
