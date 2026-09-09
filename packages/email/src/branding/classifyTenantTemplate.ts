import {
  applyEmailPalette,
  containsEmailPaletteTokens,
  extractColorLiterals,
  stripColorLiterals,
} from './applyEmailPalette';
import { removeBrandLogo, stripBrandAttribution } from './brandAssets';
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
 * The Enterprise brand assets are ours to add and remove, so a row is still
 * recognizably ours whether or not it currently carries our logo and the
 * attribution line. Normalizing both sides is what lets a tenant turn the
 * attribution back on and have the footer restored.
 */
const withoutBrandAssets = (html: string): string => stripBrandAttribution(removeBrandLogo(html));

/**
 * Decides whether a tenant row is untouched, something the branding tool wrote,
 * a hand edit, or a redesign with none of our color tokens left.
 *
 * `branded` is deliberately narrow: the row has to equal the system template
 * with the last applied palette substituted, subject included. Anything else a
 * tenant typed makes the row theirs, and the apply flow will not touch it
 * unless they tick it.
 */
export function classifyTenantTemplate(input: ClassifyTenantTemplateInput): TenantTemplateClassification {
  const { tenantRow, systemRow, appliedPalette } = input;

  if (!tenantRow) return { state: 'system', differs: [] };

  // With no palette applied yet the expected HTML is the system template
  // itself, so an untouched clone counts as branded: rewriting its colors can
  // lose nothing the tenant typed.
  const expectedHtml = appliedPalette
    ? applyEmailPalette(systemRow.html_content, STOCK_EMAIL_PALETTE, appliedPalette)
    : systemRow.html_content;

  const subjectMatches = tenantRow.subject === systemRow.subject;
  const htmlMatches = tenantRow.html_content === expectedHtml
    || withoutBrandAssets(tenantRow.html_content) === withoutBrandAssets(expectedHtml);

  if (htmlMatches && subjectMatches) return { state: 'branded', differs: [] };

  const carriesStock = containsEmailPaletteTokens(tenantRow.html_content, STOCK_EMAIL_PALETTE);
  const carriesApplied = appliedPalette
    ? containsEmailPaletteTokens(tenantRow.html_content, appliedPalette)
    : false;

  const differs = differencesFrom(tenantRow, systemRow, expectedHtml);

  if (!carriesStock && !carriesApplied) return { state: 'no-stock-colors', differs };

  return { state: 'customized', differs };
}

function differencesFrom(
  tenantRow: ClassifiableTemplate,
  systemRow: ClassifiableTemplate,
  expectedHtml: string,
): TenantTemplateDifference[] {
  const differs: TenantTemplateDifference[] = [];
  const tenantHtml = withoutBrandAssets(tenantRow.html_content);
  const expected = withoutBrandAssets(expectedHtml);

  if (extractColorLiterals(tenantHtml).join('|') !== extractColorLiterals(expected).join('|')) {
    differs.push('colors');
  }
  if (stripColorLiterals(tenantHtml) !== stripColorLiterals(expected)) differs.push('text');
  if (tenantRow.subject !== systemRow.subject) differs.push('subject');

  return differs;
}
