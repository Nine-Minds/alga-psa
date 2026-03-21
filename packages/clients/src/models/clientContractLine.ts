import { createTenantKnex } from '@alga-psa/db';
import type { Knex } from 'knex';
import type { IClientContractLine, ITransaction } from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';

class ClientContractLine {
  private static parseClientContractLineIdentity(value: string): { clientContractId?: string; contractLineId: string } {
    const match = value.match(/^contract-([0-9a-fA-F-]{36})-([0-9a-fA-F-]{36})$/);
    if (!match) {
      return { contractLineId: value };
    }
    return {
      clientContractId: match[1],
      contractLineId: match[2],
    };
  }

  private static buildClientContractLineBaseQuery(
    db: Knex,
    tenant: string,
  ): Knex.QueryBuilder {
    return db('contract_lines as cl')
      .join('client_contracts as cc', function(this: Knex.JoinClause) {
        this.on('cc.contract_id', '=', 'cl.contract_id')
          .andOn('cc.tenant', '=', 'cl.tenant');
      })
      .join('contracts as c', function(this: Knex.JoinClause) {
        this.on('c.contract_id', '=', 'cl.contract_id')
          .andOn('c.tenant', '=', 'cl.tenant');
      })
      .where('cl.tenant', tenant)
      .where(function(this: Knex.QueryBuilder) {
        this.whereNull('c.is_template').orWhere('c.is_template', false);
      });
  }

  private static contractLineSelectColumns(db: Knex): Array<string | Knex.Raw> {
    // template_contract_id is exposed only as provenance metadata for callers.
    // Runtime reads and writes remain anchored on cc.contract_id / cl.contract_line_id.
    return [
      db.raw("concat('contract-', cc.client_contract_id, '-', cl.contract_line_id) as client_contract_line_id"),
      'cc.client_id',
      'cl.contract_line_id',
      'cl.service_category',
      'cc.start_date',
      'cc.end_date',
      'cl.is_active',
      'cl.custom_rate',
      'cc.client_contract_id',
      'cc.template_contract_id',
      'cl.contract_line_name',
      'cl.billing_frequency',
      'cl.billing_timing',
      'cl.cadence_owner',
      'cl.tenant',
      db.raw("'contract' as source"),
    ];
  }

  static async checkOverlappingBilling(
    clientId: string,
    serviceCategory: string | null,
    startDate: Date,
    endDate: Date | null,
    excludeContractLineId?: string,
    excludeContractId?: string,
    tenantId?: string
  ): Promise<IClientContractLine[]> {
    const { knex: db, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for checking overlapping contract lines');
    }

    const query = this.buildClientContractLineBaseQuery(db, tenant)
      .where({
        'cc.client_id': clientId,
        'c.owner_client_id': clientId,
      })
      .where('cc.is_active', true)
      .where('cl.is_active', true)
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

    if (serviceCategory) {
      query.andWhere('cl.service_category', serviceCategory);
    }

    if (excludeContractLineId) {
      const identity = this.parseClientContractLineIdentity(excludeContractLineId);
      query.whereNot('cl.contract_line_id', identity.contractLineId);
    }

    if (excludeContractId) {
      query.whereNot('cc.client_contract_id', excludeContractId);
    }

    return query.select(this.contractLineSelectColumns(db)) as unknown as IClientContractLine[];
  }

