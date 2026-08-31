import { z } from 'zod';
import type { ControlRegistry } from '@alga-psa/emulator-host';
import type { QboEmulatorCore } from './core';

/**
 * Every entity seeder/action takes an optional realmId so scenarios can run
 * several company files side by side (colliding entity ids included); omitted
 * it targets the default realm the emulator boots with.
 */
const realmParam = { realmId: z.string().optional() };

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
    name: 'realm',
    description: 'Add a separately-stated QBO company file under its own realm id',
    params: z.object({ realmId: z.string() }),
    run: ({ realmId }) => core.addRealm(realmId),
  });

  reg.seeder({
    name: 'customer',
    description: 'Create a QBO customer',
    params: z.object({ name: z.string(), active: z.boolean().optional(), ...realmParam }),
    run: ({ realmId, ...params }) => core.simFor(realmId).seedCustomer(params),
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
      ...realmParam,
    }),
    run: ({ realmId, ...params }) => core.simFor(realmId).seedItem(params),
  });

  reg.seeder({
    name: 'tax-rate',
    description: 'Create a QBO TaxRate component (RateValue is a percentage: 8 means 8%)',
    params: z.object({ name: z.string(), ratePercent: z.number(), id: z.string().optional(), ...realmParam }),
    run: ({ realmId, ...params }) => core.simFor(realmId).seedTaxRate(params),
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
      ...realmParam,
    }),
    run: ({ realmId, ...params }) => core.simFor(realmId).seedTaxCode(params),
  });

  reg.seeder({
    name: 'invoice',
    description: 'Create a QBO invoice with a single sales line',
    params: z.object({
      customerId: z.string(),
      amountCents: z.number().int(),
      docNumber: z.string().optional(),
      ...realmParam,
    }),
    run: ({ realmId, ...params }) => core.simFor(realmId).seedInvoice(params),
  });

  reg.seeder({
    name: 'credit-memo',
    description: 'Create a QBO credit memo with a single sales line',
    params: z.object({
      customerId: z.string(),
      amountCents: z.number().int(),
      docNumber: z.string().optional(),
      ...realmParam,
    }),
    run: ({ realmId, ...params }) => core.simFor(realmId).seedCreditMemo(params),
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
      ...realmParam,
    }),
    run: ({ realmId, ...params }) => core.simFor(realmId).receivePaymentInQbo(params),
  });

  reg.action({
    name: 'apply-credit',
    description: 'A bookkeeper applying a credit memo to an invoice inside QBO',
    params: z.object({
      creditMemoId: z.string(),
      invoiceId: z.string(),
      amountCents: z.number().int(),
      ...realmParam,
    }),
    run: ({ realmId, ...params }) => core.simFor(realmId).applyCreditInQbo(params),
  });

  reg.action({
    name: 'configure',
    description:
      'Toggle company behavior: AutoApplyCredit, the AST tax adjustment, and Automated Sales Tax (pass a default TaxCode id to enable, null to disable)',
    params: z.object({
      autoApplyCredits: z.boolean().optional(),
      taxAdjustmentCents: z.number().int().optional(),
      automatedSalesTaxDefaultTaxCodeId: z.string().nullable().optional(),
      ...realmParam,
    }),
    run: ({ realmId, ...params }) => core.configure(params, realmId),
  });

  reg.action({
    name: 'entities',
    description: 'Read one entity type from one company file (per-realm state assertion)',
    params: z.object({
      entityType: z.enum(['Customer', 'Invoice', 'CreditMemo', 'Payment', 'Item', 'TaxCode', 'TaxRate']),
      ...realmParam,
    }),
    run: ({ realmId, entityType }) => core.simFor(realmId).entities(entityType),
  });

  reg.action({
    name: 'select-company',
    description: "Choose which company the authorize flow's company picker returns (null resets to default)",
    params: z.object({ realmId: z.string().nullable() }),
    run: ({ realmId }) => {
      if (realmId !== null) core.simFor(realmId); // validate it exists
      core.authorizeRealmId = realmId;
      return { authorizeRealmId: realmId };
    },
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
      description: `QBO ${entityType} entities (default realm)`,
      get: () => core.sim.entities(entityType),
    });
  }

  reg.stateView({
    name: 'config',
    description: 'Company behavior configuration and realm',
    get: () => ({ realmId: core.realmId, realms: core.realmIds(), ...core.config() }),
  });
}
