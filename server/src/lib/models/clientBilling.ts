import { IClientBillingPlan, ITransaction } from '../../interfaces/billing.interfaces';
import { createTenantKnex } from 'server/src/lib/db';
import { Knex } from 'knex';

class ClientBillingPlan {
    static async checkOverlappingBilling(
        clientId: string,
        serviceCategory: string,
        startDate: Date,
        endDate: Date | null,
        excludeBillingPlanId?: string,
        excludeBundleId?: string
    ): Promise<IClientBillingPlan[]> {
        const { knex: db, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('Tenant context is required for checking overlapping billing plans');
        }
        
        // Check for direct billing plans that overlap
        const query = db('client_billing_plans')
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

        if (excludeBillingPlanId) {
            query.whereNot('client_billing_plan_id', excludeBillingPlanId);
        }

        // If we're excluding a specific bundle, don't consider plans from that bundle
        if (excludeBundleId) {
            query.where(function() {
                this.whereNot('client_bundle_id', excludeBundleId)
                    .orWhereNull('client_bundle_id');
            });
        }

        // Get direct overlapping plans
        const directOverlappingPlans = await query;

        // Check for plans from bundles that overlap
        const bundlePlansQuery = db('client_plan_bundles as cpb')
            .join('bundle_billing_plans as bbp', function() {
                this.on('cpb.bundle_id', '=', 'bbp.bundle_id')
                    .andOn('bbp.tenant', '=', 'cpb.tenant');
            })
            .join('billing_plans as bp', function() {
                this.on('bbp.plan_id', '=', 'bp.plan_id')
                    .andOn('bp.tenant', '=', 'bbp.tenant');
            })
            .where({
                'cpb.client_id': clientId,
                'cpb.is_active': true,
                'cpb.tenant': tenant,
                'bp.service_category': serviceCategory
            })
            .where(function (this: Knex.QueryBuilder) {
                this.where(function (this: Knex.QueryBuilder) {
                    this.where('cpb.start_date', '<=', startDate)
                        .where(function (this: Knex.QueryBuilder) {
                            this.where('cpb.end_date', '>=', startDate).orWhereNull('cpb.end_date');
                        });
                }).orWhere(function () {
                    this.where('cpb.start_date', '>=', startDate)
                        .where('cpb.start_date', '<=', endDate || db.raw('CURRENT_DATE'));
                });
            });

        if (excludeBundleId) {
            bundlePlansQuery.whereNot('cpb.bundle_id', excludeBundleId);
        }

        const bundleOverlappingPlans = await bundlePlansQuery
            .select(
                'bbp.plan_id',
                'bp.plan_name',
                'bp.service_category',
                'cpb.start_date',
                'cpb.end_date',
                'cpb.client_bundle_id',
                'bbp.custom_rate'
            );

        // Convert bundle plans to client billing plan format for consistent return
        const formattedBundlePlans = bundleOverlappingPlans.map((plan: any) => ({
            client_billing_plan_id: `bundle-${plan.client_bundle_id}-${plan.plan_id}`,
            client_id: clientId,
            plan_id: plan.plan_id,
            service_category: plan.service_category,
            start_date: plan.start_date,
            end_date: plan.end_date,
            is_active: true,
            custom_rate: plan.custom_rate,
            client_bundle_id: plan.client_bundle_id,
            plan_name: plan.plan_name,
            tenant
        }));

        return [...directOverlappingPlans, ...formattedBundlePlans];
    }

    static async create(billingData: Omit<IClientBillingPlan, 'client_billing_plan_id'>): Promise<IClientBillingPlan> {
        const { knex: db, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('Tenant context is required for creating billing plan');
        }

        try {
            // Remove any tenant from input data to prevent conflicts
            const { tenant: _, ...dataToInsert } = billingData;

            const [createdBillingPlan] = await db('client_billing_plans')
                .insert({
                    ...dataToInsert,
                    tenant
                })
                .returning('*');

            if (!createdBillingPlan) {
                throw new Error('Failed to create billing plan - no record returned');
            }

            return createdBillingPlan;
        } catch (error) {
            console.error('Error creating billing plan:', error);
            throw error;
        }
    }

    static async update(billingPlanId: string, billingData: Partial<IClientBillingPlan>): Promise<IClientBillingPlan> {
        const { knex: db, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('Tenant context is required for updating billing plan');
        }

        try {
            // Remove tenant from update data to prevent modification
            const { tenant: _, ...dataToUpdate } = billingData;

            const [updatedBillingPlan] = await db('client_billing_plans')
                .where({
                    client_billing_plan_id: billingPlanId,
                    tenant
                })
                .update({
                    ...dataToUpdate,
                    tenant
                })
                .returning('*');

            if (!updatedBillingPlan) {
                throw new Error(`Billing plan ${billingPlanId} not found or belongs to different tenant`);
            }

            return updatedBillingPlan;
        } catch (error) {
            console.error(`Error updating billing plan ${billingPlanId}:`, error);
            throw error;
        }
    }

