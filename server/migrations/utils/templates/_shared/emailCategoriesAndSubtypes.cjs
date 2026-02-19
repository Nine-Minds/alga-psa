/**
 * Source of truth for email notification categories and subtypes.
 *
 * Used by migrations and seeds to ensure categories and subtypes exist
 * before inserting email templates.
 */

const CATEGORIES = [
  { name: 'Tickets', description: 'Notifications related to support tickets', is_enabled: true, is_default_enabled: true },
  { name: 'Invoices', description: 'Notifications related to billing and invoices', is_enabled: true, is_default_enabled: true },
  { name: 'Projects', description: 'Notifications related to project updates', is_enabled: true, is_default_enabled: true },
  { name: 'Time Entries', description: 'Notifications related to time tracking and approvals', is_enabled: true, is_default_enabled: true },
  { name: 'Surveys', description: 'Customer satisfaction surveys and feedback loops', is_enabled: true, is_default_enabled: true },
  { name: 'User Account', description: 'Authentication and account-related notifications (password reset, email verification, etc.)', is_enabled: true, is_default_enabled: true },
  { name: 'Authentication', description: 'Authentication and security notifications', is_enabled: true, is_default_enabled: true },
  { name: 'Appointments', description: 'Appointment request and scheduling notifications', is_enabled: true, is_default_enabled: true },
  { name: 'SLA', description: 'SLA-related email notifications', is_enabled: true, is_default_enabled: true },
];

const SUBTYPES = [
  // Tickets
  { category: 'Tickets', name: 'Ticket Created', description: 'When a new ticket is created' },
  { category: 'Tickets', name: 'Ticket Updated', description: 'When a ticket is modified' },
  { category: 'Tickets', name: 'Ticket Closed', description: 'When a ticket is closed' },
  { category: 'Tickets', name: 'Ticket Assigned', description: 'When a ticket is assigned to a user' },
  { category: 'Tickets', name: 'Ticket Comment Added', description: 'When a comment is added to a ticket' },
  // Surveys
  { category: 'Surveys', name: 'survey-ticket-closed', description: 'When a customer satisfaction survey invitation is sent after a ticket is closed' },
  // Invoices
  { category: 'Invoices', name: 'Invoice Generated', description: 'When a new invoice is generated' },
  { category: 'Invoices', name: 'Invoice Email', description: 'Email sent to client with invoice attached' },
  { category: 'Invoices', name: 'Payment Received', description: 'When a payment is received' },
  { category: 'Invoices', name: 'Payment Overdue', description: 'When an invoice payment is overdue' },
  { category: 'Invoices', name: 'Credit Expiring', description: 'When credits are about to expire' },
  // Projects
  { category: 'Projects', name: 'Project Created', description: 'When a new project is created' },
  { category: 'Projects', name: 'Project Updated', description: 'When a project is modified' },
  { category: 'Projects', name: 'Project Closed', description: 'When a project is closed' },
  { category: 'Projects', name: 'Project Assigned', description: 'When a project is assigned to a user' },
  { category: 'Projects', name: 'Project Task Assigned', description: 'When a project task is assigned to a user' },
  { category: 'Projects', name: 'Task Updated', description: 'When a project task is updated' },
  { category: 'Projects', name: 'Milestone Completed', description: 'When a project milestone is completed' },
  // Time Entries
  { category: 'Time Entries', name: 'Time Entry Submitted', description: 'When time entries are submitted for approval' },
  { category: 'Time Entries', name: 'Time Entry Approved', description: 'When time entries are approved' },
  { category: 'Time Entries', name: 'Time Entry Rejected', description: 'When time entries are rejected' },
  // Authentication
  { category: 'Authentication', name: 'email-verification', description: 'Email verification instructions for new users' },
  { category: 'Authentication', name: 'password-reset', description: 'Password reset instructions for users' },
  { category: 'Authentication', name: 'portal-invitation', description: 'Invitation email for customer portal access' },
  { category: 'Authentication', name: 'tenant-recovery', description: 'Tenant/organization account recovery and login links' },
  { category: 'Authentication', name: 'no-account-found', description: 'Notification when no account is found for email address' },
  // Appointments
  { category: 'Appointments', name: 'appointment-request-received', description: 'Confirmation that appointment request was received' },
  { category: 'Appointments', name: 'appointment-request-approved', description: 'Notification that appointment request was approved' },
  { category: 'Appointments', name: 'appointment-request-declined', description: 'Notification that appointment request was declined' },
  { category: 'Appointments', name: 'new-appointment-request', description: 'New appointment request notification for MSP staff' },
  { category: 'Appointments', name: 'appointment-assigned-technician', description: 'Notification to technician when assigned to an approved appointment' },
  // SLA
  { category: 'SLA', name: 'SLA Warning', description: 'SLA threshold warning email (approaching breach)' },
  { category: 'SLA', name: 'SLA Breach', description: 'SLA breach notification email' },
  { category: 'SLA', name: 'SLA Escalation', description: 'Ticket escalation due to SLA' },
];

/**
 * Upsert all email notification categories and subtypes.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
async function upsertEmailCategoriesAndSubtypes(knex) {
  // Upsert categories
  for (const category of CATEGORIES) {
    await knex('notification_categories')
      .insert(category)
      .onConflict('name')
      .merge({
        description: knex.raw('excluded.description'),
        is_enabled: knex.raw('excluded.is_enabled'),
        is_default_enabled: knex.raw('excluded.is_default_enabled'),
      });
  }

  // Get all categories for FK lookup
  const allCategories = await knex('notification_categories').select('id', 'name');
  const categoryMap = allCategories.reduce((acc, cat) => {
    acc[cat.name] = cat.id;
    return acc;
  }, {});

  // Upsert subtypes
  for (const subtype of SUBTYPES) {
    const categoryId = categoryMap[subtype.category];
    if (!categoryId) {
      console.warn(`[upsertEmailCategoriesAndSubtypes] Category '${subtype.category}' not found, skipping subtype '${subtype.name}'`);
      continue;
    }

    await knex('notification_subtypes')
      .insert({
        category_id: categoryId,
        name: subtype.name,
        description: subtype.description,
        is_enabled: true,
        is_default_enabled: true,
      })
      .onConflict(['category_id', 'name'])
      .merge({
        description: knex.raw('excluded.description'),
        is_enabled: knex.raw('excluded.is_enabled'),
        is_default_enabled: knex.raw('excluded.is_default_enabled'),
      });
  }
}

module.exports = { CATEGORIES, SUBTYPES, upsertEmailCategoriesAndSubtypes };
