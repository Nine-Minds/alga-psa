import { createTenantKnex } from '@alga-psa/db';
import type { Knex } from 'knex';
import type { IClientContractLine, ITransaction } from '@alga-psa/types';

class ClientContractLine {
  static async checkOverlappingBilling(
    clientId: string,
    serviceCategory: string,
    startDate: Date,
    endDate: Date | null,
    excludeContractLineId?: string,
    excludeContractId?: string
  ): Promise<IClientContractLine[]> {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for checking overlapping contract lines');
    }

    const query = db('client_contract_lines')
      .where({
        client_id: clientId,
        service_category: serviceCategory,
        tenant
      })
      .where(function(this: Knex.QueryBuilder) {
        this.where(function(this: Knex.QueryBuilder) {
          this.where('start_date', '<=', startDate)
            .where(function(this: Knex.QueryBuilder) {
              this.where('end_date', '>=', startDate).orWhereNull('end_date');
            });
        }).orWhere(function() {
          this.where('start_date', '>=', startDate)
            .where('start_date', '<=', endDate || db.raw('CURRENT_DATE'));
        });
      });

    if (excludeContractLineId) {
      query.whereNot('client_contract_line_id', excludeContractLineId);
    }

    if (excludeContractId) {
      query.where(function() {
        this.whereNot('client_contract_id', excludeContractId)
          .orWhereNull('client_contract_id');
      });
    }

    const directOverlappingPlans = await query;

    const contractAssociationQuery = db('client_contracts as cc')
      .join('contract_lines as cl', function() {
        this.on('cc.contract_id', '=', 'cl.contract_id')
          .andOn('cl.tenant', '=', 'cc.tenant');
      })
      .where({
        'cc.client_id': clientId,
        'cc.is_active': true,
        'cc.tenant': tenant,
        'cl.service_category': serviceCategory
      })
      .where(function(this: Knex.QueryBuilder) {
        this.where(function(this: Knex.QueryBuilder) {
          this.where('cc.start_date', '<=', startDate)
            .where(function(this: Knex.QueryBuilder) {
              this.where('cc.end_date', '>=', startDate).orWhereNull('cc.end_date');
            });
        }).orWhere(function() {
          this.where('cc.start_date', '>=', startDate)
            .where('cc.start_date', '<=', endDate || db.raw('CURRENT_DATE'));
        });
      });

    if (excludeContractId) {
      contractAssociationQuery.whereNot('cc.contract_id', excludeContractId);
    }

    const contractAssociationResults = await contractAssociationQuery
      .select(
        'cl.contract_line_id',
        'cl.contract_line_name',
        'cl.service_category',
        'cc.start_date',
        'cc.end_date',
        'cc.client_contract_id',
        'cl.custom_rate'
      );

    const formattedContractAssociations = contractAssociationResults.map((plan: any) => ({
      client_contract_line_id: `contract-${plan.client_contract_id}-${plan.contract_line_id}`,
      client_id: clientId,
      contract_line_id: plan.contract_line_id,
      service_category: plan.service_category,
      start_date: plan.start_date,
      end_date: plan.end_date,
      is_active: true,
      custom_rate: plan.custom_rate,
      client_contract_id: plan.client_contract_id,
      contract_line_name: plan.contract_line_name,
      tenant
    }));

