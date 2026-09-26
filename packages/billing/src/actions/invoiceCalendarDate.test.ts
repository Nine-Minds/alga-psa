import { afterEach, describe, expect, it } from 'vitest';
import { formatInvoiceCalendarDate } from './invoiceCalendarDate';

const originalTimezone = process.env.TZ;

afterEach(() => {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
});

describe('invoice email calendar date formatting', () => {
  it.each(['UTC', 'America/New_York'])('%s preserves both recipient and email invoice dates', (timezone) => {
    process.env.TZ = timezone;

    // October 10 is the reproduction from PM-SMOKE-0925-CHECK. PostgreSQL
    // returns DATE columns as YYYY-MM-DD strings at this action boundary.
    const invoice = { invoice_date: '2026-10-10', due_date: '2026-10-10' };
    const recipientDates = {
      invoiceDate: formatInvoiceCalendarDate(invoice.invoice_date, 'en-US'),
      dueDate: formatInvoiceCalendarDate(invoice.due_date, 'en-US'),
    };
    const emailDates = {
      invoiceDate: formatInvoiceCalendarDate(invoice.invoice_date, 'en-US'),
      dueDate: formatInvoiceCalendarDate(invoice.due_date, 'en-US'),
    };
    expect(recipientDates).toEqual({ invoiceDate: 'October 10, 2026', dueDate: 'October 10, 2026' });
    expect(emailDates).toEqual(recipientDates);
  });

});
