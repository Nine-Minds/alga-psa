import {
  applyEmailPalette,
  containsEmailPaletteTokens,
  extractColorLiterals,
  stripColorLiterals,
} from './applyEmailPalette';
import { STOCK_EMAIL_PALETTE } from './stockPalette';
import type {
  EmailPaletteTokens,
  TenantTemplateClassification,
  TenantTemplateDifference,
} from './types';

export interface ClassifiableTemplate {
  subject: string;
  html_content: string;
}

export interface ClassifyTenantTemplateInput {
  /** Undefined/null means the tenant has no row for this (name, language). */
  tenantRow?: ClassifiableTemplate | null;
  systemRow: ClassifiableTemplate;
  /** The token map the apply flow last wrote, if any. */
  appliedPalette?: EmailPaletteTokens | null;
}

/**
 * Decides whether a tenant row is untouched, something the branding tool wrote,
 * a hand edit, or a redesign with none of our color tokens left.
 *
 * `branded` is deliberately exact: the row has to equal the system template
 * with the last applied palette substituted, subject included. Anything else a
 * tenant typed makes the row theirs, and the apply flow will not touch it
 * unless they tick it.
 */
export function classifyTenantTemplate(input: ClassifyTenantTemplateInput): TenantTemplateClassification {
  const { tenantRow, systemRow, appliedPalette } = input;

  if (!tenantRow) return { state: 'system', differs: [] };

  const expectedHtml = appliedPalette
    ? applyEmailPalette(systemRow.html_content, STOCK_EMAIL_PALETTE, appliedPalette)
    : systemRow.html_content;

  // With no palette applied yet the expected HTML is the system template
  // itself, so an untouched clone counts as branded: rewriting its colors can
  // lose nothing the tenant typed.
  if (tenantRow.html_content === expectedHtml && tenantRow.subject === systemRow.subject) {
    return { state: 'branded', differs: [] };
  }

  const carriesStock = containsEmailPaletteTokens(tenantRow.html_content, STOCK_EMAIL_PALETTE);
  const carriesApplied = appliedPalette
    ? containsEmailPaletteTokens(tenantRow.html_content, appliedPalette)
    : false;

  if (!carriesStock && !carriesApplied) {
    return { state: 'no-stock-colors', differs: differencesFrom(tenantRow, systemRow, expectedHtml) };
  }

  return { state: 'customized', differs: differencesFrom(tenantRow, systemRow, expectedHtml) };
}

function differencesFrom(
  tenantRow: ClassifiableTemplate,
  systemRow: ClassifiableTemplate,
  expectedHtml: string,
): TenantTemplateDifference[] {
  const differs: TenantTemplateDifference[] = [];

  const colorsChanged =
    extractColorLiterals(tenantRow.html_content).join('|') !== extractColorLiterals(expectedHtml).join('|');
  if (colorsChanged) differs.push('colors');

  if (stripColorLiterals(tenantRow.html_content) !== stripColorLiterals(expectedHtml)) differs.push('text');
  if (tenantRow.subject !== systemRow.subject) differs.push('subject');

  return differs;
}
