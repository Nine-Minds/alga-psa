import type { EntityDeletionConfig } from '@alga-psa/types';
import type { Knex } from 'knex';

const countDocumentAssociations = (entityType: string) => {
  return async (trx: Knex | Knex.Transaction, options: { tenant: string; entityId: string }) => {
    const result = await trx('document_associations')
      .where({
        tenant: options.tenant,
        entity_id: options.entityId,
        entity_type: entityType
      })
      .count<{ count: string }>('1 as count')
      .first();

    return Number(result?.count ?? 0);
  };
};

const countPortalUsers = async (
  trx: Knex | Knex.Transaction,
  options: { tenant: string; entityId: string }
): Promise<number> => {
  const result = await trx('users')
    .where({
      tenant: options.tenant,
      contact_id: options.entityId,
      user_type: 'client'
    })
    .count<{ count: string }>('1 as count')
    .first();

  return Number(result?.count ?? 0);
};

const countTimeEntryBilling = async (
  trx: Knex | Knex.Transaction,
  options: { tenant: string; entityId: string }
): Promise<number> => {
  const result = await trx('time_entries')
    .where({
      tenant: options.tenant,
      entry_id: options.entityId,
      invoiced: true
    })
    .count<{ count: string }>('1 as count')
    .first();

  return Number(result?.count ?? 0);
};

