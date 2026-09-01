import { z } from 'zod';
import type { ControlRegistry } from '@alga-psa/emulator-host';
import type { QboEmulatorCore } from './core';

export function register(reg: ControlRegistry, core: QboEmulatorCore): void {
  reg.seeder({
    name: 'client',
    description: 'Register an Intuit OAuth client id/secret pair',
    params: z.object({ clientId: z.string(), clientSecret: z.string() }),
    run: ({ clientId, clientSecret }) => {
      core.registerClient(clientId, clientSecret);
      return { clientId };
    },
  });

  reg.seeder({
    name: 'customer',
    description: 'Create a QBO customer',
    params: z.object({ name: z.string(), active: z.boolean().optional() }),
    run: ({ name, active }) => core.sim.seedCustomer({ name, active }),
  });

  reg.seeder({
    name: 'item',
    description: 'Create a QBO Item (product/service catalog entry)',
    params: z.object({
      name: z.string(),
      type: z.enum(['Service', 'NonInventory', 'Inventory', 'Category']),
      sku: z.string().optional(),
      description: z.string().optional(),
      unitPrice: z.number().optional(),
      purchaseCost: z.number().optional(),
      active: z.boolean().optional(),
      taxCodeId: z.string().optional(),
      fullyQualifiedName: z.string().optional(),
    }),
    run: (params) => core.sim.seedItem(params),
  });

  reg.seeder({
    name: 'tax-rate',
    description: 'Create a QBO TaxRate component (RateValue is a percentage: 8 means 8%)',
    params: z.object({ name: z.string(), ratePercent: z.number(), id: z.string().optional() }),
    run: (params) => core.sim.seedTaxRate(params),
  });

  reg.seeder({
    name: 'tax-code',
    description: 'Create a QBO TaxCode; pass taxRateIds for a real group, or pseudo for TAX/NON',
    params: z.object({
      name: z.string(),
      id: z.string().optional(),
      description: z.string().optional(),
      taxRateIds: z.array(z.string()).optional(),
      pseudo: z.boolean().optional(),
      active: z.boolean().optional(),
    }),
    run: (params) => core.sim.seedTaxCode(params),
  });

  reg.seeder({
    name: 'invoice',
    description: 'Create a QBO invoice with a single sales line',
    params: z.object({
      customerId: z.string(),
      amountCents: z.number().int(),
      docNumber: z.string().optional(),
    }),
    run: (params) => core.sim.seedInvoice(params),
  });

  reg.seeder({
    name: 'credit-memo',
    description: 'Create a QBO credit memo with a single sales line',
    params: z.object({
      customerId: z.string(),
      amountCents: z.number().int(),
      docNumber: z.string().optional(),
    }),
    run: (params) => core.sim.seedCreditMemo(params),
  });

  reg.action({
    name: 'mint-tokens',
    description: 'Issue an access/refresh token pair directly, skipping the browser OAuth flow',
    params: z.object({ clientId: z.string() }),
    run: ({ clientId }) => core.mintTokens(clientId),
  });

  reg.action({
    name: 'receive-payment',
    description: 'A customer payment arriving inside QBO against an invoice (bumps SyncToken, reduces Balance)',
    params: z.object({
      invoiceId: z.string(),
      amountCents: z.number().int(),
      referenceNumber: z.string().optional(),
      txnDate: z.string().optional(),
    }),
    run: (params) => core.sim.receivePaymentInQbo(params),
  });

  reg.action({
    name: 'apply-credit',
    description: 'A bookkeeper applying a credit memo to an invoice inside QBO',
    params: z.object({
      creditMemoId: z.string(),
      invoiceId: z.string(),
      amountCents: z.number().int(),
    }),
    run: (params) => core.sim.applyCreditInQbo(params),
  });

  reg.action({
    name: 'configure',
    description:
      'Toggle company behavior: AutoApplyCredit, the AST tax adjustment, and Automated Sales Tax (pass a default TaxCode id to enable, null to disable)',
    params: z.object({
      autoApplyCredits: z.boolean().optional(),
      taxAdjustmentCents: z.number().int().optional(),
      automatedSalesTaxDefaultTaxCodeId: z.string().nullable().optional(),
    }),
    run: (params) => core.configure(params),
  });

  reg.action({
    name: 'expire-access-tokens',
    description: 'Expire every issued access token so the next API call 401s (exercises token refresh)',
    run: () => ({ expired: core.expireAccessTokens() }),
  });

  reg.action({
    name: 'revoke-refresh-token',
    description: 'Revoke a refresh token so the next refresh grant fails',
    params: z.object({ refreshToken: z.string() }),
    run: ({ refreshToken }) => ({ revoked: core.revokeRefreshToken(refreshToken) }),
  });

  for (const [view, entityType] of [
    ['customers', 'Customer'],
    ['invoices', 'Invoice'],
    ['credit-memos', 'CreditMemo'],
    ['payments', 'Payment'],
    ['items', 'Item'],
    ['tax-codes', 'TaxCode'],
    ['tax-rates', 'TaxRate'],
  ] as const) {
    reg.stateView({
      name: view,
      description: `QBO ${entityType} entities`,
      get: () => core.sim.entities(entityType),
    });
  }

  reg.stateView({
    name: 'config',
    description: 'Company behavior configuration and realm',
    get: () => ({ realmId: core.realmId, ...core.config() }),
  });
}
