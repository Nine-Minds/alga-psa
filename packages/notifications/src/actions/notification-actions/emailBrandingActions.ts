"use server"

import { revalidatePath } from "next/cache";
import { withTransaction, createTenantKnex, tenantDb } from '@alga-psa/db';
import { Knex } from 'knex';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { isEnterprise } from '@alga-psa/core/features';
import { mergeTenantSettingsJson } from '@alga-psa/tenancy/server/tenantSettingsStore';
import { isLicensedUserType } from '@alga-psa/types';
import {
  brandDecorator,
  classifyTenantTemplate,
  deriveTemplate,
  copiedFromSystemRowFor,
  planEmailBrandingApply,
  planEmailBrandingRemoval,
  previewEmailBrandingApply,
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
  type EmailBrandingPreviewRequest,
  type EmailBrandingPreviewResult,
  type EmailBrandingRemoveResult,
  type EmailBrandingStatus,
  type EmailBrandingTemplateStatus,
  type TenantSettingsBlob,
} from '../../lib/emailBranding';
import { NO_DERIVED_PROVENANCE, isUntouchedDerivation, stampDerivedTemplate, type DerivedProvenance } from '@alga-psa/email/derivedTemplates';
import { TICKET_EMAIL_TEMPLATES_COPIED_FROM } from '../../lib/templateVariables/ticketEmailAudience';

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
  if (!isLicensedUserType(user.user_type) || !(await hasPermission(user, 'settings', 'update', trx))) {
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

  await mergeTenantSettingsJson(tenant, { emailBranding: palette });
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
  derived_from_system_id?: number | null;
  derived_palette?: EmailPaletteTokens | null;
  derived_snapshot_hash?: string | null;
}

/**
 * The tenant rows as they currently read. A derived row's stored body is whatever the system
 * template was when it was written; what the tenant has is the current system template, so that
 * is what gets classified and applied over. Without this a derived row would read as
 * "customized" the day after any system change and the apply would skip it. The palette is the
 * last applied one, the one classification compares against; brand assets are not needed here,
 * classification normalizes them away.
 */
