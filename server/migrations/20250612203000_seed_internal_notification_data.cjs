/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // 1. Define Data
  const priorities = [
    { priority_name: 'Low', item_type: 'internal_notification', order_number: 1, color: '#78909C' },
    { priority_name: 'Normal', item_type: 'internal_notification', order_number: 2, color: '#2196F3' },
    { priority_name: 'High', item_type: 'internal_notification', order_number: 3, color: '#FFC107' },
    { priority_name: 'Urgent', item_type: 'internal_notification', order_number: 4, color: '#F44336' },
  ];

  const notificationTypes = [
    // Ticketing
    { type_name: 'TICKET_CREATED', category_name: 'TICKETING' },
    { type_name: 'TICKET_ASSIGNED', category_name: 'TICKETING' },
    { type_name: 'TICKET_STATUS_CHANGED', category_name: 'TICKETING' },
    { type_name: 'TICKET_PRIORITY_ESCALATED', category_name: 'TICKETING' },
    { type_name: 'TICKET_SLA_BREACH_WARNING', category_name: 'TICKETING' },
    { type_name: 'TICKET_CLIENT_RESPONSE', category_name: 'TICKETING' },
    { type_name: 'TICKET_COMMENT_ADDED', category_name: 'TICKETING' },
    { type_name: 'TICKET_CLOSED', category_name: 'TICKETING' },
    // Project Management
    { type_name: 'PROJECT_CREATED', category_name: 'PROJECTS' },
    { type_name: 'PROJECT_ASSIGNED', category_name: 'PROJECTS' },
    { type_name: 'PROJECT_CLOSED', category_name: 'PROJECTS' },
    { type_name: 'PROJECT_TASK_ASSIGNED', category_name: 'PROJECTS' },
    { type_name: 'PROJECT_TASK_DUE', category_name: 'PROJECTS' },
    { type_name: 'PROJECT_TASK_UPDATED', category_name: 'PROJECTS' },
    // Time Tracking
    { type_name: 'TIME_ENTRY_SUBMITTED', category_name: 'TIME_TRACKING' },
    // Billing
    { type_name: 'INVOICE_GENERATED', category_name: 'BILLING' },
    { type_name: 'INVOICE_PAYMENT_RECEIVED', category_name: 'BILLING' },
    { type_name: 'INVOICE_OVERDUE', category_name: 'BILLING' },
    { type_name: 'BUCKET_HOURS_LOW', category_name: 'BILLING' },
    // Asset Management
    { type_name: 'ASSET_WARRANTY_EXPIRING', category_name: 'ASSETS' },
    // Social & Collaboration
    { type_name: 'USER_MENTIONED', category_name: 'SOCIAL' },
    { type_name: 'DIRECT_MESSAGE', category_name: 'SOCIAL' },
    { type_name: 'DOCUMENT_SHARED', category_name: 'SOCIAL' },
  ];

  // 2. Insert Priorities and Types
  await knex('standard_priorities').insert(priorities);
  await knex('internal_notification_types').insert(notificationTypes);

  // 3. Retrieve the generated IDs
  const dbPriorities = await knex('standard_priorities').where('item_type', 'internal_notification').select('priority_id', 'priority_name');
  const dbTypes = await knex('internal_notification_types').whereIn('type_name', notificationTypes.map(t => t.type_name)).select('internal_notification_type_id', 'type_name');

  const priorityMap = dbPriorities.reduce((acc, p) => ({ ...acc, [p.priority_name]: p.priority_id }), {});
  const typeMap = dbTypes.reduce((acc, t) => ({ ...acc, [t.type_name]: t.internal_notification_type_id }), {});

  // 4. Prepare and Insert Templates using retrieved IDs
  const notificationTemplates = [
    // Ticketing
    { type_id: typeMap['TICKET_CREATED'], title_template: 'New Ticket: {{ticket_number}}', message_template: 'A new ticket titled "{{ticket_title}}" has been created.', default_priority_id: priorityMap['Normal'] },
    { type_id: typeMap['TICKET_ASSIGNED'], title_template: 'Ticket Assigned: {{ticket_number}}', message_template: 'You have been assigned ticket "{{ticket_title}}".', default_priority_id: priorityMap['Normal'] },
    { type_id: typeMap['TICKET_STATUS_CHANGED'], title_template: 'Ticket Updated: {{ticket_number}}', message_template: 'The status of ticket "{{ticket_title}}" is now {{new_status}}.', default_priority_id: priorityMap['Low'] },
    { type_id: typeMap['TICKET_PRIORITY_ESCALATED'], title_template: 'Ticket Escalated: {{ticket_number}}', message_template: 'The priority of ticket "{{ticket_title}}" has been raised.', default_priority_id: priorityMap['High'] },
    { type_id: typeMap['TICKET_SLA_BREACH_WARNING'], title_template: 'SLA Warning: {{ticket_number}}', message_template: 'Ticket "{{ticket_title}}" is approaching its SLA deadline.', default_priority_id: priorityMap['High'] },
    { type_id: typeMap['TICKET_CLIENT_RESPONSE'], title_template: 'Client Responded: {{ticket_number}}', message_template: 'A new response was received from the client on ticket "{{ticket_title}}".', default_priority_id: priorityMap['Normal'] },
    { type_id: typeMap['TICKET_COMMENT_ADDED'], title_template: 'New comment on ticket {{ticket_number}}', message_template: '{{author_name}} commented on ticket "{{ticket_title}}": {{comment_preview}}', default_priority_id: priorityMap['Normal'] },
    { type_id: typeMap['TICKET_CLOSED'], title_template: 'Ticket {{ticket_number}} was closed', message_template: 'Ticket "{{ticket_title}}" has been marked as {{status}}.', default_priority_id: priorityMap['Low'] },
    // Project Management
    { type_id: typeMap['PROJECT_CREATED'], title_template: 'New project: {{project_name}}', message_template: 'A new project "{{project_name}}" has been created and assigned to you.', default_priority_id: priorityMap['Normal'] },
    { type_id: typeMap['PROJECT_ASSIGNED'], title_template: 'Project assigned: {{project_name}}', message_template: 'You have been assigned as project manager for "{{project_name}}".', default_priority_id: priorityMap['Normal'] },
    { type_id: typeMap['PROJECT_CLOSED'], title_template: 'Project completed: {{project_name}}', message_template: 'Project "{{project_name}}" has been marked as {{status}}.', default_priority_id: priorityMap['Normal'] },
    { type_id: typeMap['PROJECT_TASK_ASSIGNED'], title_template: 'Task Assigned to You', message_template: 'You have been assigned task "{{task_name}}" in project "{{project_name}}".', default_priority_id: priorityMap['Normal'] },
    { type_id: typeMap['PROJECT_TASK_DUE'], title_template: 'Task Due Soon', message_template: 'Task "{{task_name}}" is due on {{due_date}}.', default_priority_id: priorityMap['Normal'] },
    { type_id: typeMap['PROJECT_TASK_UPDATED'], title_template: 'Project updated: {{project_name}}', message_template: 'Project "{{project_name}}" has been updated.', default_priority_id: priorityMap['Low'] },
    // Time Tracking
    { type_id: typeMap['TIME_ENTRY_SUBMITTED'], title_template: 'Time entry approval needed', message_template: '{{user_name}} submitted {{hours}} hours for approval.', default_priority_id: priorityMap['Normal'] },
    // Billing
    { type_id: typeMap['INVOICE_GENERATED'], title_template: 'New Invoice: {{invoice_number}}', message_template: 'Invoice {{invoice_number}} for {{amount}} has been generated.', default_priority_id: priorityMap['Normal'] },
    { type_id: typeMap['INVOICE_PAYMENT_RECEIVED'], title_template: 'Payment Received', message_template: 'Thank you! We have received your payment for invoice {{invoice_number}}.', default_priority_id: priorityMap['Normal'] },
    { type_id: typeMap['INVOICE_OVERDUE'], title_template: 'Invoice Overdue: {{invoice_number}}', message_template: 'Invoice {{invoice_number}} is now overdue. Please submit payment.', default_priority_id: priorityMap['High'] },
    { type_id: typeMap['BUCKET_HOURS_LOW'], title_template: 'Low Bucket Hours', message_template: 'Your prepaid bucket "{{bucket_name}}" is running low on hours.', default_priority_id: priorityMap['Normal'] },
    // Asset Management
    { type_id: typeMap['ASSET_WARRANTY_EXPIRING'], title_template: 'Warranty Expiring Soon', message_template: 'The warranty for asset "{{asset_name}}" is expiring on {{expiry_date}}.', default_priority_id: priorityMap['Normal'] },
    // Social & Collaboration
    { type_id: typeMap['USER_MENTIONED'], title_template: 'You were mentioned', message_template: '{{user_name}} mentioned you in {{context_type}} "{{context_name}}".', default_priority_id: priorityMap['High'] },
    { type_id: typeMap['DIRECT_MESSAGE'], title_template: 'New Direct Message', message_template: 'You have a new message from {{sender_name}}.', default_priority_id: priorityMap['High'] },
    { type_id: typeMap['DOCUMENT_SHARED'], title_template: 'Document Shared', message_template: '{{user_name}} shared a document with you: "{{document_name}}".', default_priority_id: priorityMap['Normal'] },
  ];

  await knex('internal_notification_templates').insert(notificationTemplates);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Define the types that were added to find the templates
  const typeNames = [
    'TICKET_CREATED',
    'TICKET_ASSIGNED',
    'TICKET_STATUS_CHANGED',
    'TICKET_PRIORITY_ESCALATED',
    'TICKET_SLA_BREACH_WARNING',
    'TICKET_CLIENT_RESPONSE',
    'TICKET_COMMENT_ADDED',
    'TICKET_CLOSED',
    'PROJECT_CREATED',
    'PROJECT_ASSIGNED',
    'PROJECT_CLOSED',
    'PROJECT_TASK_ASSIGNED',
    'PROJECT_TASK_DUE',
    'PROJECT_TASK_UPDATED',
    'TIME_ENTRY_SUBMITTED',
    'INVOICE_GENERATED',
    'INVOICE_PAYMENT_RECEIVED',
    'INVOICE_OVERDUE',
    'BUCKET_HOURS_LOW',
    'ASSET_WARRANTY_EXPIRING',
    'USER_MENTIONED',
    'DIRECT_MESSAGE',
    'DOCUMENT_SHARED',
  ];

  // 1. Delete Templates
  const typeIdsToDelete = knex('internal_notification_types').whereIn('type_name', typeNames).select('internal_notification_type_id');
  await knex('internal_notification_templates').whereIn('type_id', typeIdsToDelete).del();

  // 2. Delete Notification Types
  await knex('internal_notification_types').whereIn('type_name', typeNames).del();

  // 3. Delete Standard Priorities
  await knex('standard_priorities').where('item_type', 'internal_notification').del();
};
