/**
 * Migration to add Hour Block Expiring notification subtype and email template.
 * Mirrors 20250226090000_add_credit_expiration_notification.cjs. Uses the
 * existing Invoices category.
 *
 * Note: this template is intentionally NOT added to the email-template
 * variable inventory (docs/plans/2026-07-17-email-template-variables-inventory
 * .json) — the registry contract test asserts registry length equals the
 * inventory length, and the hour-block template ships outside that v1 inventory
 * scope.
 *
 * Down safety: `down` must never delete notification rows that pre-existed
 * this migration (a name-based delete could remove rows created elsewhere, and
 * an unguarded category delete could orphan unrelated subtypes). `up` therefore
 * detects what already exists and records, in a migration-owned marker table,
 * the exact ids of the category/subtype/template rows IT created. `down` deletes
 * only those recorded ids and then drops the marker table. In an environment
 * where the marker is absent (e.g. this migration ran before marker
 * bookkeeping existed), `down` removes nothing — safety over cleanup.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */

const MARKER_TABLE = 'migration_20260813120100_marker';

async function readMarker(knex) {
  const exists = await knex.schema.hasTable(MARKER_TABLE);
  if (!exists) return {};
  const rows = await knex(MARKER_TABLE).where({ marker_key: 'created_ids' });
  if (rows.length === 0) return {};
  const raw = rows[0].marker_value;
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return value && typeof value === 'object' ? value : {};
}

async function writeMarker(knex, marker) {
  const exists = await knex.schema.hasTable(MARKER_TABLE);
  if (!exists) {
    await knex.schema.createTable(MARKER_TABLE, (table) => {
      table.string('marker_key', 128).primary();
      table.jsonb('marker_value').notNullable();
    });
  }
  await knex(MARKER_TABLE)
    .insert({ marker_key: 'created_ids', marker_value: JSON.stringify(marker) })
    .onConflict('marker_key')
    .merge();
}

exports.up = async function(knex) {
  // Merge with any prior marker so a re-run after a partial state records only
  // what is newly created instead of forgetting earlier creations.
  const marker = await readMarker(knex);

  let invoicesCategory = await knex('notification_categories')
    .where({ name: 'Invoices' })
    .first();

  if (!invoicesCategory) {
    [invoicesCategory] = await knex('notification_categories')
      .insert({
        name: 'Invoices',
        description: 'Notifications related to billing and invoices',
        is_enabled: true,
        is_default_enabled: true
      })
      .returning('*');
    marker.created_category_id = invoicesCategory.id;
  }

  const existingSubtype = await knex('notification_subtypes')
    .where({ name: 'Hour Block Expiring' })
    .first();

  let subtype;
  if (existingSubtype) {
    subtype = existingSubtype;
  } else {
    [subtype] = await knex('notification_subtypes')
      .insert({
        category_id: invoicesCategory.id,
        name: 'Hour Block Expiring',
        description: 'When prepaid hour blocks are about to expire',
        is_enabled: true,
        is_default_enabled: true
      })
      .returning('*');
    marker.created_subtype_id = subtype.id;
  }

  const existingTemplate = await knex('system_email_templates')
    .where({ name: 'hour-block-expiring' })
    .first();

  if (!existingTemplate) {
    const [createdTemplate] = await knex('system_email_templates')
      .insert({
        name: 'hour-block-expiring',
        subject: 'Prepaid Hours Expiring Soon: {{company.name}}',
        notification_subtype_id: subtype.id,
        html_content: `
        <h2>Prepaid Hours Expiring Soon</h2>
        <p>Prepaid hours for {{company.name}} will expire soon:</p>
        <div class="details">
          <p><strong>Company:</strong> {{company.name}}</p>
          <p><strong>Total Hours Remaining:</strong> {{hourBlocks.totalRemainingHours}} hrs</p>
          <p><strong>Expiration Date:</strong> {{hourBlocks.expirationDate}}</p>
          <p><strong>Days Until Expiration:</strong> {{hourBlocks.daysRemaining}}</p>
        </div>
        <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
          <thead>
            <tr style="background-color: #f2f2f2;">
              <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Service</th>
              <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Hours Remaining</th>
              <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Expiration Date</th>
            </tr>
          </thead>
          <tbody>
            {{#each hourBlocks.items}}
            <tr>
              <td style="padding: 8px; text-align: left; border: 1px solid #ddd;">{{this.serviceName}}</td>
              <td style="padding: 8px; text-align: left; border: 1px solid #ddd;">{{this.remainingHours}}</td>
              <td style="padding: 8px; text-align: left; border: 1px solid #ddd;">{{this.expirationDate}}</td>
            </tr>
            {{/each}}
          </tbody>
        </table>
        <p style="margin-top: 20px;">Please use these prepaid hours before they expire.</p>
        <a href="{{hourBlocks.url}}" class="button">View Billing</a>
      `,
        text_content: `
Prepaid Hours Expiring Soon

Prepaid hours for {{company.name}} will expire soon:

Company: {{company.name}}
Total Hours Remaining: {{hourBlocks.totalRemainingHours}} hrs
Expiration Date: {{hourBlocks.expirationDate}}
Days Until Expiration: {{hourBlocks.daysRemaining}}

Hour Block Details:
{{#each hourBlocks.items}}
- {{this.serviceName}}: {{this.remainingHours}} hrs remaining, expires {{this.expirationDate}}
{{/each}}

Please use these prepaid hours before they expire.

View billing at: {{hourBlocks.url}}
      `
      })
      .returning('id');
    marker.created_template_id = createdTemplate.id;
  }

  await writeMarker(knex, marker);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  const marker = await readMarker(knex);

  if (marker.created_template_id != null) {
    await knex('system_email_templates')
      .where({ id: marker.created_template_id })
      .del();
  }

  if (marker.created_subtype_id != null) {
    await knex('notification_subtypes')
      .where({ id: marker.created_subtype_id })
      .del();
  }

  if (marker.created_category_id != null) {
    // Defensive: only drop the category this migration created when nothing
    // else has attached itself to it since (the FK would cascade-delete
    // those rows otherwise).
    const remaining = await knex('notification_subtypes')
      .where({ category_id: marker.created_category_id })
      .count('* as count')
      .first();

    if (!remaining || Number(remaining.count) === 0) {
      await knex('notification_categories')
        .where({ id: marker.created_category_id })
        .del();
    }
  }

  const markerExists = await knex.schema.hasTable(MARKER_TABLE);
  if (markerExists) {
    await knex.schema.dropTable(MARKER_TABLE);
  }
};
