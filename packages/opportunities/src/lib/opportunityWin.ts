import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export interface WinOpportunityOptions {
  convert_quote_id?: string;
  project_template_id?: string;
}

interface LinkedAcceptedQuote {
  quote_id: string;
  status: string;
}

export interface OpportunityWinConversionDependencies {
  getLinkedQuote(
    trx: Knex.Transaction,
    tenant: string,
    opportunityId: string,
    quoteId: string,
  ): Promise<LinkedAcceptedQuote | null>;
  convertQuoteToDraftContract(
    trx: Knex.Transaction,
    tenant: string,
    quoteId: string,
    actorUserId: string,
  ): Promise<{ contract: { contract_id: string } }>;
}

const defaultDependencies: OpportunityWinConversionDependencies = {
  async getLinkedQuote(trx, tenant, opportunityId, quoteId) {
    return tenantDb(trx, tenant).table('quotes')
      .where({ quote_id: quoteId, opportunity_id: opportunityId })
      .select('quote_id', 'status')
      .first();
  },
  async convertQuoteToDraftContract(trx, tenant, quoteId, actorUserId) {
    // Billing already depends on Opportunities for quote lifecycle hooks. Keep
    // this import lazy so module initialization does not create a hard cycle.
    const billing = await import('@alga-psa/billing/services');
    return billing.convertQuoteToDraftContract(trx, tenant, quoteId, actorUserId);
  },
};

export async function prepareOpportunityWinConversions(
  trx: Knex.Transaction,
  tenant: string,
  opportunityId: string,
  actorUserId: string,
  options: WinOpportunityOptions = {},
  dependencies: OpportunityWinConversionDependencies = defaultDependencies,
): Promise<{ converted_contract_id?: string }> {
  const patch: { converted_contract_id?: string } = {};

  if (options.convert_quote_id) {
    const quote = await dependencies.getLinkedQuote(
      trx,
      tenant,
      opportunityId,
      options.convert_quote_id,
    );
    if (!quote) throw new Error('Conversion quote must be linked to the opportunity');
    if (quote.status !== 'accepted') throw new Error('Conversion quote must be accepted');

    const result = await dependencies.convertQuoteToDraftContract(
      trx,
      tenant,
      quote.quote_id,
      actorUserId,
    );
    patch.converted_contract_id = result.contract.contract_id;
  }

  if (options.project_template_id) {
    throw new Error(
      'Project creation from a template is not yet available in the opportunity win flow',
    );
  }

  return patch;
}
