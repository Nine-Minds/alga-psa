/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  console.log('Adding task-comment-added notification template...');

  // Get the projects category ID
  const projectsCategory = await knex('internal_notification_categories')
    .where({ name: 'projects' })
    .first();

  if (!projectsCategory) {
    throw new Error('Projects notification category not found');
  }

  // Insert the task-comment-added subtype
  const [subtype] = await knex('internal_notification_subtypes')
    .insert({
      internal_category_id: projectsCategory.internal_notification_category_id,
      name: 'task-comment-added',
      description: 'Comment added to task',
      is_enabled: true,
      is_default_enabled: true
    })
    .onConflict(['internal_category_id', 'name'])
    .merge({
      description: knex.raw('EXCLUDED.description'),
      is_enabled: knex.raw('EXCLUDED.is_enabled'),
      is_default_enabled: knex.raw('EXCLUDED.is_default_enabled')
    })
    .returning('*');

  // Insert the English template
  await knex('internal_notification_templates')
    .insert({
      name: 'task-comment-added',
      language_code: 'en',
      title: 'New Task Comment',
      message: '{{authorName}} added a comment to task "{{taskName}}"',
      subtype_id: subtype.internal_notification_subtype_id
    })
    .onConflict(['name', 'language_code'])
    .merge({
      title: knex.raw('EXCLUDED.title'),
      message: knex.raw('EXCLUDED.message'),
      subtype_id: knex.raw('EXCLUDED.subtype_id')
    });

  console.log('✓ Task comment notification template added');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  console.log('Removing task-comment-added notification template...');

  // Delete the template
  await knex('internal_notification_templates')
    .where({ name: 'task-comment-added' })
    .delete();

  // Delete the subtype
  await knex('internal_notification_subtypes')
    .where({ name: 'task-comment-added' })
    .delete();

  console.log('✓ Task comment notification template removed');
};
