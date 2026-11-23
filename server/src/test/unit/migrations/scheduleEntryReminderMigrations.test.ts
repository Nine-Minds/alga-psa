import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const migrationsDir = path.resolve(__dirname, '../../../../migrations');
const read = (f: string) => fs.readFileSync(path.join(migrationsDir, f), 'utf8');

const CATALOG = '20261123090000_add_schedule_entry_reminder_notification.cjs';
const LEDGER = '20261123090100_create_schedule_entry_reminder_deliveries.cjs';

describe('schedule entry reminder migrations (T011)', () => {
  it('catalog: registers category and subtype (enabled by default) in the shared source of truth', () => {
    const { CATEGORIES, SUBTYPES } = require(path.join(migrationsDir, 'utils/templates/internal/categoriesAndSubtypes.cjs'));
    expect(CATEGORIES).toContainEqual(expect.objectContaining({ name: 'schedule', is_enabled: true, is_default_enabled: true }));
    expect(SUBTYPES).toContainEqual(expect.objectContaining({ category: 'schedule', name: 'schedule-entry-reminder' }));
  });

  it('catalog: adds toast_on_arrival before flagging, sets normal priority, seeds templates, has a down', async () => {
    const src = read(CATALOG);
    expect(src.indexOf('ADD COLUMN IF NOT EXISTS toast_on_arrival boolean NOT NULL DEFAULT false'))
      .toBeGreaterThan(-1);
    expect(src.indexOf('toast_on_arrival boolean')).toBeLessThan(src.indexOf('toast_on_arrival: true'));
    expect(src).toContain("default_priority: 'normal'");
    expect(src).toContain('upsertInternalTemplates');
    expect(src).toContain('DROP COLUMN IF EXISTS toast_on_arrival');

    const updates: any[] = [];
    const deleted: string[] = [];
    const raws: string[] = [];
    const upserts: any[] = [];
    const knex: any = (table: string) => ({
      where: (w: any) => ({
        update: async (u: any) => { updates.push([table, w, u]); },
        del: async () => { deleted.push(`${table}:${JSON.stringify(w)}`); },
        first: async () => ({ name: w.name }),
      }),
    });
    knex.raw = async (sql: string) => { raws.push(sql); };
    // Run the real up() with the shared helpers stubbed through the module cache.
    const cat = require(path.join(migrationsDir, 'utils/templates/internal/categoriesAndSubtypes.cjs'));
    const tpl = require(path.join(migrationsDir, 'utils/templates/_shared/upsertInternalTemplates.cjs'));
    const origCat = cat.upsertCategoriesAndSubtypes;
    const origTpl = tpl.upsertInternalTemplates;
    cat.upsertCategoriesAndSubtypes = vi.fn(async () => {});
    tpl.upsertInternalTemplates = vi.fn(async (_k: any, defs: any[]) => { upserts.push(...defs); });
    try {
      delete require.cache[require.resolve(path.join(migrationsDir, CATALOG))];
      const migration = require(path.join(migrationsDir, CATALOG));
      await migration.up(knex);
      expect(raws[0]).toContain('toast_on_arrival');
      expect(updates).toEqual([[
        'internal_notification_subtypes',
        { name: 'schedule-entry-reminder' },
        { toast_on_arrival: true, default_priority: 'normal' },
      ]]);
      expect(upserts.map((d) => d.templateName)).toEqual(['schedule-entry-reminder', 'schedule-entry-reminder-now']);
      await migration.down(knex);
      expect(deleted).toContain('internal_notification_templates:{"name":"schedule-entry-reminder"}');
      expect(deleted).toContain('internal_notification_categories:{"name":"schedule"}');
    } finally {
      cat.upsertCategoriesAndSubtypes = origCat;
      tpl.upsertInternalTemplates = origTpl;
      delete require.cache[require.resolve(path.join(migrationsDir, CATALOG))];
    }
  });

  it('templates: both variants carry all 9 locales with distinct (non-English) copy', () => {
    const { ALL_SCHEDULE_REMINDER_TEMPLATES } = require(path.join(migrationsDir, 'utils/templates/internal/scheduleEntryReminder.cjs'));
    for (const def of ALL_SCHEDULE_REMINDER_TEMPLATES) {
      expect(def.subtypeName).toBe('schedule-entry-reminder');
      expect(Object.keys(def.translations).sort()).toEqual(['de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'sv']);
      for (const [lang, t] of Object.entries<any>(def.translations)) {
        expect(t.title).toContain('{{entryTitle}}');
        expect(t.message).toContain('{{startTime}}');
        // German "in {{leadLabel}}" legitimately equals English in the title; the body must still differ.
        if (lang !== 'en') expect(t.message).not.toBe(def.translations.en.message);
      }
    }
  });

  it('ledger: tenant-leading PK, state check, retention index, tenant distribution, idempotent', async () => {
    const src = read(LEDGER);
    expect(src).toContain("createTable('schedule_entry_reminder_deliveries'");
    expect(src).toContain("table.primary(['tenant', 'entry_id', 'occurrence_start', 'user_id', 'lead_minutes'])");
    expect(src).toContain("table.index(['tenant', 'created_at']");
    expect(src).toContain("state IN ('pending', 'sending', 'sent', 'failed')");

    const created: any[] = [];
    const raws: string[] = [];
    const table: any = new Proxy({}, {
      get: (_t, prop: string) => (...args: any[]) => {
        created.push([prop, ...args]);
        return table;
      },
    });
    const knex: any = {
      schema: {
        hasTable: async () => false,
        createTable: async (_n: string, cb: (t: any) => void) => { cb(table); },
      },
      fn: { now: () => 'now()' },
      raw: async (sql: string) => {
        raws.push(sql);
        return { rows: [{ exists: true, is_distributed: false }] };
      },
    };
    await require(path.join(migrationsDir, LEDGER)).up(knex);
    expect(created).toContainEqual(['primary', ['tenant', 'entry_id', 'occurrence_start', 'user_id', 'lead_minutes']]);
    expect(raws.some((r) => r.includes("create_distributed_table('schedule_entry_reminder_deliveries', 'tenant'"))).toBe(true);

    raws.length = 0;
    knex.schema.hasTable = async () => true;
    await require(path.join(migrationsDir, LEDGER)).up(knex); // re-run: no createTable
  });
});
