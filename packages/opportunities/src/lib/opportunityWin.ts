import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

export interface WinOpportunityOptions {
  convert_quote_id?: string;
  project_template_id?: string;
  project_name?: string;
  project_status_id?: string;
  project_start_date?: string;
}

interface LinkedAcceptedQuote {
  quote_id: string;
  status: string;
}

export interface OpportunityWinConversionDependencies {
  getOpportunityForProject(
    trx: Knex.Transaction,
    tenant: string,
    opportunityId: string,
  ): Promise<{ title: string; client_id: string } | null>;
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
  createProjectFromTemplate(
    trx: Knex.Transaction,
    tenant: string,
    templateId: string,
    projectData: {
      project_name: string;
      client_id: string;
      status_id?: string;
      start_date?: string;
    },
  ): Promise<string>;
}

const defaultDependencies: OpportunityWinConversionDependencies = {
  async getOpportunityForProject(trx, tenant, opportunityId) {
    return tenantDb(trx, tenant).table('opportunities')
      .where({ opportunity_id: opportunityId })
      .select('title', 'client_id')
      .first();
  },
  async getLinkedQuote(trx, tenant, opportunityId, quoteId) {
    return tenantDb(trx, tenant).table('quotes')
      .where({ quote_id: quoteId, opportunity_id: opportunityId })
      .select('quote_id', 'status')
      .first();
  },
  async convertQuoteToDraftContract(trx, tenant, quoteId, actorUserId) {
    // Billing already depends on Opportunities for quote lifecycle hooks. Keep
    // this import lazy so module initialization does not create a hard cycle,
    // and keep the intentional runtime integration out of the Nx package graph.
    // nx-ignore-next-line
    const billing = await import('@alga-psa/billing/services');
    return billing.convertQuoteToDraftContract(trx, tenant, quoteId, actorUserId);
  },
  async createProjectFromTemplate(trx, tenant, templateId, projectData) {
    const projects = await import('@alga-psa/projects/services');
    return projects.applyProjectTemplate(trx, tenant, templateId, projectData);
  },
};

export async function prepareOpportunityWinConversions(
  trx: Knex.Transaction,
  tenant: string,
  opportunityId: string,
  actorUserId: string,
  options: WinOpportunityOptions = {},
  dependencies: OpportunityWinConversionDependencies = defaultDependencies,
): Promise<{ converted_contract_id?: string; converted_project_id?: string }> {
  const patch: { converted_contract_id?: string; converted_project_id?: string } = {};

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
    const opportunity = await dependencies.getOpportunityForProject(trx, tenant, opportunityId);
    if (!opportunity) throw new Error('Opportunity not found');

    patch.converted_project_id = await dependencies.createProjectFromTemplate(
      trx,
      tenant,
      options.project_template_id,
      {
        project_name: options.project_name?.trim() || opportunity.title,
        client_id: opportunity.client_id,
        status_id: options.project_status_id,
        start_date: options.project_start_date,
      },
    );
  }

  return patch;
}
