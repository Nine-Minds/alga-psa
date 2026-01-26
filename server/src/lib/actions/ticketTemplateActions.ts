'use server'

import { createTenantKnex } from 'server/src/lib/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import {
  ITicketTemplate,
  CreateTicketTemplateInput,
  UpdateTicketTemplateInput,
  TicketTemplateFilters,
  AppliedTemplateData,
  ITILTemplateDefinition
} from 'server/src/interfaces/ticketTemplate.interfaces';

/**
 * Parse JSONB fields from database row
 */
function parseTemplateRow(row: any): ITicketTemplate {
  return {
    ...row,
    default_values: row.default_values
      ? (typeof row.default_values === 'string' ? JSON.parse(row.default_values) : row.default_values)
      : {},
    custom_field_defaults: row.custom_field_defaults
      ? (typeof row.custom_field_defaults === 'string' ? JSON.parse(row.custom_field_defaults) : row.custom_field_defaults)
      : {},
    required_fields: row.required_fields
      ? (typeof row.required_fields === 'string' ? JSON.parse(row.required_fields) : row.required_fields)
      : [],
    field_layout: row.field_layout
      ? (typeof row.field_layout === 'string' ? JSON.parse(row.field_layout) : row.field_layout)
      : {},
    itil_config: row.itil_config
      ? (typeof row.itil_config === 'string' ? JSON.parse(row.itil_config) : row.itil_config)
      : null
  };
}

/**
 * Get all ticket templates with optional filters
 */
export async function getTicketTemplates(
  filters?: TicketTemplateFilters
): Promise<ITicketTemplate[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  let query = knex('ticket_templates')
    .where({ tenant })
    .orderBy('display_order', 'asc')
    .orderBy('name', 'asc');

  if (filters) {
    if (filters.board_id) {
      query = query.where('board_id', filters.board_id);
    }
    if (filters.category_id) {
      query = query.where('category_id', filters.category_id);
    }
    if (filters.template_type) {
      query = query.where('template_type', filters.template_type);
    }
    if (filters.is_active !== undefined) {
      query = query.where('is_active', filters.is_active);
    }
  }

  const templates = await query;
  return templates.map(parseTemplateRow);
}

/**
 * Get a single ticket template by ID
 */
export async function getTicketTemplateById(
  templateId: string
): Promise<ITicketTemplate | null> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const template = await knex('ticket_templates')
    .where({ tenant, template_id: templateId })
    .first();

  if (!template) {
    return null;
  }

  return parseTemplateRow(template);
}

/**
 * Create a new ticket template
 */
