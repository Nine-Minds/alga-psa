import { Temporal } from '@js-temporal/polyfill';

const formatPartialPeriodDates = (start: string, exclusiveEnd: string): string => {
  const from = Temporal.PlainDate.from(start);
  const through = Temporal.PlainDate.from(exclusiveEnd).subtract({ days: 1 });
  const month = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
  const day = new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: 'UTC' });
  const year = new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'UTC' });
  const date = (value: Temporal.PlainDate) => new Date(`${value.toString()}T00:00:00.000Z`);
  const fromDate = date(from);
  const throughDate = date(through);
  const fromMonth = month.format(fromDate);
  const throughMonth = month.format(throughDate);
  if (from.year === through.year && from.month === through.month) {
    return `${fromMonth} ${day.format(fromDate)}–${day.format(throughDate)}, ${year.format(throughDate)}`;
  }
  return `${fromMonth} ${day.format(fromDate)}, ${year.format(fromDate)}–${throughMonth} ${day.format(throughDate)}, ${year.format(throughDate)}`;
};

export const buildPartialPeriodInvoiceDescription = (input: {
  sourceDescription: string;
  direction: 'increase' | 'decrease';
  units: number;
  start: string;
  exclusiveEnd: string;
  unitPrice: number;
  coveredDays: number;
  fullPeriodDays: number;
  currencyCode: string;
  formatCurrency: (amount: number, currencyCode: string) => string;
  describe: (direction: 'increase' | 'decrease', values: { description: string; units: number; unitLabel: string; period: string; calculation: string }) => string;
}): string => {
  const period = formatPartialPeriodDates(input.start, input.exclusiveEnd);
  const calculation = `${input.units} × ${input.formatCurrency(input.unitPrice / 100, input.currencyCode)} × ${input.coveredDays}/${input.fullPeriodDays}`;
  const unitLabel = input.sourceDescription.match(/\b(users?|seats?|licenses?|endpoints?)\b/i)?.[0].toLowerCase() ?? 'units';
  return input.describe(input.direction, {
    description: input.sourceDescription,
    units: input.units,
    unitLabel,
    period,
    calculation,
  });
};
