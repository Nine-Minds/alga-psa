/**
 * Seed the "Active Directory to Microsoft 365 Migration" project template for new tenants
 *
 * NOTE: estimated_hours is stored in MINUTES (not hours) in the database
 */
const { v4: uuidv4 } = require('uuid');

const TEMPLATE_NAME = 'Active Directory to Microsoft 365 Migration';
const TEMPLATE_CATEGORY = 'Migration';
const TEMPLATE_DESCRIPTION = 'Standard template for migrating from on-premises Active Directory to Azure AD/Entra ID with Microsoft 365. Covers assessment, environment preparation, migration execution, and validation.';

// Standard status names for lookup
const STATUS_NAMES = ['To Do', 'In Progress', 'Blocked', 'Done'];

// Standard status colors (used when creating mappings)
const STATUS_COLORS = {
  'To Do': '#6B7280',
  'In Progress': '#3B82F6',
  'Blocked': '#EF4444',
  'Done': '#10B981'
};

/**
 * Convert hours to minutes for database storage
 */
const hoursToMinutes = (hours) => Math.round(hours * 60);

/**
 * Build the template data structure
 * Using fractional indexing for order_key (a0, a1, a2, etc.)
 * NOTE: estimated_hours values are in MINUTES
 * @param {string} tenant - Tenant ID
 * @param {string} templateId - Template ID
 * @param {Map<string, string>} statusMappingsByName - Map of status name to mapping ID
 */