export const DELETION_CONFIGS: Record<string, EntityDeletionConfig> = {
  client: {
    entityType: 'client',
    supportsInactive: true,
    supportsArchive: false,
    tagEntityType: 'client',
    dependencies: [
      { type: 'contact', table: 'contacts', foreignKey: 'client_id', label: 'contact' },
      {
        type: 'ticket',
        table: 'tickets',
        foreignKey: 'client_id',
        label: 'ticket',
        viewUrlTemplate: '/msp/tickets?client_id={id}'
      },
      { type: 'project', table: 'projects', foreignKey: 'client_id', label: 'project' },
      { type: 'invoice', table: 'invoices', foreignKey: 'client_id', label: 'invoice' },
      {
        type: 'document',
        table: 'document_associations',
        label: 'document',
        countQuery: countDocumentAssociations('company')
      },
      { type: 'interaction', table: 'interactions', foreignKey: 'client_id', label: 'interaction' },
      { type: 'asset', table: 'assets', foreignKey: 'client_id', label: 'asset' },
      { type: 'usage', table: 'usage_tracking', foreignKey: 'client_id', label: 'usage record' },
      { type: 'bucket_usage', table: 'bucket_usage', foreignKey: 'client_id', label: 'bucket usage record' }
    ]
  },
  contact: {
    entityType: 'contact',
    supportsInactive: true,
    supportsArchive: false,
    tagEntityType: 'contact',
    dependencies: [
      { type: 'ticket', table: 'tickets', foreignKey: 'contact_name_id', label: 'ticket' },
      { type: 'interaction', table: 'interactions', foreignKey: 'contact_name_id', label: 'interaction' },
      {
        type: 'document',
        table: 'document_associations',
        label: 'document',
        countQuery: countDocumentAssociations('contact')
      },
      {
        type: 'portal_user',
        table: 'users',
        label: 'portal user account',
        countQuery: countPortalUsers
      }
    ]
  },
  ticket: {
    entityType: 'ticket',
    supportsInactive: false,
    supportsArchive: true,
    tagEntityType: 'ticket',
    dependencies: []
  },
  project: {
    entityType: 'project',
    supportsInactive: false,
    supportsArchive: true,
    tagEntityType: 'project',
    dependencies: []
  },
  category: {
    entityType: 'category',
    supportsInactive: false,
    supportsArchive: false,
    dependencies: [
      { type: 'subcategory', table: 'categories', foreignKey: 'parent_category', label: 'subcategory' },
      { type: 'ticket', table: 'tickets', foreignKey: 'category_id', label: 'ticket' },
      { type: 'service', table: 'service_catalog', foreignKey: 'category_id', label: 'service' }
    ]
  },
  status: {
    entityType: 'status',
    supportsInactive: false,
    supportsArchive: false,
    dependencies: []
  },
  team: {
    entityType: 'team',
    supportsInactive: false,
    supportsArchive: false,
    dependencies: [
      { type: 'member', table: 'team_members', foreignKey: 'team_id', label: 'team member' },
      { type: 'ticket', table: 'tickets', foreignKey: 'assigned_team_id', label: 'assigned ticket' }
    ]
  },
  user: {
    entityType: 'user',
    supportsInactive: true,
    supportsArchive: false,
    dependencies: [
      { type: 'ticket', table: 'tickets', foreignKey: 'assigned_to', label: 'assigned ticket' },
      { type: 'time_entry', table: 'time_entries', foreignKey: 'user_id', label: 'time entry' },
      {
        type: 'schedule_assignee',
        table: 'schedule_entry_assignees',
        foreignKey: 'user_id',
        label: 'schedule assignment'
      },
      { type: 'team_member', table: 'team_members', foreignKey: 'user_id', label: 'team membership' }
    ]
  },
  contract_line: {
    entityType: 'contract_line',
    supportsInactive: false,
    supportsArchive: false,
    dependencies: [
      {
        type: 'service_config',
        table: 'contract_line_services',
        foreignKey: 'contract_line_id',
        label: 'service configuration'
      },
      { type: 'usage', table: 'usage_tracking', foreignKey: 'contract_line_id', label: 'usage record' },
      { type: 'bucket_usage', table: 'bucket_usage', foreignKey: 'contract_line_id', label: 'bucket usage record' },
      { type: 'time_entry', table: 'time_entries', foreignKey: 'contract_line_id', label: 'time entry' }
    ]
  },
  service: {
    entityType: 'service',
    supportsInactive: true,
    supportsArchive: false,
    dependencies: [
      { type: 'time_entry', table: 'time_entries', foreignKey: 'service_id', label: 'time entry' },
      { type: 'bucket_usage', table: 'bucket_usage', foreignKey: 'service_catalog_id', label: 'bucket usage record' },
      {
        type: 'contract_line_service',
        table: 'contract_line_services',
        foreignKey: 'service_id',
        label: 'contract line configuration'
      }
    ]
  },
  tax_rate: {
    entityType: 'tax_rate',
    supportsInactive: false,
    supportsArchive: false,
    dependencies: [
      { type: 'client_tax_rate', table: 'client_tax_rates', foreignKey: 'tax_rate_id', label: 'client tax assignment' },
      { type: 'time_entry', table: 'time_entries', foreignKey: 'tax_rate_id', label: 'time entry' },
      { type: 'service', table: 'service_catalog', foreignKey: 'tax_rate_id', label: 'service' }
    ]
  },
  asset: {
    entityType: 'asset',
    supportsInactive: true,
    supportsArchive: false,
    tagEntityType: 'asset',
    dependencies: [
      {
        type: 'maintenance_schedule',
        table: 'asset_maintenance_schedules',
        foreignKey: 'asset_id',
        label: 'maintenance schedule'
      }
    ]
  },
  document: {
    entityType: 'document',
    supportsInactive: false,
    supportsArchive: false,
    tagEntityType: 'document',
    dependencies: []
  },
  invoice_template: {
    entityType: 'invoice_template',
    supportsInactive: false,
    supportsArchive: false,
    dependencies: [
      { type: 'invoice', table: 'invoices', foreignKey: 'template_id', label: 'invoice' },
      { type: 'client', table: 'clients', foreignKey: 'invoice_template_id', label: 'client' },
      {
        type: 'conditional_rule',
        table: 'conditional_display_rules',
        foreignKey: 'template_id',
        label: 'conditional display rule'
      }
    ]
  },
  workflow: {
    entityType: 'workflow',
    supportsInactive: true,
    supportsArchive: false,
    dependencies: []
  },
  schedule_entry: {
    entityType: 'schedule_entry',
    supportsInactive: false,
    supportsArchive: false,
    dependencies: []
  },
  time_entry: {
    entityType: 'time_entry',
    supportsInactive: false,
    supportsArchive: false,
    dependencies: [
      {
        type: 'billed',
        table: 'time_entries',
        label: 'billing record',
        countQuery: countTimeEntryBilling
      }
    ]
  },
  priority: {
    entityType: 'priority',
    supportsInactive: false,
    supportsArchive: false,
    dependencies: [
      { type: 'ticket', table: 'tickets', foreignKey: 'priority_id', label: 'ticket' }
    ]
  },
  board: {
    entityType: 'board',
    supportsInactive: false,
    supportsArchive: false,
    dependencies: [
      { type: 'ticket', table: 'tickets', foreignKey: 'board_id', label: 'ticket' },
      { type: 'category', table: 'categories', foreignKey: 'board_id', label: 'category' }
    ]
  },
  interaction_type: {
    entityType: 'interaction_type',
    supportsInactive: false,
    supportsArchive: false,
    dependencies: [
      { type: 'interaction', table: 'interactions', foreignKey: 'type_id', label: 'interaction' }
    ]
  },
  role: {
    entityType: 'role',
    supportsInactive: false,
    supportsArchive: false,
    dependencies: [
      { type: 'user', table: 'user_roles', foreignKey: 'role_id', label: 'user assignment' }
    ]
  }
};

export function getDeletionConfig(entityType: string): EntityDeletionConfig | undefined {
  return DELETION_CONFIGS[entityType];
}
