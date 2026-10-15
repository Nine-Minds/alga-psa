import { applyEmailPalette } from './applyEmailPalette';
import { classifyTenantTemplate } from './classifyTenantTemplate';
import { STOCK_EMAIL_PALETTE } from './stockPalette';
import type { EmailPaletteTokens, TenantTemplateState } from './types';

export interface BrandableSystemRow {
  id: number;
  name: string;
  language_code: string;
  subject: string;
  html_content: string;
  text_content: string;
}

export interface BrandableTenantRow {
  id: number;
  name: string;
  language_code: string;
  subject: string;
  html_content: string;
  text_content: string;
}

export interface EmailBrandingApplyScope {
  /** Template names the user selected. */
  names: string[];
  languages: string[];
  /** Names in the "customized" group the user explicitly ticked. */
  includeCustomized?: string[];
  /**
   * Names the user asked to rebuild from the standard template, edits and all.
   * The escape hatch for a row whose own colors the palette cannot reach.
   */
  overwrite?: string[];
}

export type EmailBrandingSkipReason = 'customized' | 'nothing-to-replace' | 'unchanged';

export interface PlannedTemplateInsert {
  name: string;
  language: string;
  systemTemplateId: number;
  subject: string;
  html: string;
  text: string;
}

export interface PlannedTemplateUpdate {
  id: number;
  name: string;
  language: string;
  html: string;
  /** Only set by an overwrite, which restores the standard subject and body. */
  subject?: string;
  text?: string;
}

export interface PlannedTemplateSkip {
  name: string;
  language: string;
  state: TenantTemplateState;
  reason: EmailBrandingSkipReason;
}

export interface EmailBrandingApplyPlan {
  inserts: PlannedTemplateInsert[];
  updates: PlannedTemplateUpdate[];
  skipped: PlannedTemplateSkip[];
}

export interface EmailBrandingApplyPlanInput {
  systemRows: BrandableSystemRow[];
  tenantRows: BrandableTenantRow[];
  /** The token map to write. */
  target: EmailPaletteTokens;
  /** The token map the last apply wrote, if any. */
  appliedPalette?: EmailPaletteTokens | null;
  scope: EmailBrandingApplyScope;
  /** Enterprise logo/attribution pass, run after the color rewrite. */
  decorate?: (html: string) => string;
}

const rowKey = (name: string, language: string) => `${name}::${language}`;

/**
 * Decides, without touching a database, exactly which tenant rows an apply
 * would create, update and leave alone.
 *
 * The rules that matter:
 * - `system` rows are cloned from the system template with the palette applied.
 * - `branded` rows are re-cloned from the system template, so a re-apply also
 *   picks up an attribution or logo change instead of only swapping colors.
 * - `customized` rows are only touched when their name was ticked, and then
 *   only their remaining stock or previously applied tokens change, so the
 *   tenant's own edits survive.
 * - `no-stock-colors` rows are never written; there is nothing to replace.
 * - a name in `scope.overwrite` overrules the two rules above: the row is
 *   rebuilt from the standard template, subject and plain text included, which
 *   is the only way to repaint colors a tenant chose themselves.
 */
export function planEmailBrandingApply(input: EmailBrandingApplyPlanInput): EmailBrandingApplyPlan {
  const { systemRows, tenantRows, target, appliedPalette, scope, decorate } = input;

  const names = new Set(scope.names);
  const languages = new Set(scope.languages);
  const ticked = new Set(scope.includeCustomized ?? []);
  const overwritten = new Set(scope.overwrite ?? []);
  const tenantByKey = new Map(tenantRows.map((row) => [rowKey(row.name, row.language_code), row]));

  const plan: EmailBrandingApplyPlan = { inserts: [], updates: [], skipped: [] };
  const decorateHtml = (html: string) => (decorate ? decorate(html) : html);

  for (const systemRow of systemRows) {
    if (!names.has(systemRow.name) || !languages.has(systemRow.language_code)) continue;

    const tenantRow = tenantByKey.get(rowKey(systemRow.name, systemRow.language_code));
    const { state } = classifyTenantTemplate({ tenantRow, systemRow, appliedPalette: appliedPalette ?? null });
    const language = systemRow.language_code;
    const forced = overwritten.has(systemRow.name);

    if (state === 'no-stock-colors' && !forced) {
      plan.skipped.push({ name: systemRow.name, language, state, reason: 'nothing-to-replace' });
      continue;
    }

    if (state === 'customized' && !forced && !ticked.has(systemRow.name)) {
      plan.skipped.push({ name: systemRow.name, language, state, reason: 'customized' });
      continue;
    }

    if (state === 'system') {
      plan.inserts.push({
        name: systemRow.name,
        language,
        systemTemplateId: systemRow.id,
        subject: systemRow.subject,
        html: decorateHtml(applyEmailPalette(systemRow.html_content, STOCK_EMAIL_PALETTE, target)),
        // Plain-text bodies carry no colors, so they are cloned verbatim.
        text: systemRow.text_content,
      });
      continue;
    }

    const sourceMaps = appliedPalette ? [appliedPalette, STOCK_EMAIL_PALETTE] : [STOCK_EMAIL_PALETTE];
    // An overwrite is a re-clone, exactly like a branded row: the tenant asked
    // for the standard template in their colors, not for their row recolored.
    const rebuild = state === 'branded' || forced;
    const html = rebuild
      ? decorateHtml(applyEmailPalette(systemRow.html_content, STOCK_EMAIL_PALETTE, target))
      : decorateHtml(applyEmailPalette(tenantRow!.html_content, sourceMaps, target));
    const restored = forced
      ? { subject: systemRow.subject, text: systemRow.text_content }
      : null;

    if (
      html === tenantRow!.html_content
      && (!restored || (restored.subject === tenantRow!.subject && restored.text === tenantRow!.text_content))
    ) {
      plan.skipped.push({ name: systemRow.name, language, state, reason: 'unchanged' });
      continue;
    }

    plan.updates.push({ id: tenantRow!.id, name: systemRow.name, language, html, ...(restored ?? {}) });
  }

  return plan;
}

/**
 * The rows "Remove branding" may delete: only the ones this tool wrote, never a
 * template the tenant edited.
 */
export function planEmailBrandingRemoval(input: {
  systemRows: BrandableSystemRow[];
  tenantRows: BrandableTenantRow[];
  appliedPalette?: EmailPaletteTokens | null;
}): { deletable: BrandableTenantRow[]; kept: BrandableTenantRow[] } {
  const systemByKey = new Map(input.systemRows.map((row) => [rowKey(row.name, row.language_code), row]));
  const deletable: BrandableTenantRow[] = [];
  const kept: BrandableTenantRow[] = [];

  for (const tenantRow of input.tenantRows) {
    const systemRow = systemByKey.get(rowKey(tenantRow.name, tenantRow.language_code));
    if (!systemRow) {
      kept.push(tenantRow);
      continue;
    }

    const { state } = classifyTenantTemplate({
      tenantRow,
      systemRow,
      appliedPalette: input.appliedPalette ?? null,
    });

    if (state === 'branded') deletable.push(tenantRow);
    else kept.push(tenantRow);
  }

  return { deletable, kept };
}
