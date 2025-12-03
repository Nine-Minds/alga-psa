/**
 * Add color and icon configuration to statuses table
 */
exports.up = async function(knex) {
  await knex.schema.alterTable('statuses', function(table) {
    // Color as hex code (e.g., '#3B82F6' for blue)
    table.string('color', 7).nullable();

    // Icon name from lucide-react (e.g., 'Clipboard', 'PlayCircle', 'CheckCircle')
    table.string('icon', 50).nullable();
  });

  console.log('Added color and icon columns to statuses table');

  // Set default colors and icons for existing project_task statuses based on name
  // To Do / Backlog / Open -> Gray (#6B7280) with Clipboard icon
  await knex('statuses')
    .where('status_type', 'project_task')
    .where(function() {
      this.whereILike('name', '%to do%')
        .orWhereILike('name', '%backlog%')
        .orWhereILike('name', '%open%')
        .orWhereILike('name', '%new%');
    })
    .update({
      color: '#6B7280',
      icon: 'Clipboard'
    });

  // In Progress / Doing / Working -> Blue (#3B82F6) with PlayCircle icon
  await knex('statuses')
    .where('status_type', 'project_task')
    .where(function() {
      this.whereILike('name', '%in progress%')
        .orWhereILike('name', '%doing%')
        .orWhereILike('name', '%working%');
    })
    .update({
      color: '#3B82F6',
      icon: 'PlayCircle'
    });

  // On Hold / Blocked / Waiting -> Amber (#F59E0B) with PauseCircle icon
  await knex('statuses')
    .where('status_type', 'project_task')
    .where(function() {
      this.whereILike('name', '%hold%')
        .orWhereILike('name', '%blocked%')
        .orWhereILike('name', '%waiting%')
        .orWhereILike('name', '%paused%');
    })
    .update({
      color: '#F59E0B',
      icon: 'PauseCircle'
    });

  // Done / Complete / Finished -> Green (#10B981) with CheckCircle icon
  await knex('statuses')
    .where('status_type', 'project_task')
    .where(function() {
      this.whereILike('name', '%done%')
        .orWhereILike('name', '%complete%')
        .orWhereILike('name', '%finished%')
        .orWhereILike('name', '%resolved%');
    })
    .update({
      color: '#10B981',
      icon: 'CheckCircle'
    });

  // Cancelled / Closed -> Red (#EF4444) with XCircle icon
  await knex('statuses')
    .where('status_type', 'project_task')
    .where(function() {
      this.whereILike('name', '%cancel%')
        .orWhereILike('name', '%rejected%')
        .orWhereILike('name', '%abandoned%');
    })
    .update({
      color: '#EF4444',
      icon: 'XCircle'
    });

  console.log('Set default colors and icons for existing project task statuses');
};

exports.down = async function(knex) {
  await knex.schema.alterTable('statuses', function(table) {
    table.dropColumn('color');
    table.dropColumn('icon');
  });
};
