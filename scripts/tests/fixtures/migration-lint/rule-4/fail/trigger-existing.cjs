// Rule 4 (red): trigger on an existing table; replacing a function main defines.
exports.up = async function (knex) {
  // lint-expect: 4
  await knex.raw('CREATE TRIGGER comments_audit BEFORE INSERT ON comments FOR EACH ROW EXECUTE FUNCTION audit_fn()');
  // lint-expect: 4
  await knex.raw('CREATE OR REPLACE FUNCTION existing_fn() RETURNS int AS \'SELECT 1\' LANGUAGE sql');
};
