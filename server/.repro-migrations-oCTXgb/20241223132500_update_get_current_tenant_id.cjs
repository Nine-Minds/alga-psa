exports.up = async function(knex) {
    await knex.raw(`
    CREATE OR REPLACE FUNCTION get_current_tenant_id() RETURNS UUID AS $$
        DECLARE
            tenant_id UUID;
        BEGIN
            BEGIN
                tenant_id := current_setting('app.current_tenant', true)::uuid;
                RETURN tenant_id;
            EXCEPTION WHEN OTHERS THEN
                RETURN NULL;
            END;
        END;
        $$ LANGUAGE plpgsql SECURITY DEFINER;
    `);
};

exports.down = async function(knex) {
    await knex.raw(`
    CREATE OR REPLACE FUNCTION get_current_tenant_id() RETURNS UUID AS $$
        DECLARE
            tenant_id UUID;
        BEGIN
            BEGIN
                tenant_id := current_setting('app.current_tenant')::uuid;
            EXCEPTION WHEN OTHERS THEN
                RAISE EXCEPTION 'Invalid tenant ID';
            END;
            RETURN tenant_id;
        END;
        $$ LANGUAGE plpgsql SECURITY DEFINER;
    `);
};
