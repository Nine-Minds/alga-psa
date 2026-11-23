import {
  applyEmailPalette,
  containsEmailPaletteTokens,
  extractColorLiterals,
  stripColorLiterals,
} from './applyEmailPalette';
import { removeBrandLogo, stripBrandAttribution } from './brandAssets';
import { normalizeChangesBox } from './changesBox';
import { stripGradientFallback } from './gradientFallback';
import { stripOrphanedBrandFooter } from './orphanedSlogan';
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
  /**
   * The stock row of the template this one's tenant rows were copied from, same language.
   * When a client template is split off a shared one, each tenant's shared row is copied to the
   * client name. A copy of a row the branding tool wrote is still nothing the tenant typed.
   */
  copiedFromSystemRow?: ClassifiableTemplate | null;
}

/** Client template name -> the template its tenant rows were copied from at a split. */
export type CopiedFromTemplates = Readonly<Record<string, string>>;

/** The stock row a `(name, language)` tenant row may be a copy of, if its template was split off another. */
export function copiedFromSystemRowFor<T extends { name: string; language_code: string }>(
  systemRows: readonly T[],
  copiedFrom: CopiedFromTemplates | null | undefined,
  name: string,
  language: string,
): T | null {
  const sourceName = copiedFrom?.[name];
  if (!sourceName) return null;
  return systemRows.find((row) => row.name === sourceName && row.language_code === language) ?? null;
}

/** Does the row equal this stock template with the applied palette substituted, subject included? */
function equalsBrandedStock(
  tenantRow: ClassifiableTemplate,
  stockRow: ClassifiableTemplate,
  appliedPalette: EmailPaletteTokens | null | undefined,
): boolean {
  // With no palette applied yet the expected HTML is the stock template itself.
  const expectedHtml = appliedPalette
    ? applyEmailPalette(stockRow.html_content, STOCK_EMAIL_PALETTE, appliedPalette)
    : stockRow.html_content;
  return tenantRow.subject === stockRow.subject
    && (tenantRow.html_content === expectedHtml
      || withoutBrandAssets(tenantRow.html_content) === withoutBrandAssets(expectedHtml));
}

/**
 * The Enterprise brand assets are ours to add and remove, so a row is still
 * recognizably ours whether or not it currently carries our logo and the
 * attribution line. Normalizing both sides is what lets a tenant turn the
 * attribution back on and have the footer restored. The flat gradient fallback
 * is ours too: rows written before the layout carried it must still read as
 * branded against the corrected system templates. So is the stock "Changes Made"
 * box, which moved from pre-rendered HTML to a template loop (see changesBox.ts),
 * and the orphaned slogan (or empty coloured band) an older attribution strip
 * left in the footer of rows it wrote (see orphanedSlogan.ts), which must still
 * read as ours so the next apply rewrites that footer rather than freezing it as
 * a hand edit.
 */
const withoutBrandAssets = (html: string): string =>
  normalizeChangesBox(stripGradientFallback(stripOrphanedBrandFooter(stripBrandAttribution(removeBrandLogo(html)))));

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

  // An untouched copy of the template this one was split from: still the tool's own row.
  if (input.copiedFromSystemRow && equalsBrandedStock(tenantRow, input.copiedFromSystemRow, appliedPalette)) {
    return { state: 'branded', differs: [], copyOfSplitSource: true };
  }

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
