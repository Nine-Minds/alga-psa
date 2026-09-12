"use server"

import { revalidatePath } from "next/cache";
import { withTransaction, createTenantKnex, tenantDb } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { isEnterprise } from '@alga-psa/core/features';
import { updateTenantSettings } from '@alga-psa/tenancy/actions/tenant-settings-actions/tenantSettingsActions';
import {
  classifyTenantTemplate,
  decorateBrandedHtml,
  planEmailBrandingApply,
  planEmailBrandingRemoval,
  resolveEmailPalette,
  suggestEmailPalette,
  type EmailBrandingApplyScope,
  type EmailBrandingPalette,
  type EmailPaletteTokens,
} from '@alga-psa/email/branding';
import {
  describeTemplateWriteError,
  normalizeEmailBrandingInput,
  readEmailBrandingPalette,
  resolveTenantLanguages,
  type EmailBrandingApplyResult,
  type EmailBrandingPaletteInput,
  type EmailBrandingRemoveResult,
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

/** Citus distributes tenant_email_templates, so writes go in batches per language. */
const INSERT_BATCH_SIZE = 50;

function chunked<T>(rows: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}

async function persistAppliedPalette(
  tenant: string,
  palette: EmailBrandingPalette,
  applied: { appliedAt: string; appliedPalette: EmailPaletteTokens } | null,
): Promise<void> {
  await updateTenantSettings({
    emailBranding: applied ? { ...palette, ...applied } : { ...palette, appliedAt: undefined, appliedPalette: undefined },
  });
}

/**
 * The Enterprise pass over every HTML the apply writes: the tenant's logo in
 * the header and the "Powered by AlgaPSA" line. Community gets no decorator at
 * all, even if the saved palette still carries the fields from an Enterprise
 * period, mirroring scopeBrandingToEdition.
 */
function buildBrandDecorator(
  palette: EmailBrandingPalette,
  branding: Record<string, any> | null | undefined,
  enterprise: boolean,
): ((html: string) => string) | undefined {
  if (!enterprise) return undefined;

  const logoUrl = palette.logo?.variant === 'wide'
    ? branding?.logoWideUrl || branding?.logoUrl
    : branding?.logoUrl;
  const logo = palette.logo && logoUrl ? { url: logoUrl as string, alt: branding?.clientName ?? '' } : undefined;
  const hideAttribution = palette.hideAttribution === true;

  return (html: string) => decorateBrandedHtml(html, { logo, hideAttribution });
}

/**
 * Materializes the saved palette into tenant_email_templates for the selected
 * templates and languages.
 *
 * Each language is written in its own transaction: a failure there is reported
 * per row instead of losing the languages that already landed.
 */
export const applyEmailBrandingAction = withAuth(async (
  user,
  { tenant },
  scope: EmailBrandingApplyScope,
): Promise<EmailBrandingApplyResult> => {
  const { knex } = await createTenantKnex();

  const context = await withTransaction(knex, async (trx: Knex.Transaction) => {
    await requireSettingsUpdate(user, trx);
    const settings = await readTenantSettings(trx, tenant);
    const palette = readEmailBrandingPalette(settings.emailBranding);
    if (!palette) throw new Error('No email branding palette has been saved');

    const rows = await loadTemplateRows(trx, tenant);
    return { settings, palette, ...rows };
  });

  const target = resolveEmailPalette(context.palette);
  const plan = planEmailBrandingApply({
    systemRows: context.systemTemplates,
    tenantRows: context.tenantTemplates,
    target,
    appliedPalette: context.palette.appliedPalette ?? null,
    scope,
    decorate: buildBrandDecorator(context.palette, context.settings.branding, isEnterprise),
  });

  const written: EmailBrandingApplyResult['written'] = [];
  const failed: EmailBrandingApplyResult['failed'] = [];

  for (const language of scope.languages) {
    const inserts = plan.inserts.filter((insert) => insert.language === language);
    const updates = plan.updates.filter((update) => update.language === language);
    if (inserts.length === 0 && updates.length === 0) continue;

    try {
      await withTransaction(knex, async (trx: Knex.Transaction) => {
        const now = new Date();

        for (const batch of chunked(inserts, INSERT_BATCH_SIZE)) {
          await tenantScopedTable(trx, "tenant_email_templates", tenant).insert(batch.map((insert) => ({
            tenant,
            name: insert.name,
            language_code: insert.language,
            subject: insert.subject,
            html_content: insert.html,
            text_content: insert.text,
            system_template_id: insert.systemTemplateId,
            created_at: now,
            updated_at: now,
          })));
        }

        // Selected first, updated by id with plain parameters: Citus rejects
        // column references in the SET clause of a distributed table.
        for (const update of updates) {
          await tenantScopedTable(trx, "tenant_email_templates", tenant)
            .where({ id: update.id })
            .update({ html_content: update.html, updated_at: now });
        }
      });

      written.push(
        ...inserts.map((insert) => ({ name: insert.name, language, action: 'created' as const })),
        ...updates.map((update) => ({ name: update.name, language, action: 'updated' as const })),
      );
    } catch (error) {
      const message = describeTemplateWriteError(error);
      failed.push(
        ...inserts.map((insert) => ({ name: insert.name, language, error: message })),
        ...updates.map((update) => ({ name: update.name, language, error: message })),
      );
    }
  }

  const appliedAt = written.length > 0 ? new Date().toISOString() : context.palette.appliedAt ?? null;
  if (written.length > 0) {
    await persistAppliedPalette(tenant, context.palette, { appliedAt: appliedAt!, appliedPalette: target });
  }

  revalidatePath(SETTINGS_PATH);

  return { written, skipped: plan.skipped, failed, appliedAt };
});

/**
 * Removes the branding this tool applied: deletes only rows that still match
 * what it wrote, so hand-edited templates stay exactly where they are.
 */
export const removeEmailBrandingAction = withAuth(async (
  user,
  { tenant },
): Promise<EmailBrandingRemoveResult> => {
  const { knex } = await createTenantKnex();

  const context = await withTransaction(knex, async (trx: Knex.Transaction) => {
    await requireSettingsUpdate(user, trx);
    const settings = await readTenantSettings(trx, tenant);
    const rows = await loadTemplateRows(trx, tenant);
    return { settings, palette: readEmailBrandingPalette(settings.emailBranding), ...rows };
  });

  const { deletable, kept } = planEmailBrandingRemoval({
    systemRows: context.systemTemplates,
    tenantRows: context.tenantTemplates,
    appliedPalette: context.palette?.appliedPalette ?? null,
  });

  for (const batch of chunked(deletable, INSERT_BATCH_SIZE)) {
    await withTransaction(knex, async (trx: Knex.Transaction) => {
      await tenantScopedTable(trx, "tenant_email_templates", tenant)
        .whereIn('id', batch.map((row) => row.id))
        .del();
    });
  }

  if (context.palette) {
    await persistAppliedPalette(tenant, context.palette, null);
  }

  revalidatePath(SETTINGS_PATH);

  return { removed: deletable.length, kept: kept.length };
});