function buildTemplateData(tenant, templateId, statusMappingsByName) {
  // Phase IDs
  const phase1Id = uuidv4();
  const phase2Id = uuidv4();
  const phase3Id = uuidv4();
  const phase4Id = uuidv4();

  // Task IDs (named for checklist references)
  const task1_1_Id = uuidv4(); // Audit AD structure
  const task1_2_Id = uuidv4(); // Document group policies
  const task1_3_Id = uuidv4(); // Inventory applications
  const task1_4_Id = uuidv4(); // Define migration approach
  const task1_5_Id = uuidv4(); // Create communication plan
  const task2_1_Id = uuidv4(); // Configure M365 tenant
  const task2_2_Id = uuidv4(); // Set up Azure AD Connect
  const task2_3_Id = uuidv4(); // Configure SSO
  const task2_4_Id = uuidv4(); // Set up Conditional Access
  const task2_5_Id = uuidv4(); // Test pilot user sync
  const task3_1_Id = uuidv4(); // Migrate pilot group
  const task3_2_Id = uuidv4(); // Execute phased migration
  const task3_3_Id = uuidv4(); // Migrate security groups
  const task3_4_Id = uuidv4(); // Reconfigure app auth
  const task3_5_Id = uuidv4(); // Update DNS
  const task4_1_Id = uuidv4(); // Verify authentication
  const task4_2_Id = uuidv4(); // Test app access
  const task4_3_Id = uuidv4(); // User training
  const task4_4_Id = uuidv4(); // Document environment
  const task4_5_Id = uuidv4(); // Decommission AD

  // Get status mapping for "To Do" by name (not by index)
  const toDoStatusMappingId = statusMappingsByName.get('To Do');

  const phases = [
    {
      tenant,
      template_phase_id: phase1Id,
      template_id: templateId,
      phase_name: 'Assessment & Planning',
      description: 'Audit current AD environment and plan the migration approach',
      duration_days: 5,
      start_offset_days: 0,
      order_key: 'a0'
    },
    {
      tenant,
      template_phase_id: phase2Id,
      template_id: templateId,
      phase_name: 'Environment Preparation',
      description: 'Configure M365 tenant and set up synchronization',
      duration_days: 5,
      start_offset_days: 5,
      order_key: 'a1'
    },
    {
      tenant,
      template_phase_id: phase3Id,
      template_id: templateId,
      phase_name: 'Migration & Cutover',
      description: 'Execute phased user migration and reconfigure applications',
      duration_days: 7,
      start_offset_days: 10,
      order_key: 'a2'
    },
    {
      tenant,
      template_phase_id: phase4Id,
      template_id: templateId,
      phase_name: 'Validation & Cleanup',
      description: 'Verify migration success and decommission old infrastructure',
      duration_days: 5,
      start_offset_days: 17,
      order_key: 'a3'
    }
  ];

  const tasks = [
    // Phase 1: Assessment & Planning
    {
      tenant,
      template_task_id: task1_1_Id,
      template_phase_id: phase1Id,
      task_name: 'Audit current AD structure (users, groups, OUs)',
      description: 'Document all users, security groups, distribution lists, and organizational units in the current Active Directory environment.',
      estimated_hours: hoursToMinutes(3),
      duration_days: 1,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a0'
    },
    {
      tenant,
      template_task_id: task1_2_Id,
      template_phase_id: phase1Id,
      task_name: 'Document group policies and permissions',
      description: 'Review and document all GPOs, NTFS permissions, and security configurations that may need to be replicated or adjusted.',
      estimated_hours: hoursToMinutes(3),
      duration_days: 1,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a1'
    },
    {
      tenant,
      template_task_id: task1_3_Id,
      template_phase_id: phase1Id,
      task_name: 'Inventory applications with AD dependencies',
      description: 'Identify all applications that authenticate against AD or rely on AD attributes for authorization.',
      estimated_hours: hoursToMinutes(2),
      duration_days: 1,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a2'
    },
    {
      tenant,
      template_task_id: task1_4_Id,
      template_phase_id: phase1Id,
      task_name: 'Define migration approach (hybrid vs cloud-only)',
      description: 'Determine whether to use Azure AD Connect for hybrid identity or migrate to cloud-only authentication.',
      estimated_hours: hoursToMinutes(2),
      duration_days: 1,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a3'
    },
    {
      tenant,
      template_task_id: task1_5_Id,
      template_phase_id: phase1Id,
      task_name: 'Create user communication plan',
      description: 'Develop communications to inform users about the migration timeline, what to expect, and any actions they need to take.',
      estimated_hours: hoursToMinutes(1),
      duration_days: 1,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a4'
    },

    // Phase 2: Environment Preparation
    {
      tenant,
      template_task_id: task2_1_Id,
      template_phase_id: phase2Id,
      task_name: 'Configure M365 tenant and licenses',
      description: 'Set up the Microsoft 365 tenant, verify domain ownership, and assign appropriate licenses.',
      estimated_hours: hoursToMinutes(2),
      duration_days: 1,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a0'
    },
    {
      tenant,
      template_task_id: task2_2_Id,
      template_phase_id: phase2Id,
      task_name: 'Set up Azure AD Connect (if hybrid)',
      description: 'Install and configure Azure AD Connect for directory synchronization if using hybrid identity.',
      estimated_hours: hoursToMinutes(4),
      duration_days: 2,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a1'
    },
    {
      tenant,
      template_task_id: task2_3_Id,
      template_phase_id: phase2Id,
      task_name: 'Configure SSO and authentication methods',
      description: 'Set up single sign-on, configure authentication methods (password hash sync, pass-through auth, or federation).',
      estimated_hours: hoursToMinutes(3),
      duration_days: 1,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a2'
    },
    {
      tenant,
      template_task_id: task2_4_Id,
      template_phase_id: phase2Id,
      task_name: 'Set up Conditional Access policies',
      description: 'Configure Conditional Access policies for MFA, device compliance, and location-based access controls.',
      estimated_hours: hoursToMinutes(3),
      duration_days: 1,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a3'
    },
    {
      tenant,
      template_task_id: task2_5_Id,
      template_phase_id: phase2Id,
      task_name: 'Test pilot user sync',
      description: 'Sync a pilot group of users and verify that attributes, group memberships, and authentication work correctly.',
      estimated_hours: hoursToMinutes(2),
      duration_days: 1,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a4'
    },

    // Phase 3: Migration & Cutover
    {
      tenant,
      template_task_id: task3_1_Id,
      template_phase_id: phase3Id,
      task_name: 'Migrate pilot group and validate',
      description: 'Complete migration for pilot users, have them test all applications and workflows, and gather feedback.',
      estimated_hours: hoursToMinutes(3),
      duration_days: 1,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a0'
    },
    {
      tenant,
      template_task_id: task3_2_Id,
      template_phase_id: phase3Id,
      task_name: 'Execute phased user migration',
      description: 'Migrate remaining users in planned batches, monitoring for issues and adjusting as needed.',
      estimated_hours: hoursToMinutes(6),
      duration_days: 3,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a1'
    },
    {
      tenant,
      template_task_id: task3_3_Id,
      template_phase_id: phase3Id,
      task_name: 'Migrate security groups and permissions',
      description: 'Ensure all security groups are synced and permissions are correctly applied in Azure AD.',
      estimated_hours: hoursToMinutes(3),
      duration_days: 1,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a2'
    },
    {
      tenant,
      template_task_id: task3_4_Id,
      template_phase_id: phase3Id,
      task_name: 'Reconfigure application authentication',
      description: 'Update applications to authenticate against Azure AD instead of on-premises AD.',
      estimated_hours: hoursToMinutes(4),
      duration_days: 2,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a3'
    },
    {
      tenant,
      template_task_id: task3_5_Id,
      template_phase_id: phase3Id,
      task_name: 'Update DNS and domain federation',
      description: 'Update DNS records and complete domain federation configuration for seamless SSO.',
      estimated_hours: hoursToMinutes(2),
      duration_days: 1,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a4'
    },

    // Phase 4: Validation & Cleanup
    {
      tenant,
      template_task_id: task4_1_Id,
      template_phase_id: phase4Id,
      task_name: 'Verify all users can authenticate',
      description: 'Confirm all migrated users can successfully sign in using their new credentials.',
      estimated_hours: hoursToMinutes(2),
      duration_days: 1,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a0'
    },
    {
      tenant,
      template_task_id: task4_2_Id,
      template_phase_id: phase4Id,
      task_name: 'Test application access',
      description: 'Verify users can access all required applications with proper permissions.',
      estimated_hours: hoursToMinutes(2),
      duration_days: 1,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a1'
    },
    {
      tenant,
      template_task_id: task4_3_Id,
      template_phase_id: phase4Id,
      task_name: 'Conduct user training on new login process',
      description: 'Train users on the new authentication experience, including MFA enrollment if applicable.',
      estimated_hours: hoursToMinutes(2),
      duration_days: 1,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a2'
    },
    {
      tenant,
      template_task_id: task4_4_Id,
      template_phase_id: phase4Id,
      task_name: 'Document new environment',
      description: 'Update documentation to reflect the new Azure AD configuration, processes, and procedures.',
      estimated_hours: hoursToMinutes(2),
      duration_days: 1,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a3'
    },
    {
      tenant,
      template_task_id: task4_5_Id,
      template_phase_id: phase4Id,
      task_name: 'Decommission on-prem AD (if applicable)',
      description: 'If moving to cloud-only, safely decommission on-premises domain controllers after confirming all services are migrated.',
      estimated_hours: hoursToMinutes(3),
      duration_days: 2,
      template_status_mapping_id: toDoStatusMappingId,
      order_key: 'a4'
    }
  ];

  // Checklist items for key tasks
  const checklistItems = [
    // Audit AD structure checklist
    { tenant, template_checklist_id: uuidv4(), template_task_id: task1_1_Id, item_name: 'Export user list from AD', order_number: 1 },
    { tenant, template_checklist_id: uuidv4(), template_task_id: task1_1_Id, item_name: 'Document security groups and memberships', order_number: 2 },
    { tenant, template_checklist_id: uuidv4(), template_task_id: task1_1_Id, item_name: 'Document distribution lists', order_number: 3 },
    { tenant, template_checklist_id: uuidv4(), template_task_id: task1_1_Id, item_name: 'Map OU structure', order_number: 4 },
    { tenant, template_checklist_id: uuidv4(), template_task_id: task1_1_Id, item_name: 'Identify service accounts', order_number: 5 },

    // Configure M365 tenant checklist
    { tenant, template_checklist_id: uuidv4(), template_task_id: task2_1_Id, item_name: 'Verify domain ownership in M365 admin', order_number: 1 },
    { tenant, template_checklist_id: uuidv4(), template_task_id: task2_1_Id, item_name: 'Configure DNS records (MX, CNAME, TXT)', order_number: 2 },
    { tenant, template_checklist_id: uuidv4(), template_task_id: task2_1_Id, item_name: 'Assign licenses to pilot users', order_number: 3 },
    { tenant, template_checklist_id: uuidv4(), template_task_id: task2_1_Id, item_name: 'Configure tenant security defaults', order_number: 4 },

    // Azure AD Connect checklist
    { tenant, template_checklist_id: uuidv4(), template_task_id: task2_2_Id, item_name: 'Verify server meets prerequisites', order_number: 1 },
    { tenant, template_checklist_id: uuidv4(), template_task_id: task2_2_Id, item_name: 'Install Azure AD Connect', order_number: 2 },
    { tenant, template_checklist_id: uuidv4(), template_task_id: task2_2_Id, item_name: 'Configure sync filtering (OUs/groups)', order_number: 3 },
    { tenant, template_checklist_id: uuidv4(), template_task_id: task2_2_Id, item_name: 'Choose authentication method', order_number: 4 },
    { tenant, template_checklist_id: uuidv4(), template_task_id: task2_2_Id, item_name: 'Run initial sync and verify', order_number: 5 },

    // Conditional Access checklist
    { tenant, template_checklist_id: uuidv4(), template_task_id: task2_4_Id, item_name: 'Create MFA policy for all users', order_number: 1 },
    { tenant, template_checklist_id: uuidv4(), template_task_id: task2_4_Id, item_name: 'Configure trusted locations', order_number: 2 },
    { tenant, template_checklist_id: uuidv4(), template_task_id: task2_4_Id, item_name: 'Set up device compliance policy', order_number: 3 },
    { tenant, template_checklist_id: uuidv4(), template_task_id: task2_4_Id, item_name: 'Create break-glass admin account', order_number: 4 },

    // Pilot validation checklist
    { tenant, template_checklist_id: uuidv4(), template_task_id: task3_1_Id, item_name: 'Test user sign-in from various devices', order_number: 1 },
    { tenant, template_checklist_id: uuidv4(), template_task_id: task3_1_Id, item_name: 'Verify MFA enrollment works', order_number: 2 },
    { tenant, template_checklist_id: uuidv4(), template_task_id: task3_1_Id, item_name: 'Test access to key applications', order_number: 3 },
    { tenant, template_checklist_id: uuidv4(), template_task_id: task3_1_Id, item_name: 'Collect pilot user feedback', order_number: 4 },

    // Decommission AD checklist
    { tenant, template_checklist_id: uuidv4(), template_task_id: task4_5_Id, item_name: 'Verify no remaining AD dependencies', order_number: 1 },
    { tenant, template_checklist_id: uuidv4(), template_task_id: task4_5_Id, item_name: 'Backup AD before decommission', order_number: 2 },
    { tenant, template_checklist_id: uuidv4(), template_task_id: task4_5_Id, item_name: 'Demote domain controllers', order_number: 3 },
    { tenant, template_checklist_id: uuidv4(), template_task_id: task4_5_Id, item_name: 'Update documentation with new architecture', order_number: 4 }
  ];

  return { phases, tasks, checklistItems };
}

