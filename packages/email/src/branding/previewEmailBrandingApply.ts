import { classifyTenantTemplate } from './classifyTenantTemplate';
import { planEmailBrandingApply } from './planEmailBrandingApply';
import type {
  BrandableSystemRow,
  BrandableTenantRow,
  EmailBrandingSkipReason,
} from './planEmailBrandingApply';
import type { EmailPaletteTokens, TenantTemplateState } from './types';

export type EmailBrandingPreviewAction = 'create' | 'update' | 'skip';

export interface EmailBrandingPreview {
  name: string;
  language: string;
  action: EmailBrandingPreviewAction;
  state: TenantTemplateState;
  /** Only set when `action` is 'skip'. */
  skipReason?: EmailBrandingSkipReason;
  /** The subject the row would carry afterwards; an apply never rewrites one. */
  subject: string;
  /** What the tenant sends today: their own row, or the system template. */
  currentHtml: string;
  /** What an apply would store; equal to `currentHtml` when it would skip. */
  plannedHtml: string;
}

export interface EmailBrandingPreviewInput {
  systemRows: BrandableSystemRow[];
  tenantRows: BrandableTenantRow[];
  target: EmailPaletteTokens;
  appliedPalette?: EmailPaletteTokens | null;
  name: string;
  language: string;
  decorate?: (html: string) => string;
}

/**
 * What an apply would do to exactly one (name, language), answered by running
 * the apply planner itself — so the HTML the preview shows is byte for byte the
 * HTML the apply would write, customized rows included.
 *
 * The name is always passed as ticked: the point of the preview is to show what
 * ticking a customized template would produce, not to restate that an unticked
 * one is left alone.
 *
 * Returns null when there is no system template under that name and language,
 * the one input the planner can say nothing about.
 */
export function previewEmailBrandingApply(input: EmailBrandingPreviewInput): EmailBrandingPreview | null {
  const { systemRows, tenantRows, target, appliedPalette, name, language, decorate } = input;

  const systemRow = systemRows.find((row) => row.name === name && row.language_code === language);
  if (!systemRow) return null;

  const tenantRow = tenantRows.find((row) => row.name === name && row.language_code === language);
  const currentHtml = tenantRow?.html_content ?? systemRow.html_content;
  const { state } = classifyTenantTemplate({ tenantRow, systemRow, appliedPalette: appliedPalette ?? null });

  const plan = planEmailBrandingApply({
    systemRows,
    tenantRows,
    target,
    appliedPalette,
    scope: { names: [name], languages: [language], includeCustomized: [name] },
    decorate,
  });

  const insert = plan.inserts[0];
  if (insert) {
    return {
      name,
      language,
      action: 'create',
      state,
      subject: insert.subject,
      currentHtml,
      plannedHtml: insert.html,
    };
  }

  const update = plan.updates[0];
  if (update) {
    return {
      name,
      language,
      action: 'update',
      state,
      subject: tenantRow?.subject ?? systemRow.subject,
      currentHtml,
      plannedHtml: update.html,
    };
  }

  const skip = plan.skipped[0];
  return {
    name,
    language,
    action: 'skip',
    state: skip?.state ?? state,
    skipReason: skip?.reason,
    subject: tenantRow?.subject ?? systemRow.subject,
    currentHtml,
    plannedHtml: currentHtml,
  };
}