function withDerivedRowsResolved<T extends { tenantTemplates: TemplateRowShape[]; systemTemplates: TemplateRowShape[] }>(
  rows: T,
  appliedPalette: EmailPaletteTokens | null | undefined,
): T {
  const systemByKey = new Map(rows.systemTemplates.map((row) => [rowKey(row.name, row.language_code), row]));
  return {
    ...rows,
    tenantTemplates: rows.tenantTemplates.map((row) => {
      const systemRow = systemByKey.get(rowKey(row.name, row.language_code));
      if (!systemRow || !isUntouchedDerivation(row)) return row;
      return { ...row, ...deriveTemplate(systemRow, appliedPalette ?? row.derived_palette!) };
    }),
  };
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

/** The same two reads as loadTemplateRows, narrowed to a single template. */
async function loadTemplateRowsForName(
  trx: Knex.Transaction,
  tenant: string,
  name: string,
): Promise<{ systemTemplates: TemplateRowShape[]; tenantTemplates: TemplateRowShape[] }> {
  const systemTemplates = await tenantScopedTable(trx, "system_email_templates", tenant).where({ name });
  const tenantTemplates = await tenantScopedTable(trx, "tenant_email_templates", tenant).where({ name });

  // The stock rows of the template it was split from: a copied row is classified against them.
  const copiedFromName = TICKET_EMAIL_TEMPLATES_COPIED_FROM[name];
  const copiedFromTemplates = copiedFromName
    ? await tenantScopedTable(trx, "system_email_templates", tenant).where({ name: copiedFromName })
    : [];

  return { systemTemplates: [...systemTemplates, ...copiedFromTemplates], tenantTemplates };
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

    const { systemTemplates, tenantTemplates } = withDerivedRowsResolved(
      await loadTemplateRows(trx, tenant), palette?.appliedPalette,
    );
    const tenantByKey = new Map(tenantTemplates.map((row) => [rowKey(row.name, row.language_code), row]));

    const availableLanguages = [...new Set(systemTemplates.map((row) => row.language_code))].sort();
    const languages = resolveTenantLanguages(settings, availableLanguages);

    const templates: EmailBrandingTemplateStatus[] = systemTemplates.map((systemRow) => {
      const tenantRow = tenantByKey.get(rowKey(systemRow.name, systemRow.language_code));
      const { state, differs } = classifyTenantTemplate({
        tenantRow,
        systemRow,
        appliedPalette: palette?.appliedPalette ?? null,
        copiedFromSystemRow: copiedFromSystemRowFor(
          systemTemplates, TICKET_EMAIL_TEMPLATES_COPIED_FROM, systemRow.name, systemRow.language_code,
        ),
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
        logoDarkUrl: isEnterprise ? settings.branding?.logoDarkUrl || undefined : undefined,
        logoWideUrl: isEnterprise ? settings.branding?.logoWideUrl || undefined : undefined,
        logoWideDarkUrl: isEnterprise ? settings.branding?.logoWideDarkUrl || undefined : undefined,
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
  await mergeTenantSettingsJson(tenant, {
    emailBranding: applied ? { ...palette, ...applied } : { ...palette, appliedAt: undefined, appliedPalette: undefined },
  });
}

/**
 * What "Apply to templates" would do to one template, without writing anything.
 *
 * Reads only, so it is not gated on settings:update: the dialog that shows it
 * is already behind that permission, and seeing one's own template is harmless.
 * The name is previewed as if it were ticked, which is the whole point for a
 * customized template — it answers "what happens to my edits?" before the
 * tenant commits to the apply.
 */
export const previewEmailBrandingApplyAction = withAuth(async (
  user,
  { tenant },
  { name, language, overwrite }: EmailBrandingPreviewRequest,
): Promise<EmailBrandingPreviewResult> => {
  const { knex } = await createTenantKnex();

  const context = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const settings = await readTenantSettings(trx, tenant);
    const palette = readEmailBrandingPalette(settings.emailBranding);
    if (!palette) throw new Error('No email branding palette has been saved');

    const rows = withDerivedRowsResolved(await loadTemplateRowsForName(trx, tenant, name), palette.appliedPalette);
    return { settings, palette, ...rows };
  });

  const target = resolveEmailPalette(context.palette);
  const preview = previewEmailBrandingApply({
    systemRows: context.systemTemplates,
    tenantRows: context.tenantTemplates,
    target,
    appliedPalette: context.palette.appliedPalette ?? null,
    name,
    language,
    overwrite,
    decorate: brandDecorator(context.palette, context.settings.branding, isEnterprise, target),
    copiedFrom: TICKET_EMAIL_TEMPLATES_COPIED_FROM,
  });

  if (!preview) throw new Error(`No ${language} email template named ${name}`);

  return preview;
});

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

    const rows = withDerivedRowsResolved(await loadTemplateRows(trx, tenant), palette.appliedPalette);
    return { settings, palette, ...rows };
  });

  const target = resolveEmailPalette(context.palette);
  const decorate = brandDecorator(context.palette, context.settings.branding, isEnterprise, target);
  const plan = planEmailBrandingApply({
    systemRows: context.systemTemplates,
    tenantRows: context.tenantTemplates,
    target,
    appliedPalette: context.palette.appliedPalette ?? null,
    scope,
    decorate,
    copiedFrom: TICKET_EMAIL_TEMPLATES_COPIED_FROM,
  });

  const systemByKey = new Map(context.systemTemplates.map((row) => [rowKey(row.name, row.language_code), row]));
  const tenantById = new Map(context.tenantTemplates.map((row) => [row.id, row]));

  /** Provenance for what is about to be stored: stamped only if it is exactly the derivation. */
  const provenanceFor = (
    systemRow: TemplateRowShape | undefined,
    content: { subject: string; html_content: string; text_content: string },
  ): DerivedProvenance => (
    systemRow ? stampDerivedTemplate(content, systemRow, target, decorate) : NO_DERIVED_PROVENANCE
  );

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
          await tenantScopedTable(trx, "tenant_email_templates", tenant).insert(batch.map((insert) => {
            const content = { subject: insert.subject, html_content: insert.html, text_content: insert.text };
            const { derived_from_system_id, derived_palette, derived_snapshot_hash } = provenanceFor(
              systemByKey.get(rowKey(insert.name, insert.language)),
              content,
            );
            return {
              tenant,
              name: insert.name,
              language_code: insert.language,
              ...content,
              system_template_id: insert.systemTemplateId,
              derived_from_system_id,
              derived_palette,
              derived_snapshot_hash,
              created_at: now,
              updated_at: now,
            };
          }));
        }

        // Selected first, updated by id with plain parameters: Citus rejects
        // column references in the SET clause of a distributed table.
        for (const update of updates) {
          const existing = tenantById.get(update.id);
          const provenance = provenanceFor(systemByKey.get(rowKey(update.name, update.language)), {
            subject: update.subject ?? existing?.subject ?? '',
            html_content: update.html,
            text_content: update.text ?? existing?.text_content ?? '',
          });
          const derived = provenance.derived_from_system_id !== null;
          await tenantScopedTable(trx, "tenant_email_templates", tenant)
            .where({ id: update.id })
            .update({
              html_content: update.html,
              // Only an overwrite restores these; a palette pass never touches them. A derived
              // row is stored whole, so what the hash covers is exactly what is in the table.
              ...(update.subject !== undefined || derived ? { subject: update.subject ?? existing?.subject } : {}),
              ...(update.text !== undefined || derived ? { text_content: update.text ?? existing?.text_content } : {}),
              derived_from_system_id: provenance.derived_from_system_id,
              derived_palette: provenance.derived_palette,
              derived_snapshot_hash: provenance.derived_snapshot_hash,
              updated_at: now,
            });
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
    const palette = readEmailBrandingPalette(settings.emailBranding);
    const rows = withDerivedRowsResolved(await loadTemplateRows(trx, tenant), palette?.appliedPalette);
    return { settings, palette, ...rows };
  });

  const { deletable, kept } = planEmailBrandingRemoval({
    systemRows: context.systemTemplates,
    tenantRows: context.tenantTemplates,
    appliedPalette: context.palette?.appliedPalette ?? null,
    copiedFrom: TICKET_EMAIL_TEMPLATES_COPIED_FROM,
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
