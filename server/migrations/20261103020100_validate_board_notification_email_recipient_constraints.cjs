const TABLE = 'board_notification_rule_recipients';

exports.up = async function up(knex) {
  await knex.raw(`ALTER TABLE ${TABLE} VALIDATE CONSTRAINT board_notification_rule_recipients_type_check`);
  await knex.raw(`ALTER TABLE ${TABLE} VALIDATE CONSTRAINT board_notification_rule_recipients_shape_check`);
  await knex.raw(`ALTER TABLE ${TABLE} VALIDATE CONSTRAINT board_notification_rule_recipients_email_normalized_check`);
};

// Validation only tightens constraints already installed by the preceding migration.
exports.down = async function down() {};

exports.config = { transaction: false };
