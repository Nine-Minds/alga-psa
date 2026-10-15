import type { TemplateLabelTranslator } from './i18nLabels';

const labels: Record<string, string> = {
  'time.mixed': 'Mixed rates',
  'time.unknown': 'Rate unavailable',
  'time.other': 'Other billed time',
  'time.ticket': 'Ticket',
  'time.task': 'Project task',
  'time.partial': 'Some billed time is shown as service charges because ticket detail is unavailable.',
  'time.unavailable': 'Ticket detail is unavailable. All charges are shown below.',
  'time.detailPartial': 'Only available billed-time entries are included in this detail.',
  'time.detailUnavailable': 'Billed-time entry detail is unavailable for this invoice.',
};

/** Pure localization of semantic renderer fields, including nested transform rows.
 * Snapshot descriptions and numeric money are never translated or reformatted.
 */
export function localizeTimePresentation<T>(value: T, t: TemplateLabelTranslator = (_key, options) => options.defaultValue): T {
  const visit = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(visit);
    if (!input || typeof input !== 'object') return input;
    const row = Object.fromEntries(Object.entries(input).map(([key, child]) => [key, visit(child)]));
    if (row.timePresentation === true) {
      if (row.rateKind === 'mixed' || row.rateKind === 'unknown') {
        const key = `time.${row.rateKind}`;
        row.rateDisplay = t(key, { defaultValue: labels[key] });
      }
      if (typeof row.labelKey === 'string' && labels[row.labelKey]) row.label = t(row.labelKey, { defaultValue: labels[row.labelKey] });
    }
    if (typeof row.ticketCoverageStatus === 'string') {
      const key = `time.${row.ticketCoverageStatus}`;
      row.ticketCoverageNote = labels[key] ? t(key, { defaultValue: labels[key] }) : '';
      const hasIncompleteCoverage = ['partial', 'unavailable'].includes(row.ticketCoverageStatus);
      const detailKey = hasIncompleteCoverage
        ? Array.isArray(row.timeEntries) && row.timeEntries.length > 0 ? 'time.detailPartial' : 'time.detailUnavailable'
        : '';
      row.ticketDetailNote = detailKey ? t(detailKey, { defaultValue: labels[detailKey] }) : '';
    }
    return row;
  };
  return visit(value) as T;
}

/** A serializable document-locale dictionary for the canvas. */
export const timePresentationLabels = (
  // Unsupported locales fall back to the authored defaults, matching the
  // document render seam's fallback-to-English contract.
  t: TemplateLabelTranslator = (_key, options) => options.defaultValue
): Record<string, string> =>
  Object.fromEntries(Object.entries(labels).map(([key, defaultValue]) => [key, t(key, { defaultValue })]));

/** Presentation fields are derived, never locale-dependent transform inputs.
 * Recover them from their semantic provenance if a caller supplies display data.
 */
export function neutralizeTimePresentation<T>(value: T): T {
  const visit = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(visit);
    if (!input || typeof input !== 'object') return input;
    const row = Object.fromEntries(Object.entries(input).map(([key, child]) => [key, visit(child)]));
    if (row.timePresentation === true) {
      if (row.rateKind === 'mixed' || row.rateKind === 'unknown') row.rateDisplay = null;
      else if (row.rateKind === 'uniform') row.rateDisplay = row.rate;
      if (typeof row.labelKey === 'string' && labels[row.labelKey]) row.label = '';
    }
    if (typeof row.ticketCoverageStatus === 'string') { row.ticketCoverageNote = ''; row.ticketDetailNote = ''; }
    return row;
  };
  return visit(value) as T;
}