/**
 * Look up existing statuses and create status mappings for template
 * Statuses are created by 06_project_task_statuses.cjs seed
 * @returns {Promise<{mappings: Array, mappingsByName: Map<string, string>}>}
 */
async function getStatusMappings(knex, tenant, templateId) {
  const statusMappings = [];
  const statusMappingsByName = new Map();

  for (let i = 0; i < STATUS_NAMES.length; i++) {
    const statusName = STATUS_NAMES[i];
    const statusColor = STATUS_COLORS[statusName];

    // Look up existing status by name (case-insensitive)
    const status = await knex('statuses')
      .where({ tenant, status_type: 'project_task' })
      .whereRaw('LOWER(name) = LOWER(?)', [statusName])
      .first();

    if (!status) {
      console.log(`    Warning: Status "${statusName}" not found for tenant`);
      continue;
    }

    // Create status mapping for template
    const mappingId = uuidv4();
    statusMappings.push({
      tenant,
      template_status_mapping_id: mappingId,
      template_id: templateId,
      status_id: status.status_id,
      custom_status_name: null,
      custom_status_color: status.color || statusColor,
      display_order: i + 1
    });
    statusMappingsByName.set(statusName, mappingId);
  }

  return { mappings: statusMappings, mappingsByName: statusMappingsByName };
}

