/**
 * Template locale parity guard.
 *
 * Builds every module-defined system email / internal notification template
 * through the same upsert helpers the migrations use, against an in-memory
 * knex stub, and asserts each shipped template carries every supported locale.
 * This stops a new template from being merged without its pt (or any other)
 * variant — the drift that left many production templates without Portuguese.
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const migrationsDir = path.resolve(__dirname, '../../../../migrations');

const { SUPPORTED_LANGUAGES } = require(path.join(
  migrationsDir,
  'utils/templates/_shared/constants.cjs',
));
const { upsertEmailCategoriesAndSubtypes } = require(path.join(
  migrationsDir,
  'utils/templates/_shared/emailCategoriesAndSubtypes.cjs',
));
const { upsertEmailTemplate } = require(path.join(
  migrationsDir,
  'utils/templates/_shared/upsertEmailTemplates.cjs',
));
const { upsertCategoriesAndSubtypes } = require(path.join(
  migrationsDir,
  'utils/templates/internal/categoriesAndSubtypes.cjs',
));
const { upsertInternalTemplates } = require(path.join(
  migrationsDir,
  'utils/templates/_shared/upsertInternalTemplates.cjs',
));

// ---------------------------------------------------------------------------
// In-memory knex stub (insert / onConflict / merge / select)
// ---------------------------------------------------------------------------

type Row = Record<string, any>;

const TABLE_PRIMARY_KEYS: Record<string, string> = {
  notification_categories: 'id',
  notification_subtypes: 'id',
  internal_notification_categories: 'internal_notification_category_id',
  internal_notification_subtypes: 'internal_notification_subtype_id',
};

function resolveTemplateValue(template: any, stored: Row): any {
  if (template && template.__raw && typeof template.column === 'string') {
    return stored[template.column];
  }
  return template;
}

function makeKnex() {
  const state = new Map<string, Row[]>();
  const sequences = new Map<string, number>();

  const rowsFor = (name: string): Row[] => {
    if (!state.has(name)) state.set(name, []);
    return state.get(name)!;
  };

  const knex: any = (name: string) => {
    const assignPrimaryKey = (row: Row): void => {
      const pk = TABLE_PRIMARY_KEYS[name];
      if (pk && row[pk] === undefined) {
        const next = (sequences.get(name) || 0) + 1;
        sequences.set(name, next);
        row[pk] = next;
      }
    };

    const execute = (rows: Row[], conflictColumns: string[], mergeSpec: any, columns: any): Row[] => {
      const list = rowsFor(name);
      const cols: string[] | null = columns === '*' || columns == null ? null : Array.isArray(columns) ? columns : [columns];
      const result: Row[] = [];
      for (const row of rows) {
        assignPrimaryKey(row);
        // The real schema defaults language_code to 'en' (NOT NULL); knex
        // omits undefined keys, so apply the DB default here.
        if ((name === 'system_email_templates' || name === 'internal_notification_templates') && row.language_code === undefined) {
          row.language_code = 'en';
        }
        const existing =
          conflictColumns.length > 0
            ? list.find((candidate) => conflictColumns.every((column) => candidate[column] === row[column]))
            : undefined;
        let stored: Row;
        if (existing) {
          if (mergeSpec == null) {
            stored = existing;
          } else if (Array.isArray(mergeSpec)) {
            for (const column of mergeSpec) existing[column] = row[column];
            stored = existing;
          } else {
            Object.assign(existing, row);
            for (const [column, template] of Object.entries(mergeSpec)) {
              existing[column] = resolveTemplateValue(template, existing);
            }
            stored = existing;
          }
        } else {
          stored = { ...row };
          list.push(stored);
        }
        if (cols) {
          const picked: Row = {};
          for (const column of cols) picked[column] = stored[column];
          result.push(picked);
        } else {
          result.push({ ...stored });
        }
      }
      return result;
    };

    return {
      where(criteria: Row) {
        return {
          async first() {
            return rowsFor(name).find((row) =>
              Object.entries(criteria).every(([key, value]) => row[key] === value),
            );
          },
        };
      },
      whereIn(column: string, values: any[]) {
        return {
          async del() {
            const list = rowsFor(name);
            const remaining = list.filter((row) => !values.includes(row[column]));
            state.set(name, remaining);
            return list.length - remaining.length;
          },
        };
      },
      select(...columns: string[]) {
        return Promise.resolve(
          rowsFor(name).map((row) => {
            const picked: Row = {};
            for (const column of columns) picked[column] = row[column];
            return picked;
          }),
        );
      },
      insert(input: Row | Row[]) {
        const rows = Array.isArray(input) ? input : [input];
        const api: any = {
          conflictColumns: [] as string[],
          mergeSpec: null as any,
          onConflict(columns: any) {
            api.conflictColumns = Array.isArray(columns) ? columns : [columns];
            return api;
          },
          merge(spec: any) {
            api.mergeSpec = spec;
            const merged: any = Promise.resolve(execute(rows, api.conflictColumns, api.mergeSpec, null));
            merged.returning = (columns: any) => Promise.resolve(execute(rows, api.conflictColumns, api.mergeSpec, columns));
            return merged;
          },
          returning(columns: any) {
            return Promise.resolve(execute(rows, api.conflictColumns, api.mergeSpec, columns));
          },
          then(onFulfilled: any, onRejected: any) {
            return Promise.resolve(execute(rows, api.conflictColumns, api.mergeSpec, null)).then(onFulfilled, onRejected);
          },
        };
        return api;
      },
    };
  };

  knex.raw = (sql: string) => {
    const match = /excluded\.([A-Za-z0-9_]+)/.exec(sql);
    return { __raw: sql, column: match ? match[1] : undefined };
  };
  return knex;
}

// ---------------------------------------------------------------------------
// Module-defined template defs
// ---------------------------------------------------------------------------

function emailTemplateDefs() {
  const { TEMPLATE_GETTERS } = require(path.join(migrationsDir, '20260625120000_add_portuguese_email_templates.cjs'));
  const defs = TEMPLATE_GETTERS.map((getter: any) => getter());
  // Locale-gapped modules not yet folded into the pt migration's getter list.
  defs.push(require(path.join(migrationsDir, 'utils/templates/email/opportunities/opportunityWeeklyDigest.cjs')).getTemplate());
  return defs;
}

function internalTemplateDefs() {
  const { ALL_TEMPLATES } = require(path.join(migrationsDir, '20260625121000_add_portuguese_internal_notification_templates.cjs'));
  const { TEMPLATES: opportunityTemplates } = require(path.join(migrationsDir, 'utils/templates/internal/opportunities.cjs'));
  return [...ALL_TEMPLATES, ...opportunityTemplates];
}

function rowsByTemplate(rows: Row[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!map.has(row.name)) map.set(row.name, new Set());
    map.get(row.name)!.add(row.language_code);
  }
  return map;
}

describe('template locale parity', () => {
  it('ships every supported locale for every module-defined system email template', async () => {
    const knex = makeKnex();
    await upsertEmailCategoriesAndSubtypes(knex);
    // Creates the 'Opportunities' category + 'Opportunity Weekly Digest' subtype.
    await require(path.join(migrationsDir, '20260712105300_add_opportunity_notification_templates.cjs')).up(knex);
    const defs = emailTemplateDefs();
    for (const def of defs) {
      await upsertEmailTemplate(knex, def);
    }
    const rows = await knex('system_email_templates').select('name', 'language_code');
    const byTemplate = rowsByTemplate(rows);

    const missing: string[] = [];
    for (const def of defs) {
      const shipped = byTemplate.get(def.templateName) || new Set();
      for (const locale of SUPPORTED_LANGUAGES) {
        if (!shipped.has(locale)) missing.push(`${def.templateName}:${locale}`);
      }
    }
    expect(missing).toEqual([]);
    expect(defs.length).toBeGreaterThanOrEqual(42);
  });

  it('ships every supported locale for every module-defined internal notification template', async () => {
    const knex = makeKnex();
    await upsertCategoriesAndSubtypes(knex);
    // The opportunity category/subtypes are created by their own migration.
    await require(path.join(migrationsDir, '20260712105300_add_opportunity_notification_templates.cjs')).up(knex);
    const defs = internalTemplateDefs();
    await upsertInternalTemplates(knex, defs);
    const rows = await knex('internal_notification_templates').select('name', 'language_code');
    const byTemplate = rowsByTemplate(rows);

    const missing: string[] = [];
    for (const def of defs) {
      const shipped = byTemplate.get(def.templateName) || new Set();
      for (const locale of SUPPORTED_LANGUAGES) {
        if (!shipped.has(locale)) missing.push(`${def.templateName}:${locale}`);
      }
    }
    expect(missing).toEqual([]);
    expect(defs.length).toBeGreaterThanOrEqual(51);
  });

  it('keeps the migration locale list aligned with the runtime locale config', () => {
    const { LOCALE_CONFIG } = require(path.resolve(
      __dirname,
      '../../../../../packages/email/src/lib/localeConfig.ts',
    ));
    expect([...SUPPORTED_LANGUAGES].sort()).toEqual([...LOCALE_CONFIG.supportedLocales].sort());
  });

  it('ships every supported locale for the inline-defined templates', async () => {
    // These templates are defined inline in their own migrations rather than
    // in a shared template module, so they drifted without a shared def to
    // check. Run their migrations plus the locale-fill migration and assert
    // full coverage.
    const knex = makeKnex();
    await upsertEmailCategoriesAndSubtypes(knex);
    await upsertCategoriesAndSubtypes(knex);
    // The fill migration also re-upserts the opportunity templates.
    await require(path.join(migrationsDir, '20260712105300_add_opportunity_notification_templates.cjs')).up(knex);
    await require(path.join(migrationsDir, '20260612090200_add_rmm_alert_notifications.cjs')).up(knex);
    await require(path.join(migrationsDir, '20260701091000_inventory_low_stock_notification.cjs')).up(knex);
    await require(path.join(migrationsDir, '20260702151000_inventory_po_received_notification.cjs')).up(knex);
    await require(path.join(migrationsDir, '20260730093000_add_missing_locale_email_and_internal_templates.cjs')).up(knex);

    const expectations: Array<[string, string[]]> = [
      ['system_email_templates', ['rmm-alert-triggered']],
      ['internal_notification_templates', ['rmm-alert-triggered', 'inventory-low-stock', 'inventory-po-received']],
    ];
    const missing: string[] = [];
    for (const [table, names] of expectations) {
      const rows = await knex(table).select('name', 'language_code');
      const byTemplate = rowsByTemplate(rows);
      for (const name of names) {
        const shipped = byTemplate.get(name) || new Set();
        for (const locale of SUPPORTED_LANGUAGES) {
          if (!shipped.has(locale)) missing.push(`${name}:${locale}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
