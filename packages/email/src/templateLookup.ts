import type { Knex } from 'knex';
import type { TenantDb } from '@alga-psa/db';
import { derivedContentFor, isUntouchedDerivation, type DerivedProvenance } from './derivedTemplates';

export interface EmailTemplateRow extends Partial<DerivedProvenance> {
  id: number | string;
  name: string;
  language_code: string | null;
  subject: string | null;
  html_content: string;
  text_content?: string | null;
}

/**
 * Where a template came from: the tenant's own row, the stock system row, or a
 * tenant row the branding tool wrote that is still an untouched derivation and
 * so reads as the current system template in the tenant's brand.
 */
export type EmailTemplateSource = 'tenant' | 'system' | 'tenant-derived';

/**
 * One template name in one table: the recipient's language, then English, then a legacy row with
 * no language. Without a locale only the legacy no-language row is considered.
 */
async function findTemplateRow(
  templates: () => Knex.QueryBuilder<any, any>,
  name: string,
  locale: string | undefined,
): Promise<EmailTemplateRow | undefined> {
  if (locale) {
    const localized = await templates().where({ name, language_code: locale }).first();
    if (localized) return localized;
  }
  if (locale && locale !== 'en') {
    const english = await templates().where({ name, language_code: 'en' }).first();
    if (english) return english;
  }
  return templates().where({ name }).whereNull('language_code').first();
}

/**
 * The tenant row as it reads today when it is an untouched derivation of a system
 * template: the system template's current subject, html and text, recolored with
 * the palette stored on the row and decorated with the decoration stored on the row
 * (never the tenant's current settings). Null — meaning "serve the row
 * itself" — when the row carries no provenance, was edited after stamping, or the
 * system row (in the row's own language) is gone.
 */
async function deriveFromSystem(db: TenantDb, own: EmailTemplateRow): Promise<EmailTemplateRow | null> {
  if (!isUntouchedDerivation(own) || !own.language_code) return null;

  const system = await db.table('system_email_templates')
    .where({ name: own.name, language_code: own.language_code })
    .first() as EmailTemplateRow | undefined;
  if (!system || system.subject == null) return null;

  const derived = derivedContentFor(
    own,
    { subject: system.subject, html_content: system.html_content, text_content: system.text_content ?? '' },
  );
  return { ...own, ...derived };
}

/**
 * The template one email is rendered with: the tenant's own template under exactly this name,
 * else the stock one. Nothing is borrowed from another template name. A client template and the
 * internal template it was split from are separate emails; what a tenant had set up before a
 * split was copied to the client name by that split's migration.
 *
 * A tenant row the branding tool wrote and nobody edited is not frozen text: it is served as the
 * current system template in the tenant's brand, so system changes reach it unaided.
 */
export async function lookupEmailTemplate(
  db: TenantDb,
  name: string,
  locale: string | undefined,
): Promise<{ source: EmailTemplateSource; template: EmailTemplateRow } | null> {
  // Both tables are read through the tenant facade the caller built with tenantDb().
  const own = await findTemplateRow(() => db.table('tenant_email_templates'), name, locale);
  if (own) {
    const derived = await deriveFromSystem(db, own);
    return derived ? { source: 'tenant-derived', template: derived } : { source: 'tenant', template: own };
  }

  const stock = await findTemplateRow(() => db.table('system_email_templates'), name, locale);
  return stock ? { source: 'system', template: stock } : null;
}
