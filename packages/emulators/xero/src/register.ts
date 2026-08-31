import { z } from 'zod';
import type { ControlRegistry } from '@alga-psa/emulator-host';
import type { XeroEmulatorCore } from './core';

export function register(reg: ControlRegistry, core: XeroEmulatorCore): void {
  reg.seeder({
    name: 'organisation',
    description: 'Connect an additional Xero organisation (a second tenant in /connections)',
    params: z.object({ tenantId: z.string().optional(), tenantName: z.string() }),
    run: (params) => core.seedOrganisation(params),
  });

  reg.seeder({
    name: 'contact',
    description: 'Create a Xero contact (defaults to the first connected organisation)',
    params: z.object({
      name: z.string(),
      emailAddress: z.string().optional(),
      xeroTenantId: z.string().optional(),
    }),
    run: ({ name, emailAddress, xeroTenantId }) =>
      core.upsertContact(xeroTenantId ?? core.defaultTenantId, {
        Name: name,
        EmailAddress: emailAddress,
      }),
  });

  reg.seeder({
    name: 'invoice',
    description: 'Create a Xero ACCREC invoice with a single line (defaults to the first connected organisation)',
    params: z.object({
      contactId: z.string(),
      amountCents: z.number().int(),
      invoiceNumber: z.string().optional(),
      xeroTenantId: z.string().optional(),
    }),
    run: ({ contactId, amountCents, invoiceNumber, xeroTenantId }) => {
      const amount = Math.round(amountCents) / 100;
      return core.upsertInvoice(xeroTenantId ?? core.defaultTenantId, {
        Type: 'ACCREC',
        InvoiceNumber: invoiceNumber,
        Contact: { ContactID: contactId },
        LineAmountTypes: 'Exclusive',
        LineItems: [{ Description: 'Seeded line', Quantity: 1, UnitAmount: amount, LineAmount: amount }],
        SubTotal: amount,
        TotalTax: 0,
        Total: amount,
      });
    },
  });

  reg.action({
    name: 'expire-access-tokens',
    description: 'Expire every issued access token so the next API call 401s (exercises token refresh)',
    run: () => ({ expired: core.expireAccessTokens() }),
  });

  reg.stateView({
    name: 'authorize-requests',
    description: 'Every /identity/connect/authorize request received (client_id, scope, state, redirect_uri, issued code)',
    get: () => core.authorizeRequests,
  });

  reg.stateView({
    name: 'tokens',
    description: 'Issued access and refresh tokens with expiry and granted scope',
    get: () => core.tokens(),
  });

  reg.stateView({
    name: 'organisations',
    description: 'Connected Xero organisations as served by GET /connections',
    get: () => core.connections(),
  });

  reg.stateView({
    name: 'invoices',
    description: 'Stored invoices across all organisations (each row carries its xeroTenantId)',
    get: () => core.invoices(),
  });

  reg.stateView({
    name: 'contacts',
    description: 'Stored contacts across all organisations (each row carries its xeroTenantId)',
    get: () => core.contacts(),
  });
}
