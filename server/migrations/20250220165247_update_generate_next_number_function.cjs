exports.up = function(knex) {
  return knex.raw(`
    CREATE OR REPLACE FUNCTION public.generate_next_number(p_tenant_id uuid, p_entity_type text)
    RETURNS text
    LANGUAGE plpgsql
    AS $function$
    DECLARE
        new_number BIGINT;
        number_prefix TEXT;
        initial_val BIGINT;
        padding_len INTEGER;
        formatted_number TEXT;
    BEGIN
        -- Use advisory lock for concurrency control
        PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text || p_entity_type));
        
        -- Always include tenant in WHERE clauses for CitusDB compatibility
        INSERT INTO next_number (tenant, entity_type)
        VALUES (p_tenant_id, p_entity_type)
        ON CONFLICT (tenant, entity_type) DO UPDATE
        SET last_number = 
            CASE 
                WHEN next_number.last_number = 0 THEN next_number.initial_value
                ELSE next_number.last_number + 1
            END
        RETURNING last_number, initial_value, prefix, padding_length 
        INTO new_number, initial_val, number_prefix, padding_len;
        
        IF new_number = initial_val AND new_number != 1 THEN
        ELSE
            -- Include tenant in WHERE clause
            UPDATE next_number
            SET last_number = new_number
            WHERE tenant = p_tenant_id AND entity_type = p_entity_type;
        END IF;

        -- Format number with padding
        formatted_number := LPAD(new_number::TEXT, COALESCE(padding_len, 1), '0');
        
        -- Add prefix if exists
        IF number_prefix IS NOT NULL THEN
            formatted_number := number_prefix || formatted_number;
        END IF;
        
        RETURN formatted_number;
    END;
    $function$;
  `);
};

exports.down = function(knex) {
  return knex.raw(`
    CREATE OR REPLACE FUNCTION public.generate_next_number(p_tenant_id uuid, p_entity_type text)
    RETURNS text
    LANGUAGE plpgsql
    AS $function$
    DECLARE
        new_number BIGINT;
        number_prefix TEXT;
        initial_val BIGINT;
    BEGIN
        -- Use advisory lock for concurrency control
        PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text || p_entity_type));
        
        INSERT INTO next_number (tenant, entity_type)
        VALUES (p_tenant_id, p_entity_type)
        ON CONFLICT (tenant, entity_type) DO UPDATE
        SET last_number = 
            CASE 
                WHEN next_number.last_number = 0 THEN next_number.initial_value
                ELSE next_number.last_number + 1
            END
        RETURNING last_number, initial_value, prefix
        INTO new_number, initial_val, number_prefix;
        
        IF new_number = initial_val AND new_number != 1 THEN
        ELSE
            UPDATE next_number
            SET last_number = new_number
            WHERE tenant = p_tenant_id AND entity_type = p_entity_type;
        END IF;

        IF number_prefix IS NOT NULL THEN
            RETURN number_prefix || new_number::TEXT;
        END IF;
        
        RETURN new_number::TEXT;
    END;
    $function$;
  `);
};
