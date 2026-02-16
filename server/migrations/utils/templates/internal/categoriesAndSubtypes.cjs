/**
 * Source of truth for internal notification categories and subtypes.
 *
 * Used by migrations and seeds to ensure categories and subtypes exist
 * before inserting templates.
 */

const CATEGORIES = [
  { name: 'tickets', description: 'Ticket-related notifications', is_enabled: true, is_default_enabled: true },
  { name: 'projects', description: 'Project-related notifications', is_enabled: true, is_default_enabled: true },
  { name: 'invoices', description: 'Invoice and billing notifications', is_enabled: true, is_default_enabled: true },
  { name: 'system', description: 'System and administrative notifications', is_enabled: true, is_default_enabled: true },
  { name: 'messages', description: 'Direct messages and communication', is_enabled: true, is_default_enabled: true },
  { name: 'appointments', description: 'Appointment request and scheduling notifications', is_enabled: true, is_default_enabled: true },
];

const SUBTYPES = [
  // Tickets
  { category: 'tickets', name: 'ticket-assigned', description: 'Ticket assigned to user' },
  { category: 'tickets', name: 'ticket-created', description: 'New ticket created' },
  { category: 'tickets', name: 'ticket-updated', description: 'Ticket updated' },
  { category: 'tickets', name: 'ticket-closed', description: 'Ticket closed' },
  { category: 'tickets', name: 'ticket-comment-added', description: 'Comment added to ticket' },
  { category: 'tickets', name: 'ticket-status-changed', description: 'Ticket status changed' },
  { category: 'tickets', name: 'ticket-priority-changed', description: 'Ticket priority changed' },
  { category: 'tickets', name: 'ticket-reassigned', description: 'Ticket reassigned to different user' },
  { category: 'tickets', name: 'ticket-additional-agent-assigned', description: 'User assigned as additional agent on ticket' },
  { category: 'tickets', name: 'ticket-additional-agent-added', description: 'Additional agent added to ticket (for primary assignee)' },
  // Projects
  { category: 'projects', name: 'project-assigned', description: 'Project assigned to user' },
  { category: 'projects', name: 'project-created', description: 'New project created' },
  { category: 'projects', name: 'task-assigned', description: 'Task assigned to user' },
  { category: 'projects', name: 'task-comment-added', description: 'Comment added to task' },
  { category: 'projects', name: 'milestone-completed', description: 'Project milestone completed' },
  { category: 'projects', name: 'task-additional-agent-assigned', description: 'User assigned as additional agent on task' },
  { category: 'projects', name: 'task-additional-agent-added', description: 'Additional agent added to task (for primary assignee)' },
  // Invoices
  { category: 'invoices', name: 'invoice-generated', description: 'New invoice generated' },
  { category: 'invoices', name: 'payment-received', description: 'Payment received for invoice' },
  { category: 'invoices', name: 'payment-overdue', description: 'Payment is overdue' },
  // System
  { category: 'system', name: 'system-announcement', description: 'System announcement' },
  { category: 'system', name: 'user-mentioned', description: 'User mentioned in comment or note' },
  // Messages
  { category: 'messages', name: 'message-sent', description: 'Direct message received' },
  // Appointments
  { category: 'appointments', name: 'appointment-request-created', description: 'New appointment request submitted' },
  { category: 'appointments', name: 'appointment-request-approved', description: 'Appointment request approved' },
  { category: 'appointments', name: 'appointment-request-declined', description: 'Appointment request declined' },
  { category: 'appointments', name: 'appointment-request-cancelled', description: 'Appointment request cancelled' },
];

/**
 * Upsert all categories and subtypes, returning a lookup function.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<{getSubtypeId: (name: string) => number}>}
 */
async function upsertCategoriesAndSubtypes(knex) {
  // Upsert categories
  const categories = await knex('internal_notification_categories')
    .insert(CATEGORIES)
    .onConflict('name')
    .merge({
      description: knex.raw('excluded.description'),
      is_enabled: knex.raw('excluded.is_enabled'),
      is_default_enabled: knex.raw('excluded.is_default_enabled'),
    })
    .returning('*');

  const getCategoryId = (name) => {
    const cat = categories.find(c => c.name === name);
    if (!cat) throw new Error(`Category '${name}' not found`);
    return cat.internal_notification_category_id;
  };

  // Upsert subtypes
  const subtypeRows = SUBTYPES.map(s => ({
    internal_category_id: getCategoryId(s.category),
    name: s.name,
    description: s.description,
    is_enabled: true,
    is_default_enabled: true,
  }));

  const subtypes = await knex('internal_notification_subtypes')
    .insert(subtypeRows)
    .onConflict(['internal_category_id', 'name'])
    .merge({
      description: knex.raw('excluded.description'),
      is_enabled: knex.raw('excluded.is_enabled'),
      is_default_enabled: knex.raw('excluded.is_default_enabled'),
    })
    .returning('*');

  const getSubtypeId = (name) => {
    const s = subtypes.find(sub => sub.name === name);
    if (!s) throw new Error(`Subtype '${name}' not found`);
    return s.internal_notification_subtype_id;
  };

  return { getSubtypeId };
}

module.exports = { CATEGORIES, SUBTYPES, upsertCategoriesAndSubtypes };
