import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import knexLib from 'knex';

// Behavioral migration coverage for 20260813120100 (Hour Block Expiring
// notification subtype/template): the down must remove ONLY rows the migration
// can prove it created. These tests execute the REAL migration module's
// up/down against the dev DB (not a mock) for both directions:
//   (a) pre-existing category/subtype/template rows survive a down (and up
//       neither duplicates nor rewrites them);
//   (b) rows the migration itself created are removed by down — including the
//       category when the migration created it, and the defensive guard that
//       keeps a migration-created category that foreign subtypes have since
//       attached themselves to.
//
// The notification tables are global (no tenant column) and the shared dev DB
// already holds live rows, so every test snapshots the affected subtree and
// restores it exactly (original ids included) in a finally block.

const enabled = process.env.HOUR_BLOCK_DB_TESTS === '1';

const config = {
  host: process.env.HOUR_BLOCK_DB_HOST || '127.0.0.1',
  port: Number(process.env.HOUR_BLOCK_DB_PORT || 6472),
  user: process.env.HOUR_BLOCK_DB_USER || 'app_user',
  password: process.env.HOUR_BLOCK_DB_PASSWORD || '',
  database: process.env.HOUR_BLOCK_DB_NAME || 'server',
};

const MARKER_TABLE = 'migration_20260813120100_marker';

// Tables with an FK into notification_subtypes (all ON DELETE CASCADE) whose
// rows must be snapshotted/restored around subtype deletion.
const SUBTYPE_DEPENDENT_TABLES = [
  'user_notification_preferences',
  'notification_logs',
  'tenant_notification_subtype_settings',
];

let db: Knex;
let migration: { up: (knex: Knex) => Promise<void>; down: (knex: Knex) => Promise<void> };

type Row = Record<string, any>;

interface SubtreeSnapshot {
  category: Row | null;
  subtype: Row | null;
  template: Row | null;
  subtypeDependents: Row[];
  templateLinks: Row[];
}

async function dropMarkerTableIfExists() {
  const exists = await db.schema.hasTable(MARKER_TABLE);
  if (exists) {
    await db.schema.dropTable(MARKER_TABLE);
  }
}

