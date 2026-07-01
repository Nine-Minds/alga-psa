/**
 * Internal-notification category/subtype/template for per-location low-stock alerts
 * (remediation plan F037/F038). The daily job routes each location's alert to that
 * location's manager_user_id only — never a global blast.
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
      name: 'inventory-low-stock',
      description: 'A stock location has products at or below their reorder point',
      is_enabled: true,
      is_default_enabled: true,
    })
    .onConflict(['internal_category_id', 'name'])
    .merge({ description: knex.raw('excluded.description') })
    .returning('*');

  const translations = {
    en: {
      title: 'Low stock at {{locationName}}',
      message: '{{productCount}} product(s) at {{locationName}} are at or below their reorder point: {{summary}}',
    },
    fr: {
      title: 'Stock bas à {{locationName}}',
      message: '{{productCount}} produit(s) à {{locationName}} sont au niveau ou en dessous de leur seuil de réapprovisionnement : {{summary}}',
    },
    es: {
      title: 'Stock bajo en {{locationName}}',
      message: '{{productCount}} producto(s) en {{locationName}} están en o por debajo de su punto de pedido: {{summary}}',
    },
    de: {
      title: 'Niedriger Bestand bei {{locationName}}',
      message: '{{productCount}} Produkt(e) bei {{locationName}} liegen auf oder unter dem Meldebestand: {{summary}}',
    },
    nl: {
      title: 'Lage voorraad bij {{locationName}}',
      message: '{{productCount}} product(en) bij {{locationName}} zitten op of onder het bestelpunt: {{summary}}',
    },
    it: {
      title: 'Scorte basse presso {{locationName}}',
      message: '{{productCount}} prodotto/i presso {{locationName}} sono al livello di riordino o al di sotto: {{summary}}',
    },
  };

  const rows = Object.entries(translations).map(([language_code, t]) => ({
    name: 'inventory-low-stock',
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
  await knex('internal_notification_templates').where({ name: 'inventory-low-stock' }).del();
  await knex('internal_notification_subtypes').where({ name: 'inventory-low-stock' }).del();
  // The 'inventory' category is left in place — other subtypes may attach to it later.
};