  static async create(billingData: Omit<IClientContractLine, 'client_contract_line_id'>, tenantId?: string): Promise<IClientContractLine> {
    const { knex: db, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for creating contract line');
    }

    try {
      if (!billingData.client_contract_id) {
        throw new Error('client_contract_id is required');
      }

      const clientContract = await db('client_contracts')
        .where({ tenant, client_contract_id: billingData.client_contract_id })
        .first('contract_id');
      if (!clientContract?.contract_id) {
        throw new Error('Client contract not found');
      }

      const templateLine = await db('contract_lines')
        .where({ tenant, contract_line_id: billingData.contract_line_id })
        .first();
      if (!templateLine) {
        throw new Error(`Template contract line ${billingData.contract_line_id} not found`);
      }

      const createdContractLineId = uuidv4();
      await db('contract_lines').insert({
        contract_line_id: createdContractLineId,
        tenant,
        contract_id: clientContract.contract_id,
        contract_line_name: templateLine.contract_line_name,
        description: templateLine.description,
        billing_frequency: templateLine.billing_frequency,
        contract_line_type: templateLine.contract_line_type,
        service_category: billingData.service_category ?? templateLine.service_category,
        custom_rate: billingData.custom_rate ?? templateLine.custom_rate,
        is_active: billingData.is_active ?? true,
        is_custom: false,
        billing_timing: billingData.billing_timing ?? templateLine.billing_timing,
        cadence_owner: billingData.cadence_owner ?? templateLine.cadence_owner,
        display_order: templateLine.display_order ?? 0,
        enable_proration: templateLine.enable_proration ?? false,
        enable_overtime: templateLine.enable_overtime ?? false,
        overtime_rate: templateLine.overtime_rate,
        overtime_threshold: templateLine.overtime_threshold,
        enable_after_hours_rate: templateLine.enable_after_hours_rate ?? false,
        after_hours_multiplier: templateLine.after_hours_multiplier,
        created_at: db.fn.now(),
        updated_at: db.fn.now(),
      });

      const createdContractLine = await this.get(createdContractLineId, tenantId);

      if (!createdContractLine) {
        throw new Error('Failed to create contract line - no record returned');
      }

      return createdContractLine;
    } catch (error) {
      console.error('Error creating contract line:', error);
      throw error;
    }
  }

  static async update(contractLineId: string, billingData: Partial<IClientContractLine>, tenantId?: string): Promise<IClientContractLine> {
    const { knex: db, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for updating contract line');
    }

    try {
      const {
        client_contract_line_id,
        client_id,
        start_date,
        end_date,
        client_contract_id,
        template_contract_id,
        contract_line_name,
        billing_frequency,
        tenant: _tenant,
        source,
        ...lineUpdates
      } = billingData as Partial<IClientContractLine> & { source?: string };

      await db('contract_lines')
        .where({
          contract_line_id: contractLineId,
          tenant
        })
        .update({
          ...lineUpdates,
          updated_at: db.fn.now(),
        });

      const updatedContractLine = await this.get(contractLineId, tenantId);

      if (!updatedContractLine) {
        throw new Error(`Contract Line ${contractLineId} not found or belongs to different tenant`);
      }

      return updatedContractLine;
    } catch (error) {
      console.error(`Error updating contract line ${contractLineId}:`, error);
      throw error;
    }
  }

  static async getByClientId(
    clientId: string,
    includeContractPlans: boolean = true,
    tenantId?: string,
    clientContractId?: string,
  ): Promise<IClientContractLine[]> {
    const { knex: db, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for fetching client contract lines');
    }

    try {
      const query = this.buildClientContractLineBaseQuery(db, tenant)
        .where({
          'cc.client_id': clientId,
          'cc.is_active': true,
          'c.owner_client_id': clientId,
        })
        .select(this.contractLineSelectColumns(db))
        .orderBy('cc.start_date', 'desc');

      if (clientContractId) {
        query.andWhere('cc.client_contract_id', clientContractId);
      }

      if (!includeContractPlans) {
        query.where('cl.is_active', true);
      }

      return query as unknown as IClientContractLine[];
    } catch (error) {
      console.error(`Error fetching contract lines for client ${clientId}:`, error);
      throw error;
    }
  }

  static async get(contractLineId: string, tenantId?: string): Promise<IClientContractLine | undefined> {
    const { knex: db, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for fetching contract line');
    }

    const identity = this.parseClientContractLineIdentity(contractLineId);
    const query = this.buildClientContractLineBaseQuery(db, tenant)
      .where({
        'cl.contract_line_id': identity.contractLineId,
      })
      .select(this.contractLineSelectColumns(db));
    if (identity.clientContractId) {
      query.andWhere('cc.client_contract_id', identity.clientContractId);
    }
    const line = await query.first();

    return line as IClientContractLine | undefined;
  }

  static async delete(contractLineId: string, tenantId?: string): Promise<void> {
    const { knex: db, tenant } = await createTenantKnex(tenantId);
    if (!tenant) {
      throw new Error('Tenant context is required for deleting contract line');
    }

    await db('contract_lines')
      .where({
        contract_line_id: contractLineId,
        tenant
      })
      .update({
        is_active: false,
        updated_at: db.fn.now(),
      });
  }

  static async checkExistingTransactions(
    contractLineId: string,
    tenantId?: string
  ): Promise<ITransaction[]> {
    const { knex: db, tenant } = await createTenantKnex(tenantId);
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
