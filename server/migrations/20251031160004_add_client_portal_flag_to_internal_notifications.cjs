/**
 * Add client portal availability flag to internal notification categories and subtypes
 */

exports.up = async function(knex) {
  await knex.schema
    .alterTable('internal_notification_categories', table => {
      table.boolean('available_for_client_portal').notNullable().defaultTo(false);
    })
    .alterTable('internal_notification_subtypes', table => {
      table.boolean('available_for_client_portal').notNullable().defaultTo(false);
    });

  // Update existing categories to set which are available for client portal
  await knex('internal_notification_categories')
    .whereIn('name', ['tickets', 'invoices', 'messages'])
    .update({ available_for_client_portal: true });

  // Update specific subtypes that should be available for client portal
  const categories = await knex('internal_notification_categories')
    .select('internal_notification_category_id', 'name');

  const ticketsCat = categories.find(c => c.name === 'tickets');
  const invoicesCat = categories.find(c => c.name === 'invoices');
  const messagesCat = categories.find(c => c.name === 'messages');

  // Ticket subtypes available for client portal
  if (ticketsCat) {
    await knex('internal_notification_subtypes')
      .where({ internal_category_id: ticketsCat.internal_notification_category_id })
      .whereIn('name', [
        'ticket-created',
        'ticket-updated',
        'ticket-closed',
        'ticket-comment-added'
      ])
      .update({ available_for_client_portal: true });
  }

  // Invoice subtypes available for client portal
  if (invoicesCat) {
    await knex('internal_notification_subtypes')
      .where({ internal_category_id: invoicesCat.internal_notification_category_id })
      .update({ available_for_client_portal: true });
  }

  // Message subtypes available for client portal
  if (messagesCat) {
    await knex('internal_notification_subtypes')
      .where({ internal_category_id: messagesCat.internal_notification_category_id })
      .update({ available_for_client_portal: true });
  }
};

exports.down = async function(knex) {
  await knex.schema
    .alterTable('internal_notification_subtypes', table => {
      table.dropColumn('available_for_client_portal');
    })
    .alterTable('internal_notification_categories', table => {
      table.dropColumn('available_for_client_portal');
    });
};
