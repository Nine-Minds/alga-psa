'use strict';

/**
 * Adds only the PO-received inventory notification subtype/template.
 * The inventory category and low-stock subtype/digest already exist.
 */
exports.up = async function up(knex) {
  const [category] = await knex('internal_notification_categories')
    .insert({
      name: 'inventory',
      description: 'Inventory and stock notifications',
      is_enabled: true,
      is_default_enabled: true,
    })
    .onConflict(['name'])
    .merge({ description: knex.raw('excluded.description') })
    .returning('*');

  const [subtype] = await knex('internal_notification_subtypes')
    .insert({
      internal_category_id: category.internal_notification_category_id,
      name: 'inventory-po-received',
      description: 'A purchase order has been received into inventory',
      is_enabled: true,
      is_default_enabled: true,
    })
    .onConflict(['internal_category_id', 'name'])
    .merge({ description: knex.raw('excluded.description') })
    .returning('*');

  const translations = {
    en: {
      title: 'Purchase order {{poNumber}} received',
      message: '{{receivedLineCount}} line(s) received from {{vendorName}}.',
    },
    fr: {
      title: 'Bon de commande {{poNumber}} recu',
      message: '{{receivedLineCount}} ligne(s) recue(s) de {{vendorName}}.',
    },
    es: {
      title: 'Orden de compra {{poNumber}} recibida',
      message: '{{receivedLineCount}} linea(s) recibida(s) de {{vendorName}}.',
    },
    de: {
      title: 'Bestellung {{poNumber}} erhalten',
      message: '{{receivedLineCount}} Position(en) von {{vendorName}} erhalten.',
    },
    nl: {
      title: 'Inkooporder {{poNumber}} ontvangen',
      message: '{{receivedLineCount}} regel(s) ontvangen van {{vendorName}}.',
    },
    it: {
      title: "Ordine d'acquisto {{poNumber}} ricevuto",
      message: '{{receivedLineCount}} riga/righe ricevute da {{vendorName}}.',
    },
  };

  const rows = Object.entries(translations).map(([language_code, t]) => ({
    name: 'inventory-po-received',
    language_code,
    title: t.title,
    message: t.message,
    subtype_id: subtype.internal_notification_subtype_id,
  }));

  await knex('internal_notification_templates')
    .insert(rows)
    .onConflict(['name', 'language_code'])
    .merge({ title: knex.raw('excluded.title'), message: knex.raw('excluded.message') });
};

exports.down = async function down(knex) {
  await knex('internal_notification_templates').where({ name: 'inventory-po-received' }).del();
  await knex('internal_notification_subtypes').where({ name: 'inventory-po-received' }).del();
  // The 'inventory' category and low-stock subtype stay in place.
};