exports.seed = async function (knex, tenantId) {
  // Use provided tenantId or fall back to first tenant
  if (!tenantId) {
    const tenant = await knex('tenants').select('tenant').first();
    if (!tenant) {
      console.log('No tenant found, skipping AD to M365 project template seed');
      return;
    }
    tenantId = tenant.tenant;
  }

  // Check if this template already exists for the tenant
  const existing = await knex('project_templates')
    .where({
      tenant: tenantId,
      template_name: TEMPLATE_NAME
    })
    .first();

  if (existing) {
    console.log(`AD to M365 project template already exists for tenant ${tenantId}`);
    return;
  }

  // Generate template ID
  const templateId = uuidv4();

  // Get status mappings (statuses created by 06_project_task_statuses.cjs)
  const { mappings: statusMappings, mappingsByName: statusMappingsByName } =
    await getStatusMappings(knex, tenantId, templateId);

  // Insert in correct order: template first, then status mappings, then phases, then tasks, then checklists
  await knex('project_templates').insert({
    tenant: tenantId,
    template_id: templateId,
    template_name: TEMPLATE_NAME,
    description: TEMPLATE_DESCRIPTION,
    category: TEMPLATE_CATEGORY,
    created_by: null, // System-seeded template
    use_count: 0
  });

  await knex('project_template_status_mappings').insert(statusMappings);

  // Build and insert phases, tasks, and checklists
  const data = buildTemplateData(tenantId, templateId, statusMappingsByName);

  await knex('project_template_phases').insert(data.phases);
  await knex('project_template_tasks').insert(data.tasks);
  if (data.checklistItems && data.checklistItems.length > 0) {
    await knex('project_template_checklist_items').insert(data.checklistItems);
  }

  console.log(`Created AD to M365 project template for tenant ${tenantId}`);
};

// Disable transaction wrapper for Citus compatibility (large multi-table seeds)
exports.config = { transaction: false };