    return [...directOverlappingPlans, ...formattedContractAssociations];
  }

  static async create(billingData: Omit<IClientContractLine, 'client_contract_line_id'>): Promise<IClientContractLine> {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for creating contract line');
    }

    try {
      const { tenant: _, ...dataToInsert } = billingData;

      const [createdContractLine] = await db('client_contract_lines')
        .insert({
          ...dataToInsert,
          tenant
        })
        .returning('*');

      if (!createdContractLine) {
        throw new Error('Failed to create contract line - no record returned');
      }

      return createdContractLine;
    } catch (error) {
      console.error('Error creating contract line:', error);
      throw error;
    }
  }

  static async update(contractLineId: string, billingData: Partial<IClientContractLine>): Promise<IClientContractLine> {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for updating contract line');
    }

    try {
      const { tenant: _, ...dataToUpdate } = billingData;

      const [updatedContractLine] = await db('client_contract_lines')
        .where({
          client_contract_line_id: contractLineId,
          tenant
        })
        .update({
          ...dataToUpdate,
          tenant
        })
        .returning('*');

      if (!updatedContractLine) {
        throw new Error(`Contract Line ${contractLineId} not found or belongs to different tenant`);
      }

      return updatedContractLine;
    } catch (error) {
      console.error(`Error updating contract line ${contractLineId}:`, error);
      throw error;
    }
  }

  static async getByClientId(clientId: string, includeContractPlans: boolean = true): Promise<IClientContractLine[]> {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for fetching client contract lines');
    }

    try {
      const directPlans = await db('client_contract_lines')
        .join('contract_lines', function() {
          this.on('client_contract_lines.contract_line_id', '=', 'contract_lines.contract_line_id')
            .andOn('contract_lines.tenant', '=', 'client_contract_lines.tenant');
        })
        .where({
          'client_contract_lines.client_id': clientId,
          'client_contract_lines.tenant': tenant
        })
        .select(
          'client_contract_lines.*',
          'contract_lines.contract_line_name',
          'contract_lines.billing_frequency'
        );

      if (!includeContractPlans) {
        return directPlans;
      }

      const contractPlans = await db('client_contracts as cc')
        .join('contract_lines as cl', function() {
          this.on('cc.contract_id', '=', 'cl.contract_id')
            .andOn('cl.tenant', '=', 'cc.tenant');
        })
        .join('contracts as c', function() {
          this.on('cc.contract_id', '=', 'c.contract_id')
            .andOn('c.tenant', '=', 'cc.tenant');
        })
        .where({
          'cc.client_id': clientId,
          'cc.is_active': true,
          'cc.tenant': tenant
        })
        .select(
          'cl.contract_line_id',
          'cl.contract_line_name',
          'cl.billing_frequency',
          'cl.service_category',
          'cl.custom_rate',
          'cc.start_date',
          'cc.end_date',
          'cc.client_contract_id',
          db.raw("'contract' as source")
        );

      const formattedContractPlans = contractPlans.map((plan: any) => ({
        client_contract_line_id: `contract-${plan.client_contract_id}-${plan.contract_line_id}`,
        client_id: clientId,
        contract_line_id: plan.contract_line_id,
        service_category: plan.service_category,
        start_date: plan.start_date,
        end_date: plan.end_date,
        is_active: true,
        custom_rate: plan.custom_rate,
        client_contract_id: plan.client_contract_id,
        contract_line_name: plan.contract_line_name,
        billing_frequency: plan.billing_frequency,
        tenant,
        source: plan.source
      }));

      return [...directPlans, ...formattedContractPlans];
    } catch (error) {
      console.error(`Error fetching contract lines for client ${clientId}:`, error);
      throw error;
    }
  }

  static async get(contractLineId: string): Promise<IClientContractLine | undefined> {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for fetching contract line');
    }

    const line = await db('client_contract_lines')
      .where({
        client_contract_line_id: contractLineId,
        tenant
      })
      .first();

    return line;
  }

  static async delete(contractLineId: string): Promise<void> {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for deleting contract line');
    }

    await db('client_contract_lines')
      .where({
        client_contract_line_id: contractLineId,
        tenant
      })
      .del();
  }

  static async checkExistingTransactions(
    contractLineId: string
  ): Promise<ITransaction[]> {
    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant context is required for checking transactions');
    }

    return db('transactions')
      .where({
        client_contract_line_id: contractLineId,
        tenant
      })
      .select('*');
  }
}

export default ClientContractLine;

