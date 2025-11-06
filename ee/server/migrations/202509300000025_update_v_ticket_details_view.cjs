/**
 * Ensure v_ticket_details no longer references legacy channels so that
 * subsequent cleanup migrations can safely alter/drop channel_id columns.
 *
 * This migration is idempotent: it drops the view if present and recreates it
 * with the correct structure. The down migration restores the legacy definition.
 *
 * @param { import("knex").Knex } knex
 */

exports.config = { transaction: false };

const VIEW_NAME = 'v_ticket_details';

const log = (message) => console.log(`[v_ticket_details] ${message}`);

async function dropViewIfExists(knex) {
  const { rows } = await knex.raw(
    `
      SELECT EXISTS (
        SELECT 1
        FROM pg_views
        WHERE viewname = ?
      ) AS exists
    `,
    [VIEW_NAME]
  );

  if (rows?.[0]?.exists) {
    await knex.raw(`DROP VIEW IF EXISTS ${VIEW_NAME} CASCADE`);
    log('Dropped existing view');
  } else {
    log('View not found; skipping drop');
  }
}

const CREATE_VIEW_WITH_BOARDS = `
  CREATE VIEW ${VIEW_NAME} AS
  SELECT
    t.tenant,
    t.ticket_id,
    t.ticket_number,
    t.title,
    t.url,
    c.company_name       AS company,
    cn.full_name         AS contact_name,
    s.name               AS status,
    b.board_name         AS channel,
    cat.category_name    AS category,
    subcat.category_name AS subcategory,
    p.priority_name      AS priority,
    sev.severity_name    AS severity,
    u.urgency_name       AS urgency,
    i.impact_name        AS impact,
    ue.username          AS entered_by,
    uu.username          AS updated_by,
    ua.username          AS assigned_to,
    uc.username          AS closed_by,
    t.entered_at,
    t.updated_at,
    t.closed_at,
    t.is_closed
  FROM tickets t
    LEFT JOIN companies c
      ON t.tenant = c.tenant AND t.company_id = c.company_id
    LEFT JOIN contacts cn
      ON t.tenant = cn.tenant AND t.contact_name_id = cn.contact_name_id
    LEFT JOIN statuses s
      ON t.tenant = s.tenant AND t.status_id = s.status_id
    LEFT JOIN boards b
      ON t.tenant = b.tenant AND t.board_id = b.board_id
    LEFT JOIN categories cat
      ON t.tenant = cat.tenant AND t.category_id = cat.category_id
    LEFT JOIN categories subcat
      ON t.tenant = subcat.tenant AND t.subcategory_id = subcat.category_id
    LEFT JOIN priorities p
      ON t.tenant = p.tenant AND t.priority_id = p.priority_id
    LEFT JOIN severities sev
      ON t.tenant = sev.tenant AND t.severity_id = sev.severity_id
    LEFT JOIN urgencies u
      ON t.tenant = u.tenant AND t.urgency_id = u.urgency_id
    LEFT JOIN impacts i
      ON t.tenant = i.tenant AND t.impact_id = i.impact_id
    LEFT JOIN users ue
      ON t.tenant = ue.tenant AND t.entered_by = ue.user_id
    LEFT JOIN users uu
      ON t.tenant = uu.tenant AND t.updated_by = uu.user_id
    LEFT JOIN users ua
      ON t.tenant = ua.tenant AND t.assigned_to = ua.user_id
    LEFT JOIN users uc
      ON t.tenant = uc.tenant AND t.closed_by = uc.user_id;
`;

const CREATE_VIEW_WITH_CHANNELS = `
  CREATE VIEW ${VIEW_NAME} AS
  SELECT
    t.tenant,
    t.ticket_id,
    t.ticket_number,
    t.title,
    t.url,
    c.company_name       AS company,
    cn.full_name         AS contact_name,
    s.name               AS status,
    ch.channel_name      AS channel,
    cat.category_name    AS category,
    subcat.category_name AS subcategory,
    p.priority_name      AS priority,
    sev.severity_name    AS severity,
    u.urgency_name       AS urgency,
    i.impact_name        AS impact,
    ue.username          AS entered_by,
    uu.username          AS updated_by,
    ua.username          AS assigned_to,
    uc.username          AS closed_by,
    t.entered_at,
    t.updated_at,
    t.closed_at,
    t.is_closed
  FROM tickets t
    LEFT JOIN companies c
      ON t.tenant = c.tenant AND t.company_id = c.company_id
    LEFT JOIN contacts cn
      ON t.tenant = cn.tenant AND t.contact_name_id = cn.contact_name_id
    LEFT JOIN statuses s
      ON t.tenant = s.tenant AND t.status_id = s.status_id
    LEFT JOIN channels ch
      ON t.tenant = ch.tenant AND t.channel_id = ch.channel_id
    LEFT JOIN categories cat
      ON t.tenant = cat.tenant AND t.category_id = cat.category_id
    LEFT JOIN categories subcat
      ON t.tenant = subcat.tenant AND t.subcategory_id = subcat.category_id
    LEFT JOIN priorities p
      ON t.tenant = p.tenant AND t.priority_id = p.priority_id
    LEFT JOIN severities sev
      ON t.tenant = sev.tenant AND t.severity_id = sev.severity_id
    LEFT JOIN urgencies u
      ON t.tenant = u.tenant AND t.urgency_id = u.urgency_id
    LEFT JOIN impacts i
      ON t.tenant = i.tenant AND t.impact_id = i.impact_id
    LEFT JOIN users ue
      ON t.tenant = ue.tenant AND t.entered_by = ue.user_id
    LEFT JOIN users uu
      ON t.tenant = uu.tenant AND t.updated_by = uu.user_id
    LEFT JOIN users ua
      ON t.tenant = ua.tenant AND t.assigned_to = ua.user_id
    LEFT JOIN users uc
      ON t.tenant = uc.tenant AND t.closed_by = uc.user_id;
`;

exports.up = async function up(knex) {
  log('Ensuring view references boards...');
  await dropViewIfExists(knex);
  await knex.raw(CREATE_VIEW_WITH_BOARDS);
  log('Created board-backed view');
};

exports.down = async function down(knex) {
  log('Restoring view to channels definition...');
  await dropViewIfExists(knex);
  await knex.raw(CREATE_VIEW_WITH_CHANNELS);
  log('Created legacy channel-backed view');
};
