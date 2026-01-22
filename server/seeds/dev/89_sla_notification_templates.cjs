/**
 * SLA Notification Templates Seed
 *
 * Ensures SLA notification templates exist for development environments.
 * This only adds the templates - it does NOT impose any SLA configuration.
 * Tenants who want to use SLA can configure it themselves.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.seed = async function(knex) {
  console.log('Seeding SLA notification templates for development...');

  // =========================================================================
  // Internal Notification Templates (in-app)
  // =========================================================================

  // 1. Ensure SLA category exists
  const [slaCategory] = await knex('internal_notification_categories')
    .insert({
      name: 'sla',
      description: 'SLA-related notifications for warnings, breaches, and status updates',
      is_enabled: true,
      is_default_enabled: true,
      available_for_client_portal: false
    })
    .onConflict('name')
    .merge({
      description: 'SLA-related notifications for warnings, breaches, and status updates',
      is_enabled: true,
      is_default_enabled: true,
      available_for_client_portal: false
    })
    .returning('*');

  const slaCategoryId = slaCategory.internal_notification_category_id;

  // 2. Create SLA subtypes
  const subtypeData = [
    { name: 'sla-warning', description: 'SLA approaching breach threshold' },
    { name: 'sla-breach', description: 'SLA has been breached' },
    { name: 'sla-response-met', description: 'Response SLA was met' },
    { name: 'sla-resolution-met', description: 'Resolution SLA was met' },
    { name: 'sla-escalation', description: 'SLA escalation notification' }
  ];

  const subtypes = [];
  for (const subtype of subtypeData) {
    const [inserted] = await knex('internal_notification_subtypes')
      .insert({
        internal_category_id: slaCategoryId,
        name: subtype.name,
        description: subtype.description,
        is_enabled: true,
        is_default_enabled: true,
        available_for_client_portal: false
      })
      .onConflict('name')
      .merge({
        description: subtype.description,
        is_enabled: true,
        is_default_enabled: true
      })
      .returning('*');
    subtypes.push(inserted);
  }

  const getSubtypeId = (name) => {
    const subtype = subtypes.find(s => s.name === name);
    return subtype?.internal_notification_subtype_id;
  };

  // 3. Create English templates for each subtype
  const templates = [
    {
      name: 'sla-warning',
      subtype_id: getSubtypeId('sla-warning'),
      language_code: 'en',
      title: 'SLA Warning: {{ticketNumber}}',
      message: '{{slaType}} SLA for ticket {{ticketNumber}} is at {{thresholdPercent}}%. Time remaining: {{remainingTime}}. Please take action to avoid breach.'
    },
    {
      name: 'sla-breach',
      subtype_id: getSubtypeId('sla-breach'),
      language_code: 'en',
      title: 'SLA Breached: {{ticketNumber}}',
      message: '{{slaType}} SLA for ticket {{ticketNumber}} has been breached. The ticket is now {{remainingTime}} overdue. Immediate attention required.'
    },
    {
      name: 'sla-response-met',
      subtype_id: getSubtypeId('sla-response-met'),
      language_code: 'en',
      title: 'Response SLA Met: {{ticketNumber}}',
      message: 'Great work! The response SLA for ticket {{ticketNumber}} was met successfully.'
    },
    {
      name: 'sla-resolution-met',
      subtype_id: getSubtypeId('sla-resolution-met'),
      language_code: 'en',
      title: 'Resolution SLA Met: {{ticketNumber}}',
      message: 'Great work! The resolution SLA for ticket {{ticketNumber}} was met successfully.'
    },
    {
      name: 'sla-escalation',
      subtype_id: getSubtypeId('sla-escalation'),
      language_code: 'en',
      title: 'SLA Escalation: {{ticketNumber}}',
      message: 'Ticket {{ticketNumber}} has been escalated due to SLA status. {{slaType}} SLA is at {{thresholdPercent}}% with {{remainingTime}} remaining.'
    }
  ];

  for (const template of templates) {
    if (!template.subtype_id) continue;

    await knex('internal_notification_templates')
      .insert(template)
      .onConflict(['name', 'language_code'])
      .merge({
        subtype_id: template.subtype_id,
        title: template.title,
        message: template.message
      });
  }

  // =========================================================================
  // Email Notification Templates
  // =========================================================================

  // 1. Ensure SLA email category exists
  const [emailCategory] = await knex('notification_categories')
    .insert({
      name: 'SLA',
      description: 'SLA-related email notifications'
    })
    .onConflict('name')
    .merge({
      description: 'SLA-related email notifications'
    })
    .returning('*');

  const emailCategoryId = emailCategory.id;

  // 2. Create email subtypes
  const emailSubtypeData = [
    { name: 'SLA Warning', description: 'Email notification for SLA warnings' },
    { name: 'SLA Breach', description: 'Email notification for SLA breaches' },
    { name: 'SLA Escalation', description: 'Email notification for SLA escalations' }
  ];

  for (const subtype of emailSubtypeData) {
    await knex('notification_subtypes')
      .insert({
        category_id: emailCategoryId,
        name: subtype.name,
        description: subtype.description
      })
      .onConflict(['category_id', 'name'])
      .merge({
        description: subtype.description
      });
  }

  // 3. Create system email templates
  const emailTemplates = [
    {
      name: 'SLA Warning',
      subject: 'SLA Warning: Ticket {{ticketNumber}} - {{slaType}} at {{thresholdPercent}}%',
      html_content: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #f59e0b;">SLA Warning</h2>
  <p>The <strong>{{slaType}}</strong> SLA for ticket <strong>{{ticketNumber}}</strong> is approaching its deadline.</p>
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Ticket:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{ticketNumber}} - {{ticketTitle}}</td></tr>
    <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Client:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{clientName}}</td></tr>
    <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>SLA Type:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{slaType}}</td></tr>
    <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Status:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee; color: #f59e0b;">{{thresholdPercent}}% elapsed</td></tr>
    <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Time Remaining:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{remainingTime}}</td></tr>
  </table>
  <p><a href="{{ticketUrl}}" style="display: inline-block; padding: 10px 20px; background-color: #3b82f6; color: white; text-decoration: none; border-radius: 5px;">View Ticket</a></p>
</div>`,
      text_content: 'SLA Warning: The {{slaType}} SLA for ticket {{ticketNumber}} is at {{thresholdPercent}}%. Time remaining: {{remainingTime}}. View ticket: {{ticketUrl}}',
      language_code: 'en'
    },
    {
      name: 'SLA Breach',
      subject: 'SLA BREACHED: Ticket {{ticketNumber}} - {{slaType}}',
      html_content: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #ef4444;">SLA Breached</h2>
  <p>The <strong>{{slaType}}</strong> SLA for ticket <strong>{{ticketNumber}}</strong> has been breached.</p>
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Ticket:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{ticketNumber}} - {{ticketTitle}}</td></tr>
    <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Client:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{clientName}}</td></tr>
    <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>SLA Type:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{slaType}}</td></tr>
    <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Status:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee; color: #ef4444;">BREACHED</td></tr>
    <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Overdue By:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee; color: #ef4444;">{{remainingTime}}</td></tr>
  </table>
  <p><a href="{{ticketUrl}}" style="display: inline-block; padding: 10px 20px; background-color: #ef4444; color: white; text-decoration: none; border-radius: 5px;">View Ticket Immediately</a></p>
</div>`,
      text_content: 'SLA BREACHED: The {{slaType}} SLA for ticket {{ticketNumber}} has been breached. Overdue by: {{remainingTime}}. View ticket immediately: {{ticketUrl}}',
      language_code: 'en'
    },
    {
      name: 'SLA Escalation',
      subject: 'SLA Escalation: Ticket {{ticketNumber}} Requires Attention',
      html_content: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #8b5cf6;">SLA Escalation</h2>
  <p>Ticket <strong>{{ticketNumber}}</strong> has been escalated due to its SLA status.</p>
  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Ticket:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{ticketNumber}} - {{ticketTitle}}</td></tr>
    <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Client:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{clientName}}</td></tr>
    <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Priority:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{priorityName}}</td></tr>
    <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>SLA Status:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{thresholdPercent}}% elapsed</td></tr>
    <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Time Remaining:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">{{remainingTime}}</td></tr>
  </table>
  <p><a href="{{ticketUrl}}" style="display: inline-block; padding: 10px 20px; background-color: #8b5cf6; color: white; text-decoration: none; border-radius: 5px;">View Ticket</a></p>
</div>`,
      text_content: 'SLA Escalation: Ticket {{ticketNumber}} has been escalated. SLA at {{thresholdPercent}}%, {{remainingTime}} remaining. View ticket: {{ticketUrl}}',
      language_code: 'en'
    }
  ];

  for (const template of emailTemplates) {
    await knex('system_email_templates')
      .insert(template)
      .onConflict(['name', 'language_code'])
      .merge({
        subject: template.subject,
        html_content: template.html_content,
        text_content: template.text_content
      });
  }

  console.log('SLA notification templates seed complete');
};
