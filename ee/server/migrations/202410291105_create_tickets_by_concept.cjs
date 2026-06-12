exports.up = async function(knex) {
    // get_tickets_by_concept takes a pgvector argument; skip where the
    // extension isn't available (e.g. the Citus migration smoke job).
    const vectorCheck = await knex.raw(
        "SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') AS available"
    );
    if (!vectorCheck.rows?.[0]?.available) {
        console.log('[tickets-by-concept] pgvector not available; skipping');
        return;
    }

    // Create get_tickets_by_concept function
    await knex.schema.raw(`
        CREATE OR REPLACE FUNCTION public.get_tickets_by_concept(
            embedding vector, 
            tenant_name UUID, 
            concept text, 
            max_distance double precision
        )
        RETURNS TABLE(
            ticket_id UUID,
            ticket_number TEXT,
            title text, 
            distance double precision, 
            entered_at timestamp with time zone
        )
        LANGUAGE plpgsql
        AS $function$
        BEGIN
        RETURN QUERY
        WITH
        vector_search AS (
            SELECT
                t.ticket_id,
                t.ticket_number,
                t.tenant,
                t.title,
                v.vector <-> embedding AS distance_d,
                t.entered_at
            FROM
                vectors v
            JOIN tickets t ON v.ticket_id = t.ticket_id AND v.tenant = t.tenant
            WHERE
                t.tenant = tenant_name
                AND v.vector <-> embedding < max_distance
        ),
        title_search AS (
            SELECT
                t.ticket_id,
                t.ticket_number,
                t.tenant,
                t.title,
                0.1 AS distance_d,
                t.entered_at
            FROM
                tickets t
            WHERE
                t.tenant = tenant_name
                AND t.title_index @@ to_tsquery('english', concept)
        ),
        comment_search AS (
            SELECT
                t.ticket_id,
                t.ticket_number,
                t.tenant,
                t.title,
                0.1 AS distance_d,
                t.entered_at
            FROM
                comments c
            JOIN tickets t ON c.ticket_id = t.ticket_id AND c.tenant = t.tenant
            WHERE
                t.tenant = tenant_name
                AND c.note_index @@ to_tsquery('english', concept)
        ),
        document_search AS (
            SELECT
                t.ticket_id,
                t.ticket_number,
                t.tenant,
                t.title,
                0.1 AS distance_d,
                t.entered_at
            FROM
                documents d
            JOIN tickets t ON d.ticket_id = t.ticket_id AND d.tenant = t.tenant
            WHERE
                t.tenant = tenant_name
                AND d.content_index @@ to_tsquery('english', concept)
        ),
        combined_results AS (
            SELECT * FROM vector_search
            UNION ALL
            SELECT * FROM title_search
            UNION ALL
            SELECT * FROM comment_search
            UNION ALL
            SELECT * FROM document_search
        ),
        ranked_results AS (
            SELECT
                cr.ticket_id,
                cr.ticket_number,
                cr.tenant,
                cr.title,
                cr.distance_d,
                cr.entered_at,
                ROW_NUMBER() OVER (PARTITION BY cr.ticket_id ORDER BY cr.entered_at DESC) AS rn
            FROM
                combined_results cr
            WHERE
                cr.tenant = tenant_name
        ),
        unique_results AS (
            SELECT
                rr.ticket_id,
                rr.ticket_number,
                rr.title,
                MIN(rr.distance_d) AS distance,
                MIN(rr.entered_at) AS entered_at
            FROM
                ranked_results rr
            WHERE
                rn = 1
            GROUP BY
                rr.ticket_id, rr.ticket_number, rr.title
        )
        SELECT
            ur.ticket_id,
            ur.ticket_number,
            ur.title,
            ur.distance,
            ur.entered_at
        FROM
            unique_results ur
        ORDER BY
            ur.entered_at DESC;
        END;
        $function$
    ;`);
};

exports.down = async function(knex) {
    await knex.raw('DROP FUNCTION IF EXISTS get_tickets_by_concept');
};
