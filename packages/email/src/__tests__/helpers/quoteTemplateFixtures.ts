import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const templates = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../server/migrations/utils/templates/email/quotes');

export interface TemplateBody {
  subject: string;
  html_content: string;
  text_content: string;
}

/** A system quote template body rendered from the template module, not typed in. */
export function quoteBody(module: 'quoteEmail' | 'quoteReminder', language: string, reviewLink: boolean): TemplateBody {
  const definition = require(path.join(templates, `${module}.cjs`)).getTemplate({ reviewLink });
  const translation = definition.translations.find((t: { language: string }) => t.language === language);
  return { subject: translation.subject, html_content: translation.htmlContent, text_content: translation.textContent };
}

type Row = Record<string, any>;

/**
 * A minimal in-memory stand-in for the tenantDb facade: enough query surface for the resolver
 * (`where`, `whereNull`, `select`, `first`) the apply flow (`insert`) and the backfill (grouped `where`/`orWhereNull`, `update`).
 */
export function fakeTenantDb(tables: Record<string, Row[]>) {
  const table = (name: string) => {
    const filters: Array<(row: Row) => boolean> = [];
    let updater: Row | null = null;
    const matching = () => (tables[name.replace(/ as \w+$/, '')] ?? []).filter((row) => filters.every((f) => f(row)));
    const query: any = {
      where(condition: Row | ((q: any) => void)) {
        if (typeof condition === 'function') {
          // Grouped `(a IS NULL OR b IS NULL)` as the backfill sends it.
          const group: Array<(row: Row) => boolean> = [];
          const sub: any = {
            whereNull(column: string) { group.push((row) => row[column] == null); return sub; },
            orWhereNull(column: string) { group.push((row) => row[column] == null); return sub; },
          };
          condition(sub);
          filters.push((row) => group.some((f) => f(row)));
          return query;
        }
        filters.push((row) => Object.entries(condition).every(([k, v]) => row[k] === v));
        return query;
      },
      whereNull(column: string) {
        filters.push((row) => row[column] === null || row[column] === undefined);
        return query;
      },
      select() { return query; },
      insert(values: Row | Row[]) {
        const target = (tables[name] ??= []);
        for (const row of Array.isArray(values) ? values : [values]) target.push({ id: target.length + 100, ...row });
        return Promise.resolve();
      },
      orderBy() { return query; },
      update(values: Row) {
        for (const row of matching()) {
          // knex.raw("jsonb_set(settings, ARRAY[key], value)") as the backfill's marker write sends it.
          const jsonbSet = values.settings?.__jsonbSet as [string, string] | undefined;
          if (jsonbSet) row.settings = { ...row.settings, [jsonbSet[0]]: JSON.parse(jsonbSet[1]) };
          else Object.assign(row, values);
        }
        return Promise.resolve(matching().length);
      },
      async first() { return matching()[0]; },
      then(resolve: (rows: Row[]) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(matching()).then(resolve, reject);
      },
    };
    return query;
  };
  return { table } as any;
}
