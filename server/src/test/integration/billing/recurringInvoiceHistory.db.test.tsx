// @vitest-environment jsdom

import React from 'react';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {
  createTestDbConnection,
  wireLocalTestDbEnv,
} from '@alga-psa/billing/actions/_dbTestUtils';
import invoicing from '../../../../public/locales/en/msp/invoicing.json';
import common from '../../../../public/locales/en/common.json';

const mocks = vi.hoisted(() => ({
  tenant: '',
  db: null as Knex | null,
  hasPermission: vi.fn(async () => true),
}));

// Keep the SQL, tenant facade, transaction, row mapper, and UI formatter real.
// Only supply the authenticated test tenant and isolate unrelated actions.
vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (user: { tenant: string }, context: { tenant: string }, ...args: unknown[]) => unknown) => (...args: unknown[]) =>
    action({ tenant: mocks.tenant }, { tenant: mocks.tenant }, ...args),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.hasPermission }));
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@alga-psa/db')>(),
  createTenantKnex: async () => ({ knex: mocks.db, tenant: mocks.tenant }),
}));
vi.mock('@alga-psa/formatting/avatarUtils', () => ({
  getClientLogoUrlsBatch: vi.fn(async () => new Map()),
}));
vi.mock('@alga-psa/billing/actions/billingAndTax', () => ({
  getNextBillingDate: vi.fn(),
  getAvailableRecurringDueWork: vi.fn(async () => ({
    invoiceCandidates: [], recurringDueWork: [], materializationGaps: [],
  })),
}));
vi.mock('@alga-psa/billing/actions/invoiceModification', () => ({ hardDeleteInvoice: vi.fn() }));
vi.mock('@alga-psa/billing/actions/invoiceGeneration', () => ({
  getPurchaseOrderOverageForSelectionInput: vi.fn(),
  previewGroupedInvoicesForSelectionInputs: vi.fn(),
}));
vi.mock('@alga-psa/billing/actions/recurringBillingRunActions', () => ({
  generateCalendarMonthEndCloseInvoices: vi.fn(),
  generateGroupedInvoicesAsRecurringBillingRun: vi.fn(),
  generateInvoicesAsRecurringBillingRun: vi.fn(),
}));
vi.mock('@alga-psa/billing/actions/recurringServicePeriodActions', () => ({
  repairAllRecurringServicePeriodsForTenant: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@alga-psa/ui/components/DateRangePicker', () => ({ DateRangePicker: () => null }));
// The server test setup normally replaces i18n; this regression needs the real
// provider, English fallback resources, useFormatters, and formatDateValue.
vi.unmock('@alga-psa/ui/lib/i18n/client');

const { getRecurringInvoiceHistoryPaginated } = await import('@alga-psa/billing/actions/billingCycleActions');
const { default: AutomaticInvoices } = await import('@alga-psa/billing/components/billing-dashboard/AutomaticInvoices');
const { I18nProvider, useFormatters } = await import('@alga-psa/ui/lib/i18n/client');

const tenant = randomUUID();
const clientId = randomUUID();
const invoiceId = randomUUID();
const previousTZ = process.env.TZ;
let db: Knex;
const resources = { 'msp/invoicing': invoicing, common };

beforeAll(async () => {
  // Hydrate as the UTC server does, then render in the New York viewer zone.
  process.env.TZ = 'UTC';
  wireLocalTestDbEnv();
  db = await createTestDbConnection();
  mocks.db = db;
  mocks.tenant = tenant;
  await db('tenants').insert({ tenant, client_name: 'History Date Regression', email: 'history@example.com' });
  await db('clients').insert({ tenant, client_id: clientId, client_name: 'History Date Client' });
  await db('invoices').insert({
    tenant, invoice_id: invoiceId, client_id: clientId, invoice_number: 'INV-HISTORY-DATE',
    invoice_date: '2026-09-30', due_date: '2026-10-30', total_amount: 0, status: 'draft',
    billing_period_start: '2026-10-01', billing_period_end: '2026-11-01',
  });
  await db('recurring_service_periods').insert({
    tenant, schedule_key: `history:${invoiceId}`, period_key: 'period:2026-09-01:2026-10-01',
    revision: 1, obligation_id: randomUUID(), obligation_type: 'client_contract_line',
    charge_family: 'fixed', cadence_owner: 'client', due_position: 'arrears', lifecycle_state: 'billed',
    service_period_start: '2026-09-01', service_period_end: '2026-10-01',
    invoice_window_start: '2026-10-01', invoice_window_end: '2026-11-01',
    provenance_kind: 'generated', source_rule_version: '1.0.0',
    invoice_id: invoiceId, invoice_linked_at: db.fn.now(),
  });
});

afterEach(() => { cleanup(); mocks.hasPermission.mockResolvedValue(true); });
afterAll(async () => {
  if (db) {
    for (const table of ['recurring_service_periods', 'invoices', 'clients', 'tenants']) {
      await db(table).where({ tenant }).del();
    }
    await db.destroy();
  }
  if (previousTZ === undefined) delete process.env.TZ;
  else process.env.TZ = previousTZ;
});

function TimestampProbe() {
  const { formatDate } = useFormatters();
  return <div data-testid="timestamp">{formatDate('2026-09-30T00:00:00.000Z')}</div>;
}

describe('recurring history database-to-action-to-UI calendar dates', () => {
  it('serializes PostgreSQL-hydrated dates as calendar dates', async () => {
    process.env.TZ = 'UTC';
    const hydrated = await db('invoices').where({ tenant, invoice_id: invoiceId }).first();
    expect(hydrated.invoice_date).toBeInstanceOf(Date);
    expect(hydrated.invoice_date.toISOString()).toBe('2026-09-30T00:00:00.000Z');
    const result = await getRecurringInvoiceHistoryPaginated();
    expect(result).toMatchObject({ total: 1, rows: [{
      invoiceId, invoiceDate: '2026-09-30',
      servicePeriodStart: '2026-09-01', servicePeriodEnd: '2026-10-01',
      invoiceWindowStart: '2026-10-01', invoiceWindowEnd: '2026-11-01',
    }] });
  });

  it('renders the real history action result as 30/09/2026 in en-AU / New York', async () => {
    process.env.TZ = 'America/New_York';
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/New_York');
    render(
      <I18nProvider initialLocale="en-AU" namespaces={['common', 'msp/invoicing']} preloadedResources={resources}>
        <AutomaticInvoices onGenerateSuccess={() => undefined} />
        <TimestampProbe />
      </I18nProvider>,
    );
    const invoice = await screen.findByText('INV-HISTORY-DATE', {}, { timeout: 10000 });
    const row = invoice.closest('tr');
    if (!row) throw new Error('Expected the invoice inside the recurring-history table row');
    expect(within(row).getByText('30/09/2026')).toBeInTheDocument();
    expect(within(row).queryByText('29/09/2026')).not.toBeInTheDocument();
    // True instants retain the existing viewer-timezone behavior.
    expect(screen.getByTestId('timestamp')).toHaveTextContent('29/09/2026');
  });

  it('still refuses history reads without billing read permission', async () => {
    mocks.hasPermission.mockResolvedValue(false);
    expect(await getRecurringInvoiceHistoryPaginated()).toMatchObject({
      messageKey: 'msp/billing:errors.permissions.billingRead',
    });
  });
});
