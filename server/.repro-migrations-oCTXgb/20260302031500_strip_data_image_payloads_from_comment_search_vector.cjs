exports.up = async function up(knex) {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.process_large_lexemes(text_input text)
    RETURNS tsvector
    LANGUAGE plpgsql
    IMMUTABLE
    AS $function$
    DECLARE
      sanitized text;
    BEGIN
      sanitized := coalesce(text_input, '');

      -- Strip inline data:image base64 payloads (these can be very large and are not search-relevant).
      sanitized := regexp_replace(
        sanitized,
        'data:image/[a-z0-9.+-]+;base64,[a-z0-9+/=\\r\\n]+',
        ' ',
        'gi'
      );

      -- Keep prior behavior: drop individual oversized lexemes.
      sanitized := regexp_replace(sanitized, '\\m\\w{200,}\\M', ' ', 'g');

      -- Guardrail: cap input to avoid PostgreSQL tsvector size limit on pathological payloads.
      sanitized := left(sanitized, 500000);

      RETURN to_tsvector('english', sanitized);
    END;
    $function$;
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION public.process_large_lexemes(text_input text)
    RETURNS tsvector
    LANGUAGE plpgsql
    IMMUTABLE
    AS $function$
    BEGIN
      RETURN to_tsvector('english', regexp_replace(text_input, '\\m\\w{200,}\\M', '', 'g'));
    END;
    $function$;
  `);
};

