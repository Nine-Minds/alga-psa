"use server"

import { revalidatePath } from "next/cache";
import { withTransaction, createTenantKnex, tenantDb } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { isEnterprise } from '@alga-psa/core/features';
import { updateTenantSettings } from '@alga-psa/tenancy/actions/tenant-settings-actions/tenantSettingsActions';
import {
  classifyTenantTemplate,
  resolveEmailPalette,
  suggestEmailPalette,
  type EmailBrandingPalette,
} from '@alga-psa/email/branding';
import {
  normalizeEmailBrandingInput,
  readEmailBrandingPalette,
  resolveTenantLanguages,
  type EmailBrandingPaletteInput,
  type EmailBrandingStatus,
  type EmailBrandingTemplateStatus,
  type TenantSettingsBlob,
} from '../../lib/emailBranding';

function tenantScopedTable(conn: Knex | Knex.Transaction, table: string, tenant: string) {
  return tenantDb(conn, tenant).table(table) as Knex.QueryBuilder<any, any>;
}

const SETTINGS_PATH = "/msp/settings/notifications";

async function readTenantSettings(trx: Knex.Transaction, tenant: string): Promise<TenantSettingsBlob> {
  const row = await tenantScopedTable(trx, 'tenant_settings', tenant).select('settings').first();
  const settings = row?.settings;
  return (settings && typeof settings === 'object' ? settings : {}) as TenantSettingsBlob;
}

async function requireSettingsUpdate(user: any, trx: Knex.Transaction): Promise<void> {
  if (!(await hasPermission(user, 'settings', 'update', trx))) {
    throw new Error('Permission denied: Cannot update settings');
  }
}

/**
 * Saves the tenant's email palette. Writes no templates: applying is a separate,
 * explicit step so a color tweak can never rewrite a tenant's mail behind them.
 */
export const saveEmailBrandingAction = withAuth(async (
  user,
  { tenant },
  input: EmailBrandingPaletteInput,
): Promise<EmailBrandingPalette> => {
  const { knex } = await createTenantKnex();

  const existing = await withTransaction(knex, async (trx: Knex.Transaction) => {
    await requireSettingsUpdate(user, trx);
    const settings = await readTenantSettings(trx, tenant);
    return readEmailBrandingPalette(settings.emailBranding);
  });

  const palette: EmailBrandingPalette = {
    ...normalizeEmailBrandingInput(input, isEnterprise),
    // appliedAt/appliedPalette describe what was written to templates, not what
    // is saved, so editing the palette must carry them forward untouched.
    ...(existing?.appliedAt ? { appliedAt: existing.appliedAt } : {}),
    ...(existing?.appliedPalette ? { appliedPalette: existing.appliedPalette } : {}),
  };

  await updateTenantSettings({ emailBranding: palette });
  revalidatePath(SETTINGS_PATH);

  return palette;
});

interface TemplateRowShape {
  id: number;
  name: string;
  language_code: string;
  subject: string;
  html_content: string;
  text_content: string;
  created_at?: string | Date | null;
  category?: string;
}

async function loadTemplateRows(trx: Knex.Transaction, tenant: string): Promise<{
  systemTemplates: TemplateRowShape[];
  tenantTemplates: TemplateRowShape[];
}> {
  const db = tenantDb(trx, tenant);
  let systemQuery = tenantScopedTable(trx, "system_email_templates as t", tenant)
    .select("t.*", "c.name as category");
  systemQuery = db.tenantJoin(systemQuery, "notification_subtypes as s", "t.notification_subtype_id", "s.id");
  systemQuery = db.tenantJoin(systemQuery, "notification_categories as c", "s.category_id", "c.id");

  const systemTemplates = await systemQuery.orderBy(["c.name", "t.name"]);
  const tenantTemplates = await tenantScopedTable(trx, "tenant_email_templates", tenant).orderBy("name");

  return { systemTemplates, tenantTemplates };
}

const rowKey = (name: string, language: string) => `${name}::${language}`;

function isNewerThan(createdAt: unknown, appliedAt: string | undefined): boolean {
  if (!appliedAt || !createdAt) return false;
  const created = new Date(createdAt as string).getTime();
  const applied = new Date(appliedAt).getTime();
  return Number.isFinite(created) && Number.isFinite(applied) && created > applied;
}

/**
 * Everything the branding panel needs in one read: the saved palette, the
 * suggestion it would prefill without one, how each template currently stands,
 * and which system templates arrived unbranded since the last apply.
 */
export const getEmailBrandingStatusAction = withAuth(async (
  user,
  { tenant },
): Promise<EmailBrandingStatus> => {
  const { knex } = await createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    const canEdit = await hasPermission(user, 'settings', 'update', trx);
    const settings = await readTenantSettings(trx, tenant);
    const palette = readEmailBrandingPalette(settings.emailBranding);
    const suggestion = suggestEmailPalette({ theme: settings.theme, branding: settings.branding ?? null });

    const { systemTemplates, tenantTemplates } = await loadTemplateRows(trx, tenant);
    const tenantByKey = new Map(tenantTemplates.map((row) => [rowKey(row.name, row.language_code), row]));

    const availableLanguages = [...new Set(systemTemplates.map((row) => row.language_code))].sort();
    const languages = resolveTenantLanguages(settings, availableLanguages);

    const templates: EmailBrandingTemplateStatus[] = systemTemplates.map((systemRow) => {
      const tenantRow = tenantByKey.get(rowKey(systemRow.name, systemRow.language_code));
      const { state, differs } = classifyTenantTemplate({
        tenantRow,
        systemRow,
        appliedPalette: palette?.appliedPalette ?? null,
      });

      return {
        name: systemRow.name,
        language: systemRow.language_code,
        category: systemRow.category ?? '',
        systemTemplateId: systemRow.id,
        state,
        differs,
        isNew: state === 'system' && isNewerThan(systemRow.created_at, palette?.appliedAt),
      };
    });

    const newTemplateNames = [...new Set(
      templates
        .filter((template) => template.isNew && languages.includes(template.language))
        .map((template) => template.name),
    )].sort();

    return {
      palette,
      resolved: resolveEmailPalette(palette ?? { primary: suggestion.primary, secondary: suggestion.secondary }),
      suggestion,
      languages,
      availableLanguages,
      templates,
      newTemplateNames,
      canEdit,
      isEnterprise,
      logoOptions: {
        logoUrl: settings.branding?.logoUrl || undefined,
        logoWideUrl: isEnterprise ? settings.branding?.logoWideUrl || undefined : undefined,
        clientName: settings.branding?.clientName || undefined,
      },
    };
  });
});