export async function createTicketTemplate(
  input: CreateTicketTemplateInput
): Promise<ITicketTemplate> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Check permission - using 'settings' resource for admin operations
  if (!await hasPermission(currentUser, 'settings', 'update')) {
    throw new Error('Permission denied: Cannot create ticket templates');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  // Get max display_order
  const maxOrderResult = await knex('ticket_templates')
    .where({ tenant })
    .max('display_order as max_order')
    .first();

  const nextOrder = input.display_order ?? ((maxOrderResult?.max_order ?? -1) + 1);

  const newTemplate = {
    tenant,
    name: input.name,
    description: input.description ?? null,
    template_type: input.template_type ?? 'custom',
    board_id: input.board_id ?? null,
    category_id: input.category_id ?? null,
    default_values: JSON.stringify(input.default_values ?? {}),
    custom_field_defaults: JSON.stringify(input.custom_field_defaults ?? {}),
    required_fields: JSON.stringify(input.required_fields ?? []),
    field_layout: JSON.stringify(input.field_layout ?? {}),
    itil_config: input.itil_config ? JSON.stringify(input.itil_config) : null,
    is_active: true,
    display_order: nextOrder,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const [created] = await knex('ticket_templates')
    .insert(newTemplate)
    .returning('*');

  return parseTemplateRow(created);
}

/**
 * Update an existing ticket template
 */
export async function updateTicketTemplate(
  templateId: string,
  input: UpdateTicketTemplateInput
): Promise<ITicketTemplate> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Check permission
  if (!await hasPermission(currentUser, 'settings', 'update')) {
    throw new Error('Permission denied: Cannot update ticket templates');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  // Verify template exists
  const existing = await knex('ticket_templates')
    .where({ tenant, template_id: templateId })
    .first();

  if (!existing) {
    throw new Error('Template not found');
  }

  const updateData: Record<string, any> = {
    updated_at: new Date().toISOString()
  };

  if (input.name !== undefined) updateData.name = input.name;
  if (input.description !== undefined) updateData.description = input.description;
  if (input.template_type !== undefined) updateData.template_type = input.template_type;
  if (input.board_id !== undefined) updateData.board_id = input.board_id;
  if (input.category_id !== undefined) updateData.category_id = input.category_id;
  if (input.default_values !== undefined) updateData.default_values = JSON.stringify(input.default_values);
  if (input.custom_field_defaults !== undefined) updateData.custom_field_defaults = JSON.stringify(input.custom_field_defaults);
  if (input.required_fields !== undefined) updateData.required_fields = JSON.stringify(input.required_fields);
  if (input.field_layout !== undefined) updateData.field_layout = JSON.stringify(input.field_layout);
  if (input.itil_config !== undefined) updateData.itil_config = input.itil_config ? JSON.stringify(input.itil_config) : null;
  if (input.is_active !== undefined) updateData.is_active = input.is_active;
  if (input.display_order !== undefined) updateData.display_order = input.display_order;

  const [updated] = await knex('ticket_templates')
    .where({ tenant, template_id: templateId })
    .update(updateData)
    .returning('*');

  return parseTemplateRow(updated);
}

/**
 * Delete a ticket template
 */
export async function deleteTicketTemplate(templateId: string): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Check permission
  if (!await hasPermission(currentUser, 'settings', 'delete')) {
    throw new Error('Permission denied: Cannot delete ticket templates');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  await knex('ticket_templates')
    .where({ tenant, template_id: templateId })
    .delete();
}

/**
 * Duplicate an existing ticket template
 */
export async function duplicateTicketTemplate(
  templateId: string,
  newName: string
): Promise<ITicketTemplate> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Check permission
  if (!await hasPermission(currentUser, 'settings', 'update')) {
    throw new Error('Permission denied: Cannot duplicate ticket templates');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  // Get original template
  const original = await knex('ticket_templates')
    .where({ tenant, template_id: templateId })
    .first();

  if (!original) {
    throw new Error('Template not found');
  }

  // Get max display_order
  const maxOrderResult = await knex('ticket_templates')
    .where({ tenant })
    .max('display_order as max_order')
    .first();

  const nextOrder = (maxOrderResult?.max_order ?? -1) + 1;

  // Create duplicate (always as custom type)
  const newTemplate = {
    tenant,
    name: newName,
    description: original.description,
    template_type: 'custom', // Duplicates are always custom
    board_id: original.board_id,
    category_id: original.category_id,
    default_values: original.default_values,
    custom_field_defaults: original.custom_field_defaults,
    required_fields: original.required_fields,
    field_layout: original.field_layout,
    itil_config: original.itil_config,
    is_active: true,
    display_order: nextOrder,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const [created] = await knex('ticket_templates')
    .insert(newTemplate)
    .returning('*');

  return parseTemplateRow(created);
}

/**
 * Apply a template to a ticket form - returns the data needed to pre-fill the form
 */
export async function applyTemplateToTicketForm(
  templateId: string
): Promise<AppliedTemplateData> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const template = await knex('ticket_templates')
    .where({ tenant, template_id: templateId, is_active: true })
    .first();

  if (!template) {
    throw new Error('Template not found or inactive');
  }

  const parsed = parseTemplateRow(template);

  return {
    default_values: parsed.default_values,
    custom_field_defaults: parsed.custom_field_defaults,
    required_fields: parsed.required_fields,
    field_layout: parsed.field_layout,
    itil_config: parsed.itil_config
  };
}

/**
 * Update the display order of multiple templates
 */
export async function updateTemplateDisplayOrder(
  orders: { templateId: string; order: number }[]
): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Check permission
  if (!await hasPermission(currentUser, 'settings', 'update')) {
    throw new Error('Permission denied: Cannot reorder ticket templates');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  // Update each template's display_order
  await Promise.all(
    orders.map(({ templateId, order }) =>
      knex('ticket_templates')
        .where({ tenant, template_id: templateId })
        .update({ display_order: order, updated_at: new Date().toISOString() })
    )
  );
}

/**
 * Pre-built ITIL template definitions
 */
const ITIL_TEMPLATE_DEFINITIONS: ITILTemplateDefinition[] = [
  {
    name: 'New Hire Onboarding',
    description: 'Standard process for setting up a new employee with equipment, accounts, and access.',
    itil_category: 'Service Request',
    default_values: {
      title: 'New Hire Onboarding: [Employee Name]',
      description: `## New Employee Information
- **Employee Name:**
- **Start Date:**
- **Department:**
- **Manager:**
- **Job Title:**

## Required Equipment
- [ ] Laptop
- [ ] Monitor(s)
- [ ] Keyboard/Mouse
- [ ] Headset
- [ ] Phone

## Account Setup
- [ ] Email/Microsoft 365
- [ ] Active Directory
- [ ] VPN Access
- [ ] Department-specific applications

## Orientation
- [ ] IT Security Training scheduled
- [ ] Building access card issued
- [ ] Parking assigned`,
      itil_impact: 3,
      itil_urgency: 3
    },
    checklist_items: [
      'Verify employee start date with HR',
      'Order required hardware',
      'Create Active Directory account',
      'Set up email account',
      'Configure VPN access',
      'Install required software',
      'Prepare workstation',
      'Schedule orientation meeting',
      'Issue building access card',
      'Document handoff to employee'
    ],
    custom_fields: [
      { name: 'Employee Name', type: 'text', required: true },
      { name: 'Start Date', type: 'date', required: true },
      { name: 'Department', type: 'picklist', required: true, options: ['Engineering', 'Sales', 'Marketing', 'Finance', 'HR', 'Operations', 'Support'] },
      { name: 'Equipment Type', type: 'picklist', required: true, options: ['Standard Laptop', 'Developer Workstation', 'Executive Setup', 'Remote Worker Kit'] }
    ]
  },
  {
    name: 'Employee Offboarding',
    description: 'Standard process for revoking access and collecting equipment when an employee leaves.',
    itil_category: 'Service Request',
    default_values: {
      title: 'Employee Offboarding: [Employee Name]',
      description: `## Employee Information
- **Employee Name:**
- **Last Working Day:**
- **Department:**
- **Manager:**

## Access Revocation
- [ ] Disable Active Directory account
- [ ] Disable email account
- [ ] Revoke VPN access
- [ ] Remove from all distribution groups
- [ ] Revoke application access

## Equipment Collection
- [ ] Laptop returned
- [ ] Monitors returned
- [ ] Access cards collected
- [ ] Company phone returned

## Data Handling
- [ ] Email forwarding configured (if needed)
- [ ] Files transferred to manager
- [ ] Shared drives access reviewed`,
      itil_impact: 3,
      itil_urgency: 2
    },
    checklist_items: [
      'Verify last working day with HR',
      'Disable all accounts on last day',
      'Revoke building access',
      'Collect all equipment',
      'Transfer mailbox access to manager',
      'Archive user data per retention policy',
      'Update documentation'
    ],
    custom_fields: [
      { name: 'Employee Name', type: 'text', required: true },
      { name: 'Last Working Day', type: 'date', required: true },
      { name: 'Offboarding Type', type: 'picklist', required: true, options: ['Resignation', 'Termination', 'Retirement', 'Contract End'] }
    ]
  },
  {
    name: 'Change Request',
    description: 'ITIL standard change request for infrastructure or application modifications.',
    itil_category: 'Change',
    default_values: {
      title: 'Change Request: [Brief Description]',
      description: `## Change Summary
**What is being changed:**

**Why is this change needed:**

**Business justification:**

## Change Details
- **Planned Start:**
- **Planned End:**
- **Change Window:**

## Impact Assessment
- **Systems Affected:**
- **Users Affected:**
- **Downtime Expected:**

## Rollback Plan
**Steps to rollback if change fails:**
1.
2.
3.

## Testing Plan
**How will the change be verified:**`,
      itil_impact: 2,
      itil_urgency: 3
    },
    checklist_items: [
      'Complete impact assessment',
      'Document rollback plan',
      'Notify affected users',
      'Schedule change window',
      'Obtain CAB approval',
      'Execute change',
      'Verify change success',
      'Update documentation',
      'Close change record'
    ],
    suggested_resolution_steps: [
      'Review and validate change request details',
      'Assess risk and impact',
      'Create rollback plan',
      'Schedule CAB review',
      'Communicate to stakeholders',
      'Execute during approved window',
      'Verify and document results'
    ],
    custom_fields: [
      { name: 'Change Type', type: 'picklist', required: true, options: ['Standard', 'Normal', 'Emergency'] },
      { name: 'Risk Level', type: 'picklist', required: true, options: ['Low', 'Medium', 'High', 'Critical'] },
      { name: 'Planned Start Date', type: 'date', required: true },
      { name: 'CAB Approval', type: 'boolean', required: false }
    ]
  },
  {
    name: 'Incident Report',
    description: 'ITIL incident management for service disruptions or degradation.',
    itil_category: 'Incident',
    default_values: {
      title: 'Incident: [Brief Description]',
      description: `## Incident Summary
**What happened:**

**When was it first reported:**

**Current Status:**

## Impact
- **Services Affected:**
- **Users Affected:**
- **Business Impact:**

## Timeline
| Time | Event |
|------|-------|
|      | Incident reported |
|      | Investigation started |
|      |  |

## Workaround
**Temporary solution (if any):**`,
      itil_impact: 2,
      itil_urgency: 2
    },
    checklist_items: [
      'Log incident details',
      'Categorize and prioritize',
      'Initial diagnosis',
      'Escalate if needed',
      'Investigate root cause',
      'Implement resolution',
      'Verify service restoration',
      'Document resolution',
      'User confirmation'
    ],
    custom_fields: [
      { name: 'Affected System', type: 'text', required: true },
      { name: 'Number of Users Affected', type: 'number', required: false },
      { name: 'Service Restored', type: 'boolean', required: false }
    ]
  },
  {
    name: 'Problem Investigation',
    description: 'ITIL problem management for investigating root causes of recurring incidents.',
    itil_category: 'Problem',
    default_values: {
      title: 'Problem: [Brief Description]',
      description: `## Problem Summary
**Problem Statement:**

**Related Incidents:**
- INC-
- INC-

## Root Cause Analysis
**Investigation Method:** [ ] 5 Whys [ ] Fishbone [ ] Fault Tree [ ] Other

**Findings:**

## Known Error
**Workaround:**

**Permanent Fix:**

## Action Items
| Action | Owner | Due Date | Status |
|--------|-------|----------|--------|
|        |       |          |        |`,
      itil_impact: 2,
      itil_urgency: 4
    },
    checklist_items: [
      'Link related incidents',
      'Perform root cause analysis',
      'Document known error',
      'Define workaround',
      'Plan permanent fix',
      'Implement fix via change request',
      'Verify fix effectiveness',
      'Update knowledge base'
    ],
    suggested_resolution_steps: [
      'Gather incident data',
      'Identify patterns',
      'Conduct RCA session',
      'Document known error',
      'Implement workaround',
      'Create change request for permanent fix',
      'Monitor after fix implementation'
    ],
    custom_fields: [
      { name: 'Root Cause Category', type: 'picklist', required: false, options: ['Hardware', 'Software', 'Network', 'Configuration', 'Human Error', 'External', 'Unknown'] },
      { name: 'Known Error', type: 'boolean', required: false },
      { name: 'Permanent Fix Implemented', type: 'boolean', required: false }
    ]
  },
  {
    name: 'Password Reset Request',
    description: 'Standard service request for password resets.',
    itil_category: 'Service Request',
    default_values: {
      title: 'Password Reset: [User Name]',
      description: `## User Information
- **Username:**
- **System:** [ ] AD/Windows [ ] Email [ ] VPN [ ] Application: ___

## Verification
Identity verified via: [ ] Manager approval [ ] Security questions [ ] In-person with ID`,
      itil_impact: 4,
      itil_urgency: 3
    },
    checklist_items: [
      'Verify user identity',
      'Reset password',
      'Force password change at next login',
      'Notify user securely'
    ],
    custom_fields: [
      { name: 'System', type: 'picklist', required: true, options: ['Active Directory', 'Email', 'VPN', 'ERP', 'CRM', 'Other'] },
      { name: 'Verification Method', type: 'picklist', required: true, options: ['Manager Approval', 'Security Questions', 'In-Person ID Check'] }
    ]
  },
  {
    name: 'Software Installation Request',
    description: 'Request for software installation or license assignment.',
    itil_category: 'Service Request',
    default_values: {
      title: 'Software Request: [Software Name]',
      description: `## Request Details
- **Software Name:**
- **Version (if specific):**
- **Business Justification:**

## User Information
- **Requested For:**
- **Computer Name:**
- **Department:**

## Approval
- [ ] Manager Approved
- [ ] License Available
- [ ] Compatible with standards`,
      itil_impact: 4,
      itil_urgency: 4
    },
    checklist_items: [
      'Verify software is approved',
      'Check license availability',
      'Verify system compatibility',
      'Obtain manager approval',
      'Install software',
      'Verify installation',
      'Update asset inventory'
    ],
    custom_fields: [
      { name: 'Software Name', type: 'text', required: true },
      { name: 'License Type', type: 'picklist', required: false, options: ['Per User', 'Per Device', 'Site License', 'Open Source', 'Trial'] },
      { name: 'Manager Approved', type: 'boolean', required: true }
    ]
  },
  {
    name: 'Hardware Request',
    description: 'Request for new hardware or equipment.',
    itil_category: 'Service Request',
    default_values: {
      title: 'Hardware Request: [Equipment Type]',
      description: `## Request Details
- **Equipment Type:**
- **Quantity:**
- **Business Justification:**

## User Information
- **Requested For:**
- **Location:**
- **Department:**

## Specifications
**Required specifications or preferences:**

## Approval
- [ ] Manager Approved
- [ ] Budget Approved`,
      itil_impact: 4,
      itil_urgency: 4
    },
    checklist_items: [
      'Verify business need',
      'Obtain manager approval',
      'Check budget availability',
      'Create purchase request',
      'Track order',
      'Receive and asset tag',
      'Configure equipment',
      'Deploy to user',
      'Update asset inventory'
    ],
    custom_fields: [
      { name: 'Equipment Type', type: 'picklist', required: true, options: ['Laptop', 'Desktop', 'Monitor', 'Keyboard/Mouse', 'Headset', 'Phone', 'Printer', 'Other'] },
      { name: 'Urgency', type: 'picklist', required: true, options: ['Standard (2-3 weeks)', 'Expedited (1 week)', 'Emergency (immediate)'] },
      { name: 'Budget Code', type: 'text', required: false }
    ]
  }
];

/**
 * Seed ITIL templates for a tenant
 * This creates the pre-built ITIL templates if they don't exist
 */
export async function seedITILTemplates(): Promise<{ created: number; skipped: number }> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Check permission
  if (!await hasPermission(currentUser, 'settings', 'update')) {
    throw new Error('Permission denied: Cannot seed ITIL templates');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  let created = 0;
  let skipped = 0;

  for (let i = 0; i < ITIL_TEMPLATE_DEFINITIONS.length; i++) {
    const def = ITIL_TEMPLATE_DEFINITIONS[i];

    // Check if template with same name already exists
    const existing = await knex('ticket_templates')
      .where({ tenant, name: def.name, template_type: 'itil' })
      .first();

    if (existing) {
      skipped++;
      continue;
    }

    // Create the template
    const template = {
      tenant,
      name: def.name,
      description: def.description,
      template_type: 'itil',
      board_id: null,
      category_id: null,
      default_values: JSON.stringify(def.default_values),
      custom_field_defaults: JSON.stringify({}),
      required_fields: JSON.stringify([]),
      field_layout: JSON.stringify({}),
      itil_config: JSON.stringify({
        default_impact: def.default_values.itil_impact,
        default_urgency: def.default_values.itil_urgency,
        checklist_items: def.checklist_items ?? [],
        suggested_resolution_steps: def.suggested_resolution_steps ?? [],
        itil_category: def.itil_category
      }),
      is_active: true,
      display_order: i,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    await knex('ticket_templates').insert(template);
    created++;
  }

  return { created, skipped };
}

/**
 * Get templates available for a specific board
 * Returns both board-specific templates and global templates (no board_id)
 */
export async function getTemplatesForBoard(
  boardId: string
): Promise<ITicketTemplate[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const templates = await knex('ticket_templates')
    .where({ tenant, is_active: true })
    .where(function() {
      this.where('board_id', boardId).orWhereNull('board_id');
    })
    .orderBy('display_order', 'asc')
    .orderBy('name', 'asc');

  return templates.map(parseTemplateRow);
}

/**
 * Toggle template active status
 */
export async function toggleTemplateActive(
  templateId: string,
  isActive: boolean
): Promise<ITicketTemplate> {
  return updateTicketTemplate(templateId, { is_active: isActive });
}
