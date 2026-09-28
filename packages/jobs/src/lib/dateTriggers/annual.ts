import { Temporal } from '@js-temporal/polyfill';

/** Returns yearly occurrences in an inclusive local-calendar date range. Feb 29 maps to Feb 28 in non-leap years. */
export function nextAnnualOccurrence(anchor: string, from: string, to: string): Array<{ occursOn: string; yearsAsClient: number }> {
  const start = Temporal.PlainDate.from(anchor);
  const first = Temporal.PlainDate.from(from);
  const last = Temporal.PlainDate.from(to);
  if (Temporal.PlainDate.compare(last, first) < 0) return [];
  const out: Array<{ occursOn: string; yearsAsClient: number }> = [];
  for (let year = first.year; year <= last.year; year += 1) {
    if (year - start.year < 1) continue;
    const occurs = Temporal.PlainDate.from({ year, month: start.month, day: start.day }, { overflow: 'constrain' });
    if (Temporal.PlainDate.compare(occurs, first) >= 0 && Temporal.PlainDate.compare(occurs, last) <= 0) {
      out.push({ occursOn: occurs.toString(), yearsAsClient: year - start.year });
    }
  }
  return out;
}