async function readMarker(): Promise<Row> {
  const exists = await db.schema.hasTable(MARKER_TABLE);
  if (!exists) return {};
  const rows: Row[] = await db(MARKER_TABLE).where({ marker_key: 'created_ids' });
  if (rows.length === 0) return {};
  const raw = rows[0].marker_value;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function snapshotSubtree(): Promise<SubtreeSnapshot> {
  const category = await db('notification_categories').where({ name: 'Invoices' }).first() ?? null;
  const subtype = await db('notification_subtypes').where({ name: 'Hour Block Expiring' }).first() ?? null;
  const template = subtype
    ? await db('system_email_templates').where({ notification_subtype_id: subtype.id })
        .where({ name: 'hour-block-expiring' }).first() ?? null
    : await db('system_email_templates').where({ name: 'hour-block-expiring' }).first() ?? null;

  const subtypeDependents: Row[] = [];
  if (subtype) {
    for (const table of SUBTYPE_DEPENDENT_TABLES) {
      const hasTable = await db.schema.hasTable(table);
      if (!hasTable) continue;
      const rows = await db(table).where({ subtype_id: subtype.id });
      for (const row of rows) subtypeDependents.push({ table, row });
    }
  }

  const templateLinks: Row[] = [];
  if (template) {
    const rows = await db('tenant_email_templates').where({ system_template_id: template.id });
    for (const row of rows) templateLinks.push({ id: row.id, system_template_id: row.system_template_id });
  }

  return { category, subtype, template, subtypeDependents, templateLinks };
}

async function restoreSubtree(snap: SubtreeSnapshot) {
  if (snap.subtype) {
    await db('notification_subtypes').insert(snap.subtype);
  }
  if (snap.template) {
    await db('system_email_templates').insert(snap.template);
  }
  for (const { table, row } of snap.subtypeDependents) {
    await db(table).insert(row);
  }
  for (const link of snap.templateLinks) {
    await db('tenant_email_templates')
      .where({ id: link.id })
      .update({ system_template_id: link.system_template_id });
  }
}

async function deleteHourBlockNotificationRows() {
  await db('system_email_templates').where({ name: 'hour-block-expiring' }).del();
  await db('notification_subtypes').where({ name: 'Hour Block Expiring' }).del();
}

async function cleanupToSnapshot(snap: SubtreeSnapshot) {
  // Remove whatever the test left behind, then restore the exact original.
  await deleteHourBlockNotificationRows();
  if (!snap.subtype) {
    // A subtype the migration created under a fresh category may cascade-drop
    // with the category; deleteHourBlockNotificationRows is a no-op then.
  }
  // Remove a migration-created category only when the original was renamed or
  // absent; restoring a renamed original happens at the call site.
  const currentCategory = await db('notification_categories').where({ name: 'Invoices' }).first();
  if (currentCategory && snap.category && currentCategory.id !== snap.category.id) {
    const remaining = await db('notification_subtypes')
      .where({ category_id: currentCategory.id })
      .count('* as count')
      .first();
    if (Number(remaining?.count ?? 0) === 0) {
      await db('notification_categories').where({ id: currentCategory.id }).del();
    }
  }
  await restoreSubtree(snap);
  await dropMarkerTableIfExists();
}

describe.runIf(enabled)('20260813120100 hour block notification migration rollback safety', () => {
  beforeAll(async () => {
    db = knexLib({ client: 'pg', connection: config, pool: { min: 0, max: 2 } });
    const loaded = (await import('../20260813120100_add_hour_block_expiration_notification.cjs')) as any;
    migration = { up: loaded.up, down: loaded.down };
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('case (a): pre-existing category/subtype/template rows survive down, and up does not duplicate them', async () => {
    const snap = await snapshotSubtree();
    try {
      // Establish the pre-existing state: category + subtype + template all
      // present before the migration ever runs (seed if the DB is fresh).
      let category = snap.category;
      if (!category) {
        [category] = await db('notification_categories').insert({
          name: 'Invoices',
          description: 'Pre-existing sentinel category',
          is_enabled: true,
          is_default_enabled: true,
        }).returning('*');
      }
      let subtype = snap.subtype;
      if (!subtype) {
        [subtype] = await db('notification_subtypes').insert({
          category_id: category.id,
          name: 'Hour Block Expiring',
          description: 'Pre-existing sentinel subtype — must survive migration down',
          is_enabled: true,
          is_default_enabled: true,
        }).returning('*');
      }
      let template = snap.template;
      if (!template) {
        [template] = await db('system_email_templates').insert({
          name: 'hour-block-expiring',
          subject: 'Pre-existing sentinel template — must survive migration down',
          notification_subtype_id: subtype.id,
          html_content: '<p>sentinel</p>',
          text_content: 'sentinel',
        }).returning('*');
      }
      await dropMarkerTableIfExists();

      await migration.up(db);

      // No duplicates and no rewrites of the pre-existing rows.
      const subtypeCount = await db('notification_subtypes').where({ name: 'Hour Block Expiring' }).count('* as count').first();
      expect(Number(subtypeCount?.count)).toBe(1);
      const templateCount = await db('system_email_templates').where({ name: 'hour-block-expiring' }).count('* as count').first();
      expect(Number(templateCount?.count)).toBe(1);

      const subtypeAfterUp = await db('notification_subtypes').where({ id: subtype.id }).first();
      expect(subtypeAfterUp.description).toBe(subtype.description);
      const templateAfterUp = await db('system_email_templates').where({ id: template.id }).first();
      expect(templateAfterUp.subject).toBe(template.subject);

      // The marker must not claim ownership of rows it did not create.
      const marker = await readMarker();
      expect(marker.created_subtype_id).toBeUndefined();
      expect(marker.created_template_id).toBeUndefined();
      expect(marker.created_category_id).toBeUndefined();

      await migration.down(db);

      // Everything pre-existing is still there, unchanged.
      const subtypeAfterDown = await db('notification_subtypes').where({ id: subtype.id }).first();
      expect(subtypeAfterDown).toBeTruthy();
      expect(subtypeAfterDown.description).toBe(subtype.description);
      const templateAfterDown = await db('system_email_templates').where({ id: template.id }).first();
      expect(templateAfterDown).toBeTruthy();
      expect(templateAfterDown.subject).toBe(template.subject);
      expect(await db('notification_categories').where({ id: category.id }).first()).toBeTruthy();
      expect(await db.schema.hasTable(MARKER_TABLE)).toBe(false);
    } finally {
      await cleanupToSnapshot(snap);
      // If we seeded rows on a fresh DB, remove the seeds (snapshot was empty).
      if (!snap.subtype) {
        await deleteHourBlockNotificationRows();
      }
      if (!snap.category) {
        await db('notification_categories').where({ name: 'Invoices' }).del();
      }
    }
  });

  it('case (b): subtype/template rows the migration created are removed by down', async () => {
    const snap = await snapshotSubtree();
    try {
      // Simulate the rows not existing yet. Deleting the subtype cascades the
      // template and dependent rows; all are restored from the snapshot.
      if (snap.subtype) {
        await db('notification_subtypes').where({ id: snap.subtype.id }).del();
      }
      await dropMarkerTableIfExists();

      await migration.up(db);

      const createdSubtype = await db('notification_subtypes').where({ name: 'Hour Block Expiring' }).first();
      expect(createdSubtype).toBeTruthy();
      const createdTemplate = await db('system_email_templates').where({ name: 'hour-block-expiring' }).first();
      expect(createdTemplate).toBeTruthy();

      const marker = await readMarker();
      expect(marker.created_subtype_id).toBe(createdSubtype.id);
      expect(marker.created_template_id).toBe(createdTemplate.id);
      // The category pre-existed in this scenario, so the marker must not own it.
      if (snap.category) {
        expect(marker.created_category_id).toBeUndefined();
      }

      await migration.down(db);

      expect(await db('notification_subtypes').where({ name: 'Hour Block Expiring' }).first()).toBeFalsy();
      expect(await db('system_email_templates').where({ name: 'hour-block-expiring' }).first()).toBeFalsy();
      expect(await db.schema.hasTable(MARKER_TABLE)).toBe(false);
      // A pre-existing category is untouched by down.
      if (snap.category) {
        expect(await db('notification_categories').where({ id: snap.category.id }).first()).toBeTruthy();
      }
    } finally {
      await cleanupToSnapshot(snap);
    }
  });

  it('case (b): a category the migration created is removed by down in a fresh environment', async () => {
    const snap = await snapshotSubtree();
    const renamed = `Invoices__hb_migration_test_${Date.now()}`;
    try {
      // Make the environment "fresh" for the Invoices category: rename the
      // real one out of the way (subtypes stay attached), remove hour-block
      // rows, and drop any marker.
      if (snap.category) {
        await db('notification_categories').where({ id: snap.category.id }).update({ name: renamed });
      }
      await deleteHourBlockNotificationRows();
      await dropMarkerTableIfExists();

      await migration.up(db);

      const createdCategory = await db('notification_categories').where({ name: 'Invoices' }).first();
      expect(createdCategory).toBeTruthy();
      const createdSubtype = await db('notification_subtypes').where({ name: 'Hour Block Expiring' }).first();
      expect(createdSubtype).toBeTruthy();
      expect(createdSubtype.category_id).toBe(createdCategory.id);
      expect(await db('system_email_templates').where({ name: 'hour-block-expiring' }).first()).toBeTruthy();

      const marker = await readMarker();
      expect(marker.created_category_id).toBe(createdCategory.id);
      expect(marker.created_subtype_id).toBe(createdSubtype.id);
      expect(marker.created_template_id).toBe((await db('system_email_templates').where({ name: 'hour-block-expiring' }).first()).id);

      await migration.down(db);

      expect(await db('notification_categories').where({ name: 'Invoices' }).first()).toBeFalsy();
      expect(await db('notification_subtypes').where({ name: 'Hour Block Expiring' }).first()).toBeFalsy();
      expect(await db('system_email_templates').where({ name: 'hour-block-expiring' }).first()).toBeFalsy();
      expect(await db.schema.hasTable(MARKER_TABLE)).toBe(false);
    } finally {
      // Undo the fresh-environment simulation, then restore the snapshot.
      const stray = await db('notification_categories').where({ name: 'Invoices' }).first();
      if (stray) {
        const remaining = await db('notification_subtypes').where({ category_id: stray.id }).count('* as count').first();
        if (Number(remaining?.count ?? 0) === 0) {
          await db('notification_categories').where({ id: stray.id }).del();
        }
      }
      if (snap.category) {
        await db('notification_categories').where({ id: snap.category.id }).update({ name: 'Invoices' });
      }
      await restoreSubtree(snap);
      await dropMarkerTableIfExists();
    }
  });

  it('case (b) guard: down keeps a migration-created category that a foreign subtype attached itself to', async () => {
    const snap = await snapshotSubtree();
    const foreignName = `HB Migration Test Foreign Subtype ${Date.now()}`;
    const renamed = `Invoices__hb_migration_guard_${Date.now()}`;
    try {
      if (snap.category) {
        await db('notification_categories').where({ id: snap.category.id }).update({ name: renamed });
      }
      await deleteHourBlockNotificationRows();
      await dropMarkerTableIfExists();

      await migration.up(db);

      const createdCategory = await db('notification_categories').where({ name: 'Invoices' }).first();
      expect(createdCategory).toBeTruthy();

      // A foreign subtype appears under the migration-created category after up.
      const [foreign] = await db('notification_subtypes').insert({
        category_id: createdCategory.id,
        name: foreignName,
        description: 'Foreign subtype that must keep its category',
        is_enabled: true,
        is_default_enabled: true,
      }).returning('*');

      await migration.down(db);

      // The migration's own subtype/template are gone, but the category and
      // the foreign subtype survive.
      expect(await db('notification_subtypes').where({ name: 'Hour Block Expiring' }).first()).toBeFalsy();
      expect(await db('system_email_templates').where({ name: 'hour-block-expiring' }).first()).toBeFalsy();
      const keptCategory = await db('notification_categories').where({ id: createdCategory.id }).first();
      expect(keptCategory).toBeTruthy();
      expect(await db('notification_subtypes').where({ id: foreign.id }).first()).toBeTruthy();
      expect(await db.schema.hasTable(MARKER_TABLE)).toBe(false);
    } finally {
      await db('notification_subtypes').where({ name: foreignName }).del();
      const stray = await db('notification_categories').where({ name: 'Invoices' }).first();
      if (stray && (!snap.category || stray.id !== snap.category.id)) {
        const remaining = await db('notification_subtypes').where({ category_id: stray.id }).count('* as count').first();
        if (Number(remaining?.count ?? 0) === 0) {
          await db('notification_categories').where({ id: stray.id }).del();
        }
      }
      if (snap.category) {
        await db('notification_categories').where({ id: snap.category.id }).update({ name: 'Invoices' });
      }
      await restoreSubtree(snap);
      await dropMarkerTableIfExists();
    }
  });

  // The b2b3038e rollback probe (regression): after `up`, a FOREIGN row (here:
  // a system_email_template the migration never created, plus a tenant's
  // subtype settings) attaches itself to the migration-created subtype. The
  // old `down` deleted the subtype unconditionally and the ON DELETE CASCADE
  // destroyed the foreign rows. The fixed `down` keeps the subtype (safety
  // over cleanup), removes exactly its own template, and a re-`up` re-applies
  // idempotently against the surviving subtype.
  it('case (b) guard: down keeps a migration-created subtype that a foreign template/settings attached itself to, and re-up is idempotent', async () => {
    const snap = await snapshotSubtree();
    const foreignTemplateName = `hb-migration-foreign-template-${Date.now()}`;
    const foreignTenant = uuidv4();
    try {
      // Start from a clean slate so the migration creates the subtype itself.
      if (snap.subtype) {
        await db('notification_subtypes').where({ id: snap.subtype.id }).del();
      }
      await dropMarkerTableIfExists();

      await migration.up(db);

      const createdSubtype = await db('notification_subtypes').where({ name: 'Hour Block Expiring' }).first();
      expect(createdSubtype).toBeTruthy();
      const markerAfterUp = await readMarker();
      expect(markerAfterUp.created_subtype_id).toBe(createdSubtype.id);

      // Foreign, non-migration rows appear under the migration-created subtype.
      // The tenant settings row needs a real tenants row (FK).
      const [foreignTemplate] = await db('system_email_templates').insert({
        name: foreignTemplateName,
        subject: 'Foreign template that must survive migration down',
        notification_subtype_id: createdSubtype.id,
        html_content: '<p>foreign</p>',
        text_content: 'foreign',
      }).returning('*');
      await db('tenants').insert({
        tenant: foreignTenant,
        client_name: 'HB Migration Foreign Tenant',
        email: 'hb-migration-foreign@test.local',
        billing_source: 'test',
      });
      await db('tenant_notification_subtype_settings').insert({
        tenant: foreignTenant,
        subtype_id: createdSubtype.id,
      });

      await migration.down(db);

      // The foreign rows SURVIVE (the b2 regression: they were cascade-deleted).
      expect(await db('system_email_templates').where({ id: foreignTemplate.id }).first()).toBeTruthy();
      expect(await db('tenant_notification_subtype_settings').where({ tenant: foreignTenant, subtype_id: createdSubtype.id }).first()).toBeTruthy();
      // The migration's own template is gone, the subtype is kept (childless
      // delete refused), and the marker bookkeeping is cleaned up.
      expect(await db('system_email_templates').where({ name: 'hour-block-expiring' }).first()).toBeFalsy();
      const keptSubtype = await db('notification_subtypes').where({ id: createdSubtype.id }).first();
      expect(keptSubtype).toBeTruthy();
      expect(await db.schema.hasTable(MARKER_TABLE)).toBe(false);

      // Idempotent re-application: up reuses the surviving subtype, recreates
      // its own template, and the marker only claims the newly created rows.
      await migration.up(db);
      const reupSubtype = await db('notification_subtypes').where({ name: 'Hour Block Expiring' }).first();
      expect(reupSubtype.id).toBe(createdSubtype.id);
      const reupTemplate = await db('system_email_templates').where({ name: 'hour-block-expiring' }).first();
      expect(reupTemplate).toBeTruthy();
      const markerAfterReup = await readMarker();
      expect(markerAfterReup.created_subtype_id).toBeUndefined();
      expect(markerAfterReup.created_template_id).toBe(reupTemplate.id);
      expect(await db('system_email_templates').where({ id: foreignTemplate.id }).first()).toBeTruthy();

      // And down again removes only the re-created template.
      await migration.down(db);
      expect(await db('system_email_templates').where({ name: 'hour-block-expiring' }).first()).toBeFalsy();
      expect(await db('notification_subtypes').where({ id: createdSubtype.id }).first()).toBeTruthy();
      expect(await db('system_email_templates').where({ id: foreignTemplate.id }).first()).toBeTruthy();
      expect(await db.schema.hasTable(MARKER_TABLE)).toBe(false);
    } finally {
      await db('tenant_notification_subtype_settings').where({ tenant: foreignTenant }).del();
      await db('tenants').where({ tenant: foreignTenant }).del();
      await db('system_email_templates').where({ name: foreignTemplateName }).del();
      await cleanupToSnapshot(snap);
    }
  });
});
