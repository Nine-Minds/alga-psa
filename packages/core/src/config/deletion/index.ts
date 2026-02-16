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
      .count<{ count: string }>('* as count')
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
    .count<{ count: string }>('* as count')
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
    .count<{ count: string }>('* as count')
    .first();

  return Number(result?.count ?? 0);
};

const getStatusType = async (
  trx: Knex | Knex.Transaction,
  options: { tenant: string; entityId: string }
): Promise<string | null> => {
  const status = await trx('statuses')
    .select('status_type')
    .where({
      tenant: options.tenant,
      status_id: options.entityId
    })
    .first();

  return status?.status_type ?? null;
};

const countStatusUsage = (
  statusType: string,
  table: string,
  foreignKey: string
) => {
  return async (trx: Knex | Knex.Transaction, options: { tenant: string; entityId: string }) => {
    const currentType = await getStatusType(trx, options);
    if (!currentType || currentType !== statusType) {
      return 0;
    }

    const result = await trx(table)
      .where({
        tenant: options.tenant,
        [foreignKey]: options.entityId
      })
      .count<{ count: string }>('* as count')
      .first();

    return Number(result?.count ?? 0);
  };
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
      { type: 'bucket_usage', table: 'bucket_usage', foreignKey: 'client_id', label: 'bucket usage record' },
      { type: 'survey_invitation', table: 'survey_invitations', foreignKey: 'client_id', label: 'survey invitation' },
      { type: 'survey_response', table: 'survey_responses', foreignKey: 'client_id', label: 'survey response' }
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
      },
      { type: 'survey_invitation', table: 'survey_invitations', foreignKey: 'contact_id', label: 'survey invitation' },
      { type: 'survey_response', table: 'survey_responses', foreignKey: 'contact_id', label: 'survey response' }
    ]
  },
  ticket: {
    entityType: 'ticket',
    supportsInactive: false,
    supportsArchive: true,
    tagEntityType: 'ticket',
    dependencies: [
      {
        type: 'time_entry',
        table: 'time_entries',
        label: 'time entry',
        countQuery: async (trx, options) => {
          const result = await trx('time_entries')
            .where({ tenant: options.tenant, work_item_id: options.entityId, work_item_type: 'ticket' })
            .count<{ count: string }>('* as count')
            .first();
          return Number(result?.count ?? 0);
        }
      },
      { type: 'interaction', table: 'interactions', foreignKey: 'ticket_id', label: 'interaction' }
    ]
  },
  project: {
    entityType: 'project',
    supportsInactive: false,
    supportsArchive: true,
    tagEntityType: 'project',
    dependencies: [
      { type: 'interaction', table: 'interactions', foreignKey: 'project_id', label: 'interaction' }
    ]
  },
  category: {
    entityType: 'category',
    supportsInactive: false,
    supportsArchive: false,
    dependencies: [
      { type: 'subcategory', table: 'categories', foreignKey: 'parent_category', label: 'subcategory' },
      { type: 'ticket', table: 'tickets', foreignKey: 'category_id', label: 'ticket' },
      { type: 'ticket_subcategory', table: 'tickets', foreignKey: 'subcategory_id', label: 'ticket (as subcategory)' },
      { type: 'service', table: 'service_catalog', foreignKey: 'category_id', label: 'service' }
    ]
  },
  status: {
    entityType: 'status',
    supportsInactive: false,
    supportsArchive: false,
    dependencies: [
      {
        type: 'ticket',
        table: 'tickets',
        label: 'ticket',
        countQuery: countStatusUsage('ticket', 'tickets', 'status_id')
      },
      {
        type: 'project',
        table: 'projects',
        label: 'project',
        countQuery: countStatusUsage('project', 'projects', 'status')
      },
      {
        type: 'project_task',
        table: 'project_tasks',
        label: 'project task',
        countQuery: countStatusUsage('project_task', 'project_tasks', 'status_id')
      },
      {
        type: 'project_status_mapping',
        table: 'project_status_mappings',
        label: 'project status mapping',
        countQuery: countStatusUsage('project_task', 'project_status_mappings', 'status_id')
      },
      {
        type: 'interaction',
        table: 'interactions',
        label: 'interaction',
        countQuery: countStatusUsage('interaction', 'interactions', 'status_id')
      }
    ]
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
      { type: 'time_sheet', table: 'time_sheets', foreignKey: 'user_id', label: 'time sheet' },
      { type: 'comment', table: 'comments', foreignKey: 'user_id', label: 'comment' },
      { type: 'interaction', table: 'interactions', foreignKey: 'user_id', label: 'interaction' },
      { type: 'project_task', table: 'project_tasks', foreignKey: 'assigned_to', label: 'assigned project task' },
      { type: 'resource', table: 'resources', foreignKey: 'user_id', label: 'resource record' },
      {
        type: 'schedule_assignee',
        table: 'schedule_entry_assignees',
        foreignKey: 'user_id',
        label: 'schedule assignment'
      },
      { type: 'team_member', table: 'team_members', foreignKey: 'user_id', label: 'team membership' },
      { type: 'team_manager', table: 'teams', foreignKey: 'manager_id', label: 'managed team' },
      { type: 'board_manager', table: 'boards', foreignKey: 'manager_user_id', label: 'managed board' },
      { type: 'board_default_assignee', table: 'boards', foreignKey: 'default_assigned_to', label: 'board default assignment' },
      { type: 'ticket_resource', table: 'ticket_resources', foreignKey: 'assigned_to', label: 'ticket resource assignment' },
      { type: 'task_resource', table: 'task_resources', foreignKey: 'assigned_to', label: 'task resource assignment' },
      { type: 'invoice_annotation', table: 'invoice_annotations', foreignKey: 'user_id', label: 'invoice annotation' },
      { type: 'job', table: 'jobs', foreignKey: 'user_id', label: 'job' }
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
      { type: 'usage', table: 'usage_tracking', foreignKey: 'service_id', label: 'usage record' },
      {
        type: 'contract_line_service',
        table: 'contract_line_services',
        foreignKey: 'service_id',
        label: 'contract line configuration'
      },
      { type: 'contract_template_line_default', table: 'contract_template_line_defaults', foreignKey: 'service_id', label: 'contract template default' },
      { type: 'contract_template_line_service', table: 'contract_template_line_services', foreignKey: 'service_id', label: 'contract template service' },
      { type: 'invoice_charge', table: 'invoice_charges', foreignKey: 'service_id', label: 'invoice charge' },
      { type: 'invoice_charge_target', table: 'invoice_charges', foreignKey: 'applies_to_service_id', label: 'invoice charge target' },
      { type: 'invoice_charge_detail', table: 'invoice_charge_details', foreignKey: 'service_id', label: 'invoice charge detail' }
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
  survey_template: {
    entityType: 'survey_template',
    supportsInactive: false,
    supportsArchive: false,
    dependencies: [
      { type: 'survey_trigger', table: 'survey_triggers', foreignKey: 'template_id', label: 'survey trigger' },
      { type: 'survey_invitation', table: 'survey_invitations', foreignKey: 'template_id', label: 'survey invitation' },
      { type: 'survey_response', table: 'survey_responses', foreignKey: 'template_id', label: 'survey response' }
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
      },
      { type: 'invoice_time_entry', table: 'invoice_time_entries', foreignKey: 'entry_id', label: 'invoice line item' }
    ]
  },
  priority: {
    entityType: 'priority',
    supportsInactive: false,
    supportsArchive: false,
    dependencies: [
      { type: 'ticket', table: 'tickets', foreignKey: 'priority_id', label: 'ticket' },
      { type: 'board_default', table: 'boards', foreignKey: 'default_priority_id', label: 'board default priority' }
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
