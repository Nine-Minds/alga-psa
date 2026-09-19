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
 * this migration or that attached themselves after `up` (a name-based delete
 * could remove rows created elsewhere, and a parent delete cascades: every FK
 * into notification_subtypes/notification_categories is ON DELETE CASCADE, so
 * removing a subtype takes foreign templates, tenant subtype settings, user
 * preferences and notification logs with it — verified in review run
 * b2b3038e). `up` therefore detects what already exists and records, in a
 * migration-owned marker table, the exact ids of the category/subtype/template
 * rows IT created. `down` deletes the recorded template by id (its only FK
 * dependent, tenant_email_templates, is ON DELETE SET NULL — links detach,
 * nothing is destroyed), and removes a recorded parent (subtype/category) ONLY
 * when a catalog-driven child count proves nothing else has attached itself to
 * it. Parents with foreign children stay; safety over cleanup. In an
 * environment where the marker is absent (e.g. this migration ran before
 * marker bookkeeping existed), `down` removes nothing.
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
 * Counts rows across every table that holds a foreign key into `tableName`,
 * referencing `targetId`. The dependents are discovered from the live catalog
 * (not a hardcoded list), so constraints added by later migrations are covered
 * too. Used to prove a migration-created parent row is childless before
 * deleting it — every FK into these parents cascades, so deleting a parent
 * with rows attached would destroy data this migration did not create.
 */
async function countForeignChildren(knex, tableName, targetId) {
  // One row per FK column (unnest + ordinality), grouped per referencing
  // table below — array_agg is avoided because some pg drivers return it as
  // an unparsed "{a,b}" literal.
  const columnRows = await knex.raw(
    `SELECT conrelid::regclass::text AS referencing_table,
            a.attname AS referencing_column,
            k.ord AS fk_ordinal
       FROM pg_constraint con
       CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord)
       JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
      WHERE con.contype = 'f'
        AND con.confrelid = ?::regclass
      ORDER BY referencing_table, k.ord`,
    [tableName]
  );

  const columnsByTable = new Map();
  for (const row of columnRows.rows) {
    const columns = columnsByTable.get(row.referencing_table) || [];
    columns.push(row.referencing_column);
    columnsByTable.set(row.referencing_table, columns);
  }

  let total = 0;
  for (const [referencingTable, columns] of columnsByTable) {
    const whereSql = columns.map((column) => `"${column}" = ?`).join(' AND ');
    const countRow = await knex.raw(
      `SELECT count(*) AS count FROM ${referencingTable} WHERE ${whereSql}`,
      columns.map(() => targetId)
    );
    total += Number(countRow.rows[0].count);
  }
  return total;
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  const marker = await readMarker(knex);

  if (marker.created_template_id != null) {
    // Exactly the row `up` inserted. Its only FK dependent
    // (tenant_email_templates.system_template_id) is ON DELETE SET NULL, so
    // tenant links detach instead of being destroyed.
    await knex('system_email_templates')
      .where({ id: marker.created_template_id })
      .del();
  }

  if (marker.created_subtype_id != null && (await countForeignChildren(knex, 'notification_subtypes', marker.created_subtype_id)) === 0) {
    // The marker proves this migration created the subtype; the child count
    // proves nothing else (a foreign template, a tenant's subtype settings, a
    // user preference, a notification log) has attached itself to it since.
    // All such children cascade on delete — an unconditional delete destroyed
    // them (review run b2b3038e), so a parent with children stays put.
    await knex('notification_subtypes')
      .where({ id: marker.created_subtype_id })
      .del();
  }

  if (marker.created_category_id != null && (await countForeignChildren(knex, 'notification_categories', marker.created_category_id)) === 0) {
    // Same discipline as the subtype: the category cascades into subtypes AND
    // tenant_notification_category_settings, so it may only be removed when
    // provably childless.
    await knex('notification_categories')
      .where({ id: marker.created_category_id })
      .del();
  }

  const markerExists = await knex.schema.hasTable(MARKER_TABLE);
  if (markerExists) {
    await knex.schema.dropTable(MARKER_TABLE);
  }
};
