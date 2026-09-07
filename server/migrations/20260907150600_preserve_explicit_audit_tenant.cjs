/** Explicit ownership must survive shared commands whose authenticated home
 * tenant differs from the record's owner. Legacy callers can still use context. */
exports.up = async function(knex) {
  await knex.raw(`CREATE OR REPLACE FUNCTION set_tenant_from_current_setting()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.tenant IS NULL THEN
        NEW.tenant = NULLIF(current_setting('app.current_tenant', true), '')::uuid;
      END IF;
      IF NEW.tenant IS NULL THEN
        RAISE EXCEPTION 'Audit records require an explicit tenant or current tenant context';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql`);
};
exports.down = async function(knex) {
  if (await knex('audit_logs').where('operation', 'co_managed_project_task_update').first('audit_id'))
    throw new Error('Cannot restore implicit audit ownership while shared project history is retained');
  await knex.raw(`CREATE OR REPLACE FUNCTION set_tenant_from_current_setting()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.tenant = current_setting('app.current_tenant');
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql`);
};
