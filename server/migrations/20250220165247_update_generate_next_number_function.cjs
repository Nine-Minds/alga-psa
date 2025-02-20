exports.up = function(knex) {
  return knex.raw(`
    CREATE OR REPLACE FUNCTION public.generate_next_number(p_tenant_id uuid, p_entity_type text)
    RETURNS text
    LANGUAGE plpgsql
    AS $function$
    DECLARE
        new_number BIGINT;
        number_prefix TEXT;
        formatted_number TEXT;
        settings record;
    BEGIN
        -- Use advisory lock for concurrency control
        PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text || p_entity_type));
        
        -- Get or create next_number settings
        INSERT INTO next_number (tenant, entity_type)
        VALUES (p_tenant_id, p_entity_type)
        ON CONFLICT (tenant, entity_type) DO NOTHING;
        
        -- Get current settings
        SELECT last_number, initial_value, prefix, padding_length
        INTO settings
        FROM next_number
        WHERE tenant = p_tenant_id AND entity_type = p_entity_type;
        
        -- Calculate next number
        new_number := GREATEST(
            COALESCE(settings.last_number, 0) + 1,
            settings.initial_value
        );
        
        -- Update last_number
        UPDATE next_number
        SET last_number = new_number
        WHERE tenant = p_tenant_id AND entity_type = p_entity_type;
        
        -- Convert number to text with proper formatting
        formatted_number := new_number::TEXT;
        
        -- Only pad if number length is less than padding length
        IF LENGTH(formatted_number) <= settings.padding_length THEN
            formatted_number := LPAD(formatted_number, settings.padding_length, '0');
        END IF;
        
        -- Add prefix if exists
        IF settings.prefix IS NOT NULL THEN
            formatted_number := settings.prefix || formatted_number;
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
