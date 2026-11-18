// Rule 4 (green): trigger on a table created in this change, and a function whose
// dollar-quoted body mentions CREATE TRIGGER on an existing table (never entered).
exports.up = async function (knex) {
  await knex.raw('CREATE TABLE IF NOT EXISTS audit_log (id int)');
  await knex.raw('CREATE TRIGGER audit_log_touch BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION touch_fn()');
  await knex.raw(`
    CREATE OR REPLACE FUNCTION brand_new_fn() RETURNS trigger AS $body$
    BEGIN
      -- CREATE TRIGGER x BEFORE INSERT ON comments; ALTER TABLE comments DROP COLUMN note;
      RETURN NEW;
    END;
    $body$ LANGUAGE plpgsql
  `);
};
