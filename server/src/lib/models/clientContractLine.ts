import { IClientContractLine, ITransaction } from '../../interfaces/billing.interfaces';
import { createTenantKnex } from 'server/src/lib/db';
import { Knex } from 'knex';

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
        
        // Check for direct contract lines that overlap
        const query = db('client_contract_lines')
            .where({
                client_id: clientId,
                service_category: serviceCategory,
                tenant
            })
            .where(function (this: Knex.QueryBuilder) {
                this.where(function (this: Knex.QueryBuilder) {
                    this.where('start_date', '<=', startDate)
                        .where(function (this: Knex.QueryBuilder) {
                            this.where('end_date', '>=', startDate).orWhereNull('end_date');
                        });
                }).orWhere(function () {
                    this.where('start_date', '>=', startDate)
                        .where('start_date', '<=', endDate || db.raw('CURRENT_DATE'));
                });
            });

        if (excludeContractLineId) {
            query.whereNot('client_contract_line_id', excludeContractLineId);
        }

        // If we're excluding a specific contract, don't consider plans from that contract
        if (excludeContractId) {
            query.where(function() {
                this.whereNot('client_contract_id', excludeContractId)
                    .orWhereNull('client_contract_id');
            });
        }

        // Get direct overlapping plans
        const directOverlappingPlans = await query;

        // Check for plans from contracts that overlap
        const contractAssociationQuery = db('client_contracts as cc')
            .join('contract_line_mappings as clm', function() {
                this.on('cc.contract_id', '=', 'clm.contract_id')
                    .andOn('clm.tenant', '=', 'cc.tenant');
            })
            .join('contract_lines as cl', function() {
                this.on('clm.contract_line_id', '=', 'cl.contract_line_id')
                    .andOn('cl.tenant', '=', 'clm.tenant');
            })
            .where({
                'cc.client_id': clientId,
                'cc.is_active': true,
                'cc.tenant': tenant,
                'cl.service_category': serviceCategory
            })
            .where(function (this: Knex.QueryBuilder) {
                this.where(function (this: Knex.QueryBuilder) {
                    this.where('cc.start_date', '<=', startDate)
                        .where(function (this: Knex.QueryBuilder) {
                            this.where('cc.end_date', '>=', startDate).orWhereNull('cc.end_date');
                        });
                }).orWhere(function () {
                    this.where('cc.start_date', '>=', startDate)
                        .where('cc.start_date', '<=', endDate || db.raw('CURRENT_DATE'));
                });
            });

        if (excludeContractId) {
            contractAssociationQuery.whereNot('cc.contract_id', excludeContractId);
        }

        const contractAssociationResults = await contractAssociationQuery
            .select(
                'clm.contract_line_id',
                'cl.contract_line_name',
                'cl.service_category',
                'cc.start_date',
                'cc.end_date',
                'cc.client_contract_id',
                'clm.custom_rate'
            );

        // Convert contract plans to client contract line format for consistent return
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
            // Remove any tenant from input data to prevent conflicts
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
            // Remove tenant from update data to prevent modification
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
            // Get directly assigned contract lines
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

            // If we don't need contract plans, return just the direct plans
            if (!includeContractPlans) {
                console.log(`Retrieved ${directPlans.length} direct contract lines for client ${clientId}`);
                return directPlans;
            }

            // Get plans from contracts
            const contractPlans = await db('client_contracts as cc')
                .join('contract_line_mappings as clm', function() {
                    this.on('cc.contract_id', '=', 'clm.contract_id')
                        .andOn('clm.tenant', '=', 'cc.tenant');
                })
                .join('contract_lines as cl', function() {
                    this.on('clm.contract_line_id', '=', 'cl.contract_line_id')
                        .andOn('cl.tenant', '=', 'clm.tenant');
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
                    'clm.contract_line_id',
                    'cl.contract_line_name',
                    'cl.billing_frequency',
                    'cl.service_category',
                    'clm.custom_rate',
                    'cc.start_date',
                    'cc.end_date',
                    'cc.client_contract_id',
                    'c.contract_name'
                );

            // Convert contract plans to client contract line format
            const formattedContractAssociations = contractPlans.map((plan: any) => ({
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
                contract_name: plan.contract_name,
                tenant
            }));

            // Combine direct plans and contract plans
            const allPlans = [...directPlans, ...formattedContractAssociations];
            console.log(`Retrieved ${directPlans.length} direct plans and ${formattedContractAssociations.length} contract plans for client ${clientId}`);
            return allPlans;
        } catch (error) {
            console.error(`Error fetching contract lines for client ${clientId}:`, error);
            throw error;
        }
    }

    static async getById(contractLineId: string): Promise<IClientContractLine | null> {
        const { knex: db, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('Tenant context is required for fetching contract line');
        }

        try {
            const [contractLine] = await db('client_contract_lines')
                .where({
                    client_contract_line_id: contractLineId,
                    tenant
                })
                .select('*');

            if (!contractLine) {
                console.log(`No contract line found with ID ${contractLineId} for tenant ${tenant}`);
                return null;
            }

            return contractLine;
        } catch (error) {
            console.error(`Error fetching contract line ${contractLineId}:`, error);
            throw error;
        }
    }

    static async updateClientCredit(clientId: string, amount: number): Promise<void> {
        const { knex: db, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('Tenant context is required for updating client credit');
        }

        try {
            const updatedRows = await db('clients')
                .where({ client_id: clientId, tenant })
                .increment('credit_balance', amount);

            if (updatedRows === 0) {
                throw new Error(`Client ${clientId} not found or belongs to different tenant`);
            }

            console.log(`Updated credit balance for client ${clientId} by ${amount}`);
        } catch (error) {
            console.error(`Error updating credit for client ${clientId}:`, error);
            throw error;
        }
    }

    static async getClientCredit(clientId: string): Promise<number> {
        const { knex: db, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('Tenant context is required for getting client credit');
        }

        try {
            const result = await db('clients')
                .where({ client_id: clientId, tenant })
                .select('credit_balance')
                .first();

            if (!result) {
                console.log(`No credit balance found for client ${clientId} in tenant ${tenant}`);
                return 0;
            }

            console.log(`Retrieved credit balance for client ${clientId}: ${result.credit_balance ?? 0}`);
            return result.credit_balance ?? 0;
        } catch (error) {
            console.error(`Error getting credit balance for client ${clientId}:`, error);
            throw error;
        }
    }

    static async createTransaction(transaction: Omit<ITransaction, 'transaction_id' | 'created_at'>, trx?: Knex.Transaction): Promise<ITransaction> {
        const { knex: db, tenant } = await createTenantKnex();
        
        if (!tenant) {
            throw new Error('Tenant context is required for creating transaction');
        }

        const dbInstance = trx || db; // Use the provided transaction or the default connection
        const { tenant: _, ...dataToInsert } = transaction;
        
        const [createdTransaction] = await dbInstance('transactions')
            .insert({
                ...dataToInsert,
                tenant,
                created_at: new Date().toISOString()
            })
            .returning('*');
            
        return createdTransaction;
    }

    /**
     * Get all active contracts for a client with their associated contract lines
     */
    static async getClientContracts(clientId: string): Promise<any[]> {
        const { knex: db, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('Tenant context is required for fetching client contracts');
        }

        try {
            // Get all active contracts for the client
            const contracts = await db('client_contracts as cc')
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
                    'cc.*',
                    'c.contract_name',
                    'c.description'
                );

            // For each contract, get its associated contract lines
            const contractsWithContractLines = await Promise.all(contracts.map(async (contract) => {
                const contract_lines = await db('contract_line_mappings as clm')
                    .join('contract_lines as cl', function() {
                        this.on('clm.contract_line_id', '=', 'cl.contract_line_id')
                            .andOn('cl.tenant', '=', 'clm.tenant');
                    })
                    .where({
                        'clm.contract_id': contract.contract_id,
                        'clm.tenant': tenant
                    })
                    .select(
                        'clm.*',
                        'cl.contract_line_name',
                        'cl.billing_frequency',
                        'cl.service_category',
                        'cl.contract_line_type'
                    );

                return {
                    ...contract,
                    contract_lines
                };
            }));

            return contractsWithContractLines;
        } catch (error) {
            console.error(`Error fetching contracts for client ${clientId}:`, error);
            throw error;
        }
    }
}

export default ClientContractLine;
