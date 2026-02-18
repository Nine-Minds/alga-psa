/**
 * Add SLA notification category, subtypes, and templates for internal notifications
 *
 * Creates:
 * - New 'sla' category in internal_notification_categories
 * - Subtypes: sla-warning, sla-breach, sla-response-met, sla-resolution-met, sla-escalation
 * - English templates for each subtype
 *
 * Note: SLA notifications are internal-only (assignee, board manager, escalation manager),
 * so multi-language translations are not required.
 */

exports.up = async function(knex) {
  console.log('Adding SLA internal notification category, subtypes, and templates...');

  // 1. Insert SLA category
  const [slaCategory] = await knex('internal_notification_categories')
    .insert({
      name: 'sla',
      description: 'SLA-related notifications',
      is_enabled: true,
      is_default_enabled: true,
      available_for_client_portal: false  // Internal users only
    })
    .onConflict('name')
    .merge({
      description: knex.raw('excluded.description'),
      is_enabled: knex.raw('excluded.is_enabled'),
      is_default_enabled: knex.raw('excluded.is_default_enabled'),
      available_for_client_portal: knex.raw('excluded.available_for_client_portal')
    })
    .returning('*');

  const slaCategoryId = slaCategory.internal_notification_category_id;

  // 2. Insert subtypes
  const subtypes = await knex('internal_notification_subtypes')
    .insert([
      {
        internal_category_id: slaCategoryId,
        name: 'sla-warning',
        description: 'SLA threshold warning (approaching breach)',
        is_enabled: true,
        is_default_enabled: true,
        available_for_client_portal: false
      },
      {
        internal_category_id: slaCategoryId,
        name: 'sla-breach',
        description: 'SLA breached (100% elapsed)',
        is_enabled: true,
        is_default_enabled: true,
        available_for_client_portal: false
      },
      {
        internal_category_id: slaCategoryId,
        name: 'sla-response-met',
        description: 'Response SLA met',
        is_enabled: true,
        is_default_enabled: false,  // Disabled by default - success notifications can be noisy
        available_for_client_portal: false
      },
      {
        internal_category_id: slaCategoryId,
        name: 'sla-resolution-met',
        description: 'Resolution SLA met',
        is_enabled: true,
        is_default_enabled: false,  // Disabled by default - success notifications can be noisy
        available_for_client_portal: false
      },
      {
        internal_category_id: slaCategoryId,
        name: 'sla-escalation',
        description: 'Ticket escalated due to SLA',
        is_enabled: true,
        is_default_enabled: true,
        available_for_client_portal: false
      }
    ])
    .onConflict(['internal_category_id', 'name'])
    .merge({
      description: knex.raw('excluded.description'),
      is_enabled: knex.raw('excluded.is_enabled'),
      is_default_enabled: knex.raw('excluded.is_default_enabled'),
      available_for_client_portal: knex.raw('excluded.available_for_client_portal')
    })
    .returning('*');

  const getSubtypeId = (name) => {
    const subtype = subtypes.find(s => s.name === name);
    if (!subtype) {
      throw new Error(`SLA notification subtype '${name}' not found`);
    }
    return subtype.internal_notification_subtype_id;
  };

  // 3. Insert English templates
  // Variables available: {{ticketNumber}}, {{ticketTitle}}, {{thresholdPercent}},
  //                      {{slaType}}, {{timeRemaining}}, {{policyName}}, {{priority}},
  //                      {{clientName}}, {{assigneeName}}, {{escalationLevel}}
  const templates = [
    // Warning templates (different severity levels)
    {
      name: 'sla-warning-50',
      language_code: 'en',
      title: 'SLA Warning: 50% Time Elapsed',
      message: 'Ticket #{{ticketNumber}} "{{ticketTitle}}" is at 50% of its {{slaType}} SLA. Time remaining: {{timeRemaining}}. Policy: {{policyName}}.',
      subtype_id: getSubtypeId('sla-warning')
    },
    {
      name: 'sla-warning-75',
      language_code: 'en',
      title: 'SLA Warning: 75% Time Elapsed',
      message: 'Ticket #{{ticketNumber}} "{{ticketTitle}}" is at 75% of its {{slaType}} SLA. Time remaining: {{timeRemaining}}. Immediate attention recommended.',
      subtype_id: getSubtypeId('sla-warning')
    },
    {
      name: 'sla-warning-90',
      language_code: 'en',
      title: 'SLA Critical: 90% Time Elapsed',
      message: 'URGENT: Ticket #{{ticketNumber}} "{{ticketTitle}}" is at 90% of its {{slaType}} SLA. Only {{timeRemaining}} remaining before breach!',
      subtype_id: getSubtypeId('sla-warning')
    },
    // Breach template
    {
      name: 'sla-breach',
      language_code: 'en',
      title: 'SLA Breached',
      message: 'SLA BREACH: Ticket #{{ticketNumber}} "{{ticketTitle}}" has exceeded its {{slaType}} SLA target. Policy: {{policyName}}. Client: {{clientName}}.',
      subtype_id: getSubtypeId('sla-breach')
    },
    // Response met template
    {
      name: 'sla-response-met',
      language_code: 'en',
      title: 'Response SLA Met',
      message: 'Ticket #{{ticketNumber}} "{{ticketTitle}}" response SLA was met. First response provided within target time.',
      subtype_id: getSubtypeId('sla-response-met')
    },
    // Resolution met template
    {
      name: 'sla-resolution-met',
      language_code: 'en',
      title: 'Resolution SLA Met',
      message: 'Ticket #{{ticketNumber}} "{{ticketTitle}}" was resolved within SLA target. Great job!',
      subtype_id: getSubtypeId('sla-resolution-met')
    },
    // Escalation template
    {
      name: 'sla-escalation',
      language_code: 'en',
      title: 'Ticket Escalated (SLA)',
      message: 'Ticket #{{ticketNumber}} "{{ticketTitle}}" has been escalated to level {{escalationLevel}} due to SLA. You have been added as an escalation manager.',
      subtype_id: getSubtypeId('sla-escalation')
    }
  ];

  await knex('internal_notification_templates')
    .insert(templates)
    .onConflict(['name', 'language_code'])
    .merge({
      title: knex.raw('excluded.title'),
      message: knex.raw('excluded.message'),
      subtype_id: knex.raw('excluded.subtype_id')
    });

  console.log('Successfully added SLA internal notification templates');
};

exports.down = async function(knex) {
  console.log('Removing SLA internal notification templates...');

  // Delete templates
  await knex('internal_notification_templates')
    .whereIn('name', [
      'sla-warning-50',
      'sla-warning-75',
      'sla-warning-90',
      'sla-breach',
      'sla-response-met',
      'sla-resolution-met',
      'sla-escalation'
    ])
    .delete();

  // Delete subtypes
  await knex('internal_notification_subtypes')
    .whereIn('name', [
      'sla-warning',
      'sla-breach',
      'sla-response-met',
      'sla-resolution-met',
      'sla-escalation'
    ])
    .delete();

  // Delete category (only if no other subtypes exist)
  const remainingSubtypes = await knex('internal_notification_subtypes')
    .join('internal_notification_categories', 'internal_notification_subtypes.internal_category_id', 'internal_notification_categories.internal_notification_category_id')
    .where('internal_notification_categories.name', 'sla')
    .count('* as count')
    .first();

  if (Number(remainingSubtypes?.count || 0) === 0) {
    await knex('internal_notification_categories')
      .where('name', 'sla')
      .delete();
  }

  console.log('Successfully removed SLA internal notification templates');
};
