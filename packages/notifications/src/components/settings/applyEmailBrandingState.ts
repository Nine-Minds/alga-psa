/**
 * Selection state for the apply-branding dialog, kept apart from the component
 * so the grouping and counting rules can be tested without a DOM.
 */

import type { EmailBrandingApplyScope, TenantTemplateDifference, TenantTemplateState } from '@alga-psa/email/branding';
import type {
  EmailBrandingApplyResult,
  EmailBrandingPreviewResult,
  EmailBrandingTemplateStatus,
} from '../../lib/emailBranding';

export const TEMPLATE_GROUP_ORDER: TenantTemplateState[] = ['system', 'branded', 'customized', 'no-stock-colors'];

export interface TemplateGroupEntry {
  name: string;
  category: string;
  state: TenantTemplateState;
  differs: TenantTemplateDifference[];
  /** How many (name, language) rows this entry stands for in the current selection. */
  rows: number;
  /** Every row, including the ones only an overwrite can reach. */
  allRows: number;
  isNew: boolean;
}

/** The groups whose rows an apply can only change by discarding tenant edits. */
export const OVERWRITABLE_STATES: TenantTemplateState[] = ['customized', 'no-stock-colors'];

/**
 * One entry per template name, filed under the most conservative state any of
 * its rows is in: a name that is customized in one language is never quietly
 * rebranded because it is untouched in another.
 */
export function groupTemplatesByState(
  templates: EmailBrandingTemplateStatus[],
  languages: string[],
): Record<TenantTemplateState, TemplateGroupEntry[]> {
  const selected = new Set(languages);
  const byName = new Map<string, EmailBrandingTemplateStatus[]>();

  for (const template of templates) {
    if (!selected.has(template.language)) continue;
    const rows = byName.get(template.name) ?? [];
    rows.push(template);
    byName.set(template.name, rows);
  }

  const groups: Record<TenantTemplateState, TemplateGroupEntry[]> = {
    system: [], branded: [], customized: [], 'no-stock-colors': [],
  };

  for (const [name, rows] of [...byName.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const states = new Set(rows.map((row) => row.state));
    const state: TenantTemplateState =
      states.has('customized') ? 'customized'
        : states.size === 1 && states.has('no-stock-colors') ? 'no-stock-colors'
          : states.has('branded') ? 'branded'
            : states.has('system') ? 'system'
              : 'no-stock-colors';

    groups[state].push({
      name,
      category: rows[0].category,
      state,
      differs: [...new Set(rows.flatMap((row) => row.differs))],
      rows: rows.filter((row) => row.state !== 'no-stock-colors').length,
      allRows: rows.length,
      isNew: rows.some((row) => row.isNew),
    });
  }

  return groups;
}

/** System and branded templates start ticked; hand-edited ones never do. */
export function defaultSelection(groups: Record<TenantTemplateState, TemplateGroupEntry[]>): Set<string> {
  return new Set([...groups.system, ...groups.branded].map((entry) => entry.name));
}

/**
 * A row counts when its name is ticked, and a no-stock-colors row only when it
 * is also being overwritten — that is the one way an apply reaches it.
 */
export function countSelectedRows(
  groups: Record<TenantTemplateState, TemplateGroupEntry[]>,
  selected: Set<string>,
  overwrite: Set<string> = new Set(),
): number {
  return TEMPLATE_GROUP_ORDER
    .flatMap((state) => groups[state])
    .filter((entry) => selected.has(entry.name) || overwrite.has(entry.name))
    .reduce((total, entry) => total + (overwrite.has(entry.name) ? entry.allRows : entry.rows), 0);
}

export function buildApplyScope(
  groups: Record<TenantTemplateState, TemplateGroupEntry[]>,
  selected: Set<string>,
  languages: string[],
  overwrite: Set<string> = new Set(),
): EmailBrandingApplyScope {
  const entries = TEMPLATE_GROUP_ORDER
    .flatMap((state) => groups[state])
    .filter((entry) => overwrite.has(entry.name)
      || (selected.has(entry.name) && entry.state !== 'no-stock-colors'));

  return {
    names: entries.map((entry) => entry.name),
    languages,
    includeCustomized: groups.customized.filter((entry) => selected.has(entry.name)).map((entry) => entry.name),
    overwrite: entries.filter((entry) => overwrite.has(entry.name)).map((entry) => entry.name),
  };
}

export interface ApplySummary {
  written: number;
  skipped: number;
  failed: number;
}

export function summarizeApplyResult(result: EmailBrandingApplyResult): ApplySummary {
  return {
    written: result.written.length,
    skipped: result.skipped.length,
    failed: result.failed.length,
  };
}

/**
 * One preview per (name, language, overwrite): the eye reopens without a second
 * round trip, and ticking "overwrite" never shows the cached palette-only run.
 */
export const previewKey = (name: string, language: string, overwrite = false) =>
  `${name}::${language}${overwrite ? '::overwrite' : ''}`;

export type PreviewCacheEntry =
  | { status: 'loading' }
  | { status: 'ready'; preview: EmailBrandingPreviewResult }
  | { status: 'error'; error: string };

export type PreviewCache = Record<string, PreviewCacheEntry>;

/**
 * The language tabs the preview offers: the ticked languages this template
 * actually ships in, falling back to every language it ships in so the eye is
 * never a dead end.
 */
export function previewLanguagesFor(
  templates: EmailBrandingTemplateStatus[],
  name: string,
  languages: string[],
): string[] {
  const available = new Set(templates.filter((template) => template.name === name).map((template) => template.language));
  const ticked = languages.filter((language) => available.has(language));

  return ticked.length > 0 ? ticked : [...available].sort();
}
