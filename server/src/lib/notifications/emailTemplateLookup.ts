import type { Knex } from 'knex';
import type { TenantDb } from '@alga-psa/db';

export interface EmailTemplateRow {
  id: number | string;
  name: string;
  language_code: string | null;
  subject: string | null;
  html_content: string;
}

/** Where a template came from: the tenant's own row, or the stock system row. */
export type EmailTemplateSource = 'tenant' | 'system';

/** One template name in one table: the recipient's language, then English, then a legacy row with no language. */
async function findTemplateRow(
  templates: () => Knex.QueryBuilder<any, any>,
  name: string,
  locale: string,
): Promise<EmailTemplateRow | undefined> {
  const localized = await templates().where({ name, language_code: locale }).first();
  if (localized) return localized;
  if (locale !== 'en') {
    const english = await templates().where({ name, language_code: 'en' }).first();
    if (english) return english;
  }
  return templates().where({ name }).whereNull('language_code').first();
}

/**
 * The template one email is rendered with: the tenant's own template under exactly this name,
 * else the stock one. Nothing is borrowed from another template name. A client template and the
 * internal template it was split from are separate emails; what a tenant had set up before a
 * split was copied to the client name by that split's migration.
 */
export async function lookupEmailTemplate(
  db: TenantDb,
  name: string,
  locale: string,
): Promise<{ source: EmailTemplateSource; template: EmailTemplateRow } | null> {
  // Both tables are read through the tenant facade the caller built with tenantDb().
  const own = await findTemplateRow(() => db.table('tenant_email_templates'), name, locale);
  if (own) return { source: 'tenant', template: own };

  const stock = await findTemplateRow(() => db.table('system_email_templates'), name, locale);
  return stock ? { source: 'system', template: stock } : null;
}
