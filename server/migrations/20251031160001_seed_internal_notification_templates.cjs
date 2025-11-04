/**
 * Seed internal notification categories, subtypes, and initial English templates
 */

exports.up = async function(knex) {
  console.log('Seeding internal notification categories, subtypes, and templates...');

  // 1. Insert categories
  const categories = await knex('internal_notification_categories')
    .insert([
      {
        name: 'tickets',
        description: 'Ticket-related notifications',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        name: 'projects',
        description: 'Project-related notifications',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        name: 'invoices',
        description: 'Invoice and billing notifications',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        name: 'system',
        description: 'System and administrative notifications',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        name: 'messages',
        description: 'Direct messages and communication',
        is_enabled: true,
        is_default_enabled: true
      }
    ])
    .onConflict('name')
    .merge({
      description: knex.raw('excluded.description')
    })
    .returning('*');

  // Get category IDs
  const ticketsCat = categories.find(c => c.name === 'tickets');
  const projectsCat = categories.find(c => c.name === 'projects');
  const invoicesCat = categories.find(c => c.name === 'invoices');
  const systemCat = categories.find(c => c.name === 'system');
  const messagesCat = categories.find(c => c.name === 'messages');

  // 2. Insert subtypes
  const subtypes = await knex('internal_notification_subtypes')
    .insert([
      // Ticket subtypes
      {
        internal_category_id: ticketsCat.internal_notification_category_id,
        name: 'ticket-assigned',
        description: 'Ticket assigned to user',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        internal_category_id: ticketsCat.internal_notification_category_id,
        name: 'ticket-created',
        description: 'New ticket created',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        internal_category_id: ticketsCat.internal_notification_category_id,
        name: 'ticket-updated',
        description: 'Ticket updated',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        internal_category_id: ticketsCat.internal_notification_category_id,
        name: 'ticket-closed',
        description: 'Ticket closed',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        internal_category_id: ticketsCat.internal_notification_category_id,
        name: 'ticket-comment-added',
        description: 'Comment added to ticket',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        internal_category_id: ticketsCat.internal_notification_category_id,
        name: 'ticket-status-changed',
        description: 'Ticket status changed',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        internal_category_id: ticketsCat.internal_notification_category_id,
        name: 'ticket-priority-changed',
        description: 'Ticket priority changed',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        internal_category_id: ticketsCat.internal_notification_category_id,
        name: 'ticket-reassigned',
        description: 'Ticket reassigned to different user',
        is_enabled: true,
        is_default_enabled: true
      },
      // Project subtypes
      {
        internal_category_id: projectsCat.internal_notification_category_id,
        name: 'project-assigned',
        description: 'Project assigned to user',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        internal_category_id: projectsCat.internal_notification_category_id,
        name: 'project-created',
        description: 'New project created',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        internal_category_id: projectsCat.internal_notification_category_id,
        name: 'task-assigned',
        description: 'Task assigned to user',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        internal_category_id: projectsCat.internal_notification_category_id,
        name: 'milestone-completed',
        description: 'Project milestone completed',
        is_enabled: true,
        is_default_enabled: true
      },
      // Invoice subtypes
      {
        internal_category_id: invoicesCat.internal_notification_category_id,
        name: 'invoice-generated',
        description: 'New invoice generated',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        internal_category_id: invoicesCat.internal_notification_category_id,
        name: 'payment-received',
        description: 'Payment received for invoice',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        internal_category_id: invoicesCat.internal_notification_category_id,
        name: 'payment-overdue',
        description: 'Payment is overdue',
        is_enabled: true,
        is_default_enabled: true
      },
      // System subtypes
      {
        internal_category_id: systemCat.internal_notification_category_id,
        name: 'system-announcement',
        description: 'System announcement',
        is_enabled: true,
        is_default_enabled: true
      },
      {
        internal_category_id: systemCat.internal_notification_category_id,
        name: 'user-mentioned',
        description: 'User mentioned in comment or note',
        is_enabled: true,
        is_default_enabled: true
      },
      // Message subtypes
      {
        internal_category_id: messagesCat.internal_notification_category_id,
        name: 'message-sent',
        description: 'Direct message received',
        is_enabled: true,
        is_default_enabled: true
      }
    ])
    .onConflict(['internal_category_id', 'name'])
    .merge({
      description: knex.raw('excluded.description')
    })
    .returning('*');

  const getSubtypeId = (name) => {
    const subtype = subtypes.find(s => s.name === name);
    if (!subtype) {
      throw new Error(`Internal notification subtype '${name}' not found`);
    }
    return subtype.internal_notification_subtype_id;
  };

  // 3. Insert English templates
  await knex('internal_notification_templates')
    .insert([
      // Ticket templates
      {
        name: 'ticket-assigned',
        language_code: 'en',
        title: 'Ticket Assigned',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" ({{priority}}) has been assigned to you by {{performedByName}}',
        subtype_id: getSubtypeId('ticket-assigned')
      },
      {
        name: 'ticket-created',
        language_code: 'en',
        title: 'New Ticket Created',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" was created for {{clientName}}',
        subtype_id: getSubtypeId('ticket-created')
      },
      {
        name: 'ticket-created-client',
        language_code: 'en',
        title: 'Your Support Ticket Has Been Created',
        message: 'Your ticket #{{ticketId}} "{{ticketTitle}}" has been created and our team will respond shortly',
        subtype_id: getSubtypeId('ticket-created')
      },
      {
        name: 'ticket-updated',
        language_code: 'en',
        title: 'Ticket Updated',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" has been updated',
        subtype_id: getSubtypeId('ticket-updated')
      },
      {
        name: 'ticket-updated-client',
        language_code: 'en',
        title: 'Your Ticket Has Been Updated',
        message: 'Your ticket #{{ticketId}} "{{ticketTitle}}" has been updated',
        subtype_id: getSubtypeId('ticket-updated')
      },
      {
        name: 'ticket-closed',
        language_code: 'en',
        title: 'Ticket Closed',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" has been closed',
        subtype_id: getSubtypeId('ticket-closed')
      },
      {
        name: 'ticket-closed-client',
        language_code: 'en',
        title: 'Your Ticket Has Been Closed',
        message: 'Your ticket #{{ticketId}} "{{ticketTitle}}" has been closed',
        subtype_id: getSubtypeId('ticket-closed')
      },
      {
        name: 'ticket-comment-added',
        language_code: 'en',
        title: 'New Comment',
        message: '{{authorName}} commented on ticket #{{ticketId}}: "{{commentPreview}}"',
        subtype_id: getSubtypeId('ticket-comment-added')
      },
      {
        name: 'ticket-comment-added-client',
        language_code: 'en',
        title: 'New Comment on Your Ticket',
        message: '{{authorName}} commented on your ticket #{{ticketId}}: "{{commentPreview}}"',
        subtype_id: getSubtypeId('ticket-comment-added')
      },
      // Project templates
      {
        name: 'project-assigned',
        language_code: 'en',
        title: 'Project Assigned',
        message: 'Project "{{projectName}}" has been assigned to you',
        subtype_id: getSubtypeId('project-assigned')
      },
      {
        name: 'project-created',
        language_code: 'en',
        title: 'New Project Created',
        message: 'Project "{{projectName}}" was created for {{clientName}}',
        subtype_id: getSubtypeId('project-created')
      },
      {
        name: 'task-assigned',
        language_code: 'en',
        title: 'Task Assigned',
        message: 'Task "{{taskName}}" in project "{{projectName}}" has been assigned to you',
        subtype_id: getSubtypeId('task-assigned')
      },
      {
        name: 'milestone-completed',
        language_code: 'en',
        title: 'Milestone Completed',
        message: 'Milestone "{{milestoneName}}" in project "{{projectName}}" has been completed',
        subtype_id: getSubtypeId('milestone-completed')
      },
      // Invoice templates
      {
        name: 'invoice-generated',
        language_code: 'en',
        title: 'New Invoice Generated',
        message: 'Invoice #{{invoiceNumber}} for {{clientName}} has been generated',
        subtype_id: getSubtypeId('invoice-generated')
      },
      {
        name: 'payment-received',
        language_code: 'en',
        title: 'Payment Received',
        message: 'Payment of {{amount}} received for invoice #{{invoiceNumber}}',
        subtype_id: getSubtypeId('payment-received')
      },
      {
        name: 'payment-overdue',
        language_code: 'en',
        title: 'Payment Overdue',
        message: 'Invoice #{{invoiceNumber}} is {{daysOverdue}} days overdue',
        subtype_id: getSubtypeId('payment-overdue')
      },
      // System templates
      {
        name: 'system-announcement',
        language_code: 'en',
        title: 'System Announcement',
        message: '{{announcementTitle}}',
        subtype_id: getSubtypeId('system-announcement')
      },
      {
        name: 'user-mentioned',
        language_code: 'en',
        title: 'You were mentioned',
        message: '{{authorName}} mentioned you in {{entityType}} {{entityName}}',
        subtype_id: getSubtypeId('user-mentioned')
      },
      {
        name: 'user-mentioned-in-comment',
        language_code: 'en',
        title: 'You were mentioned in a comment',
        message: '{{commentAuthor}} mentioned you in ticket #{{ticketNumber}}: {{commentPreview}}',
        subtype_id: getSubtypeId('user-mentioned')
      },
      {
        name: 'user-mentioned-in-document',
        language_code: 'en',
        title: 'You were mentioned in a document',
        message: '{{authorName}} mentioned you in document "{{documentName}}"',
        subtype_id: getSubtypeId('user-mentioned')
      },
      {
        name: 'ticket-status-changed',
        language_code: 'en',
        title: 'Ticket Status Changed',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" status changed: {{oldStatus}} → {{newStatus}} by {{performedByName}}',
        subtype_id: getSubtypeId('ticket-status-changed')
      },
      {
        name: 'ticket-priority-changed',
        language_code: 'en',
        title: 'Ticket Priority Changed',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" priority changed: {{oldPriority}} → {{newPriority}} by {{performedByName}}',
        subtype_id: getSubtypeId('ticket-priority-changed')
      },
      {
        name: 'ticket-reassigned',
        language_code: 'en',
        title: 'Ticket Reassigned',
        message: 'Ticket #{{ticketId}} "{{ticketTitle}}" reassigned: {{oldAssignedTo}} → {{newAssignedTo}} by {{performedByName}}',
        subtype_id: getSubtypeId('ticket-reassigned')
      },
      // Message templates
      {
        name: 'message-sent',
        language_code: 'en',
        title: 'New Message',
        message: '{{senderName}}: {{messagePreview}}',
        subtype_id: getSubtypeId('message-sent')
      }
    ])
    .onConflict(['name', 'language_code'])
    .merge({
      title: knex.raw('excluded.title'),
      message: knex.raw('excluded.message'),
      subtype_id: knex.raw('excluded.subtype_id')
    });

  console.log('✓ Internal notification categories, subtypes, and English templates seeded');
};

exports.down = async function(knex) {
  // Remove templates
  await knex('internal_notification_templates')
    .where({ language_code: 'en' })
    .del();

  // Remove subtypes
  await knex('internal_notification_subtypes')
    .whereIn('name', [
      'ticket-assigned', 'ticket-created', 'ticket-updated', 'ticket-closed', 'ticket-comment-added',
      'ticket-status-changed', 'ticket-priority-changed', 'ticket-reassigned',
      'project-assigned', 'project-created', 'task-assigned', 'milestone-completed',
      'invoice-generated', 'payment-received', 'payment-overdue',
      'system-announcement', 'user-mentioned',
      'message-sent'
    ])
    .del();

  // Remove categories
  await knex('internal_notification_categories')
    .whereIn('name', ['tickets', 'projects', 'invoices', 'system', 'messages'])
    .del();

  console.log('Internal notification seed data removed');
};
