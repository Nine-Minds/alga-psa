exports.up = async function(knex) {
    // Create views
    await knex.schema.raw(`
        CREATE OR REPLACE VIEW v_ticket_details AS
        SELECT 
            t.tenant,
            t.ticket_id,
            t.ticket_number,
            t.title,
            t.url,
            c.company_name AS company,
            cn.full_name AS contact_name,
            s.name AS status,
            ch.channel_name AS channel,
            cat.category_name AS category,
            subcat.category_name AS subcategory,
            p.priority_name AS priority,
            sev.severity_name AS severity,
            u.urgency_name AS urgency,
            i.impact_name AS impact,
            ue.username AS entered_by,
            uu.username AS updated_by,
            ua.username AS assigned_to,
            uc.username AS closed_by,
            t.entered_at,
            t.updated_at,
            t.closed_at,
            t.is_closed
        FROM 
            tickets t
        LEFT JOIN companies c ON t.tenant = c.tenant AND t.company_id = c.company_id
        LEFT JOIN contacts cn ON t.tenant = cn.tenant AND t.contact_name_id = cn.contact_name_id
        LEFT JOIN statuses s ON t.tenant = s.tenant AND t.status_id = s.status_id
        LEFT JOIN channels ch ON t.tenant = ch.tenant AND t.channel_id = ch.channel_id
        LEFT JOIN categories cat ON t.tenant = cat.tenant AND t.category_id = cat.category_id
        LEFT JOIN categories subcat ON t.tenant = subcat.tenant AND t.subcategory_id = subcat.category_id
        LEFT JOIN priorities p ON t.tenant = p.tenant AND t.priority_id = p.priority_id
        LEFT JOIN severities sev ON t.tenant = sev.tenant AND t.severity_id = sev.severity_id
        LEFT JOIN urgencies u ON t.tenant = u.tenant AND t.urgency_id = u.urgency_id
        LEFT JOIN impacts i ON t.tenant = i.tenant AND t.impact_id = i.impact_id
        LEFT JOIN users ue ON t.tenant = ue.tenant AND t.entered_by = ue.user_id
        LEFT JOIN users uu ON t.tenant = uu.tenant AND t.updated_by = uu.user_id
        LEFT JOIN users ua ON t.tenant = ua.tenant AND t.assigned_to = ua.user_id
        LEFT JOIN users uc ON t.tenant = uc.tenant AND t.closed_by = uc.user_id;
    `);

    await knex.schema.raw(`
        CREATE OR REPLACE VIEW v_ticket_comments AS
        SELECT 
            c.tenant,
            c.comment_id,
            c.ticket_id,
            t.ticket_number,
            t.title,
            t.entered_at,
            c.user_id,
            u.username AS user_name,
            CONCAT(u.first_name, ' ', u.last_name) AS user_full_name,
            c.contact_name_id,
            cn.full_name AS contact_name,
            c.note,
            c.is_internal,
            c.is_resolution,
            c.is_initial_description,
            c.created_at,
            t.title_index,
            c.note_index AS comment_index
        FROM
            tickets t
        LEFT JOIN comments c ON t.tenant = c.tenant AND t.ticket_id = c.ticket_id
        LEFT JOIN users u ON c.tenant = u.tenant AND c.user_id = u.user_id
        LEFT JOIN contacts cn ON c.tenant = cn.tenant AND c.contact_id = cn.contact_name_id
        ORDER BY 
            c.ticket_id, c.created_at;
    `);

    await knex.schema.raw(`
        CREATE OR REPLACE VIEW v_ticket_assignments AS
        SELECT 
            t.tenant,
            t.ticket_id,
            t.ticket_number,
            t.title,
            t.assigned_to AS assigned_to_id,
            uas.username AS assigned_to_username,
            CONCAT(uas.first_name, ' ', uas.last_name) AS assigned_to_full_name,
            tr.additional_user_id,
            uadd.username AS additional_user_username,
            CONCAT(uadd.first_name, ' ', uadd.last_name) AS additional_user_full_name,
            tr.role AS additional_user_role,
            tr.assigned_at,
            s.name AS status,
            p.priority_name AS priority,
            t.company_id,
            c.company_name AS company,
            t.contact_name_id,
            cn.full_name AS contact_name,
            t.entered_at,
            t.updated_at,
            t.closed_at,
            t.is_closed,
            te.start_time,
            te.end_time,
            te.billable_duration
        FROM 
            tickets t
        LEFT JOIN users uas ON t.tenant = uas.tenant AND t.assigned_to = uas.user_id
        LEFT JOIN ticket_resources tr ON t.tenant = tr.tenant AND t.ticket_id = tr.ticket_id
        LEFT JOIN users uadd ON tr.tenant = uadd.tenant AND tr.additional_user_id = uadd.user_id
        LEFT JOIN statuses s ON t.tenant = s.tenant AND t.status_id = s.status_id
        LEFT JOIN priorities p ON t.tenant = p.tenant AND t.priority_id = p.priority_id
        LEFT JOIN companies c ON t.tenant = c.tenant AND t.company_id = c.company_id
        LEFT JOIN contacts cn ON t.tenant = cn.tenant AND t.contact_name_id = cn.contact_name_id
        LEFT JOIN time_entries te ON t.tenant = te.tenant 
            AND t.ticket_id = te.work_item_id 
            AND te.work_item_type = 'ticket'
            AND (
                (tr.additional_user_id IS NOT NULL AND te.user_id = tr.additional_user_id)
                OR (tr.additional_user_id IS NULL AND te.user_id = t.assigned_to)
            )
        ORDER BY 
            t.ticket_id,
            tr.assigned_at DESC,
            te.start_time DESC NULLS LAST;
    `);
};

exports.down = async function(knex) {
    await knex.raw('DROP VIEW IF EXISTS v_ticket_assignments');
    await knex.raw('DROP VIEW IF EXISTS v_ticket_comments');
    await knex.raw('DROP VIEW IF EXISTS v_ticket_details');
};