    static async getByClientId(clientId: string, includeBundlePlans: boolean = true): Promise<IClientBillingPlan[]> {
        const { knex: db, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('Tenant context is required for fetching client billing plans');
        }

        try {
            // Get directly assigned billing plans
            const directPlans = await db('client_billing_plans')
                .join('billing_plans', function() {
                    this.on('client_billing_plans.plan_id', '=', 'billing_plans.plan_id')
                        .andOn('billing_plans.tenant', '=', 'client_billing_plans.tenant');
                })
                .where({
                    'client_billing_plans.client_id': clientId,
                    'client_billing_plans.tenant': tenant
                })
                .select(
                    'client_billing_plans.*',
                    'billing_plans.plan_name',
                    'billing_plans.billing_frequency'
                );

            // If we don't need bundle plans, return just the direct plans
            if (!includeBundlePlans) {
                console.log(`Retrieved ${directPlans.length} direct billing plans for client ${clientId}`);
                return directPlans;
            }

            // Get plans from bundles
            const bundlePlans = await db('client_plan_bundles as cpb')
                .join('bundle_billing_plans as bbp', function() {
                    this.on('cpb.bundle_id', '=', 'bbp.bundle_id')
                        .andOn('bbp.tenant', '=', 'cpb.tenant');
                })
                .join('billing_plans as bp', function() {
                    this.on('bbp.plan_id', '=', 'bp.plan_id')
                        .andOn('bp.tenant', '=', 'bbp.tenant');
                })
                .join('plan_bundles as pb', function() {
                    this.on('cpb.bundle_id', '=', 'pb.bundle_id')
                        .andOn('pb.tenant', '=', 'cpb.tenant');
                })
                .where({
                    'cpb.client_id': clientId,
                    'cpb.is_active': true,
                    'cpb.tenant': tenant
                })
                .select(
                    'bbp.plan_id',
                    'bp.plan_name',
                    'bp.billing_frequency',
                    'bp.service_category',
                    'bbp.custom_rate',
                    'cpb.start_date',
                    'cpb.end_date',
                    'cpb.client_bundle_id',
                    'pb.bundle_name'
                );

            // Convert bundle plans to client billing plan format
            const formattedBundlePlans = bundlePlans.map((plan: any) => ({
                client_billing_plan_id: `bundle-${plan.client_bundle_id}-${plan.plan_id}`,
                client_id: clientId,
                plan_id: plan.plan_id,
                service_category: plan.service_category,
                start_date: plan.start_date,
                end_date: plan.end_date,
                is_active: true,
                custom_rate: plan.custom_rate,
                client_bundle_id: plan.client_bundle_id,
                plan_name: plan.plan_name,
                billing_frequency: plan.billing_frequency,
                bundle_name: plan.bundle_name,
                tenant
            }));

            // Combine direct plans and bundle plans
            const allPlans = [...directPlans, ...formattedBundlePlans];
            console.log(`Retrieved ${directPlans.length} direct plans and ${formattedBundlePlans.length} bundle plans for client ${clientId}`);
            return allPlans;
        } catch (error) {
            console.error(`Error fetching billing plans for client ${clientId}:`, error);
            throw error;
        }
    }

    static async getById(billingPlanId: string): Promise<IClientBillingPlan | null> {
        const { knex: db, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('Tenant context is required for fetching billing plan');
        }

        try {
            const [billingPlan] = await db('client_billing_plans')
                .where({
                    client_billing_plan_id: billingPlanId,
                    tenant
                })
                .select('*');

            if (!billingPlan) {
                console.log(`No billing plan found with ID ${billingPlanId} for tenant ${tenant}`);
                return null;
            }

            return billingPlan;
        } catch (error) {
            console.error(`Error fetching billing plan ${billingPlanId}:`, error);
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
     * Get all active bundles for a client with their associated plans
     */
    static async getClientBundles(clientId: string): Promise<any[]> {
        const { knex: db, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('Tenant context is required for fetching client bundles');
        }

        try {
            // Get all active bundles for the client
            const bundles = await db('client_plan_bundles as cpb')
                .join('plan_bundles as pb', function() {
                    this.on('cpb.bundle_id', '=', 'pb.bundle_id')
                        .andOn('pb.tenant', '=', 'cpb.tenant');
                })
                .where({
                    'cpb.client_id': clientId,
                    'cpb.is_active': true,
                    'cpb.tenant': tenant
                })
                .select(
                    'cpb.*',
                    'pb.bundle_name',
                    'pb.description'
                );

            // For each bundle, get its associated plans
            const bundlesWithPlans = await Promise.all(bundles.map(async (bundle) => {
                const plans = await db('bundle_billing_plans as bbp')
                    .join('billing_plans as bp', function() {
                        this.on('bbp.plan_id', '=', 'bp.plan_id')
                            .andOn('bp.tenant', '=', 'bbp.tenant');
                    })
                    .where({
                        'bbp.bundle_id': bundle.bundle_id,
                        'bbp.tenant': tenant
                    })
                    .select(
                        'bbp.*',
                        'bp.plan_name',
                        'bp.billing_frequency',
                        'bp.service_category',
                        'bp.plan_type'
                    );

                return {
                    ...bundle,
                    plans
                };
            }));

            return bundlesWithPlans;
        } catch (error) {
            console.error(`Error fetching bundles for client ${clientId}:`, error);
            throw error;
        }
    }
}

export default ClientBillingPlan;
