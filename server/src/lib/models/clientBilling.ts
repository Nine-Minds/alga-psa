import { ICompanyBillingPlan, ITransaction } from '../../interfaces/billing.interfaces';
import { createTenantKnex } from 'server/src/lib/db';
import { Knex } from 'knex';

class CompanyBillingPlan {
    static async checkOverlappingBilling(
        companyId: string,
        serviceCategory: string,
        startDate: Date,
        endDate: Date | null,
        excludeBillingPlanId?: string,
        excludeBundleId?: string
    ): Promise<ICompanyBillingPlan[]> {
        const { knex: db, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('Tenant context is required for checking overlapping billing plans');
        }
        
        // Check for direct billing plans that overlap
        const query = db('company_billing_plans')
            .where({
                company_id: companyId,
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
            query.whereNot('company_billing_plan_id', excludeBillingPlanId);
        }

        // If we're excluding a specific bundle, don't consider plans from that bundle
        if (excludeBundleId) {
            query.where(function() {
                this.whereNot('company_bundle_id', excludeBundleId)
                    .orWhereNull('company_bundle_id');
            });
        }

        // Get direct overlapping plans
        const directOverlappingPlans = await query;

        // Check for plans from bundles that overlap
        const bundlePlansQuery = db('company_plan_bundles as cpb')
            .join('bundle_billing_plans as bbp', function() {
                this.on('cpb.bundle_id', '=', 'bbp.bundle_id')
                    .andOn('bbp.tenant', '=', 'cpb.tenant');
            })
            .join('billing_plans as bp', function() {
                this.on('bbp.plan_id', '=', 'bp.plan_id')
                    .andOn('bp.tenant', '=', 'bbp.tenant');
            })
            .where({
                'cpb.company_id': companyId,
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
                'cpb.company_bundle_id',
                'bbp.custom_rate'
            );

        // Convert bundle plans to company billing plan format for consistent return
        const formattedBundlePlans = bundleOverlappingPlans.map((plan: any) => ({
            company_billing_plan_id: `bundle-${plan.company_bundle_id}-${plan.plan_id}`,
            company_id: companyId,
            plan_id: plan.plan_id,
            service_category: plan.service_category,
            start_date: plan.start_date,
            end_date: plan.end_date,
            is_active: true,
            custom_rate: plan.custom_rate,
            company_bundle_id: plan.company_bundle_id,
            plan_name: plan.plan_name,
            tenant
        }));

        return [...directOverlappingPlans, ...formattedBundlePlans];
    }

    static async create(billingData: Omit<ICompanyBillingPlan, 'company_billing_plan_id'>): Promise<ICompanyBillingPlan> {
        const { knex: db, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('Tenant context is required for creating billing plan');
        }

        try {
            // Remove any tenant from input data to prevent conflicts
            const { tenant: _, ...dataToInsert } = billingData;

            const [createdBillingPlan] = await db('company_billing_plans')
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

    static async update(billingPlanId: string, billingData: Partial<ICompanyBillingPlan>): Promise<ICompanyBillingPlan> {
        const { knex: db, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('Tenant context is required for updating billing plan');
        }

        try {
            // Remove tenant from update data to prevent modification
            const { tenant: _, ...dataToUpdate } = billingData;

            const [updatedBillingPlan] = await db('company_billing_plans')
                .where({
                    company_billing_plan_id: billingPlanId,
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

    static async getByCompanyId(companyId: string, includeBundlePlans: boolean = true): Promise<ICompanyBillingPlan[]> {
        const { knex: db, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('Tenant context is required for fetching company billing plans');
        }

        try {
            // Get directly assigned billing plans
            const directPlans = await db('company_billing_plans')
                .join('billing_plans', function() {
                    this.on('company_billing_plans.plan_id', '=', 'billing_plans.plan_id')
                        .andOn('billing_plans.tenant', '=', 'company_billing_plans.tenant');
                })
                .where({
                    'company_billing_plans.company_id': companyId,
                    'company_billing_plans.tenant': tenant
                })
                .select(
                    'company_billing_plans.*',
                    'billing_plans.plan_name',
                    'billing_plans.billing_frequency'
                );

            // If we don't need bundle plans, return just the direct plans
            if (!includeBundlePlans) {
                console.log(`Retrieved ${directPlans.length} direct billing plans for company ${companyId}`);
                return directPlans;
            }

            // Get plans from bundles
            const bundlePlans = await db('company_plan_bundles as cpb')
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
                    'cpb.company_id': companyId,
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
                    'cpb.company_bundle_id',
                    'pb.bundle_name'
                );

            // Convert bundle plans to company billing plan format
            const formattedBundlePlans = bundlePlans.map((plan: any) => ({
                company_billing_plan_id: `bundle-${plan.company_bundle_id}-${plan.plan_id}`,
                company_id: companyId,
                plan_id: plan.plan_id,
                service_category: plan.service_category,
                start_date: plan.start_date,
                end_date: plan.end_date,
                is_active: true,
                custom_rate: plan.custom_rate,
                company_bundle_id: plan.company_bundle_id,
                plan_name: plan.plan_name,
                billing_frequency: plan.billing_frequency,
                bundle_name: plan.bundle_name,
                tenant
            }));

            // Combine direct plans and bundle plans
            const allPlans = [...directPlans, ...formattedBundlePlans];
            console.log(`Retrieved ${directPlans.length} direct plans and ${formattedBundlePlans.length} bundle plans for company ${companyId}`);
            return allPlans;
        } catch (error) {
            console.error(`Error fetching billing plans for company ${companyId}:`, error);
            throw error;
        }
    }

    static async getById(billingPlanId: string): Promise<ICompanyBillingPlan | null> {
        const { knex: db, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('Tenant context is required for fetching billing plan');
        }

        try {
            const [billingPlan] = await db('company_billing_plans')
                .where({
                    company_billing_plan_id: billingPlanId,
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

    static async updateCompanyCredit(companyId: string, amount: number): Promise<void> {
        const { knex: db, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('Tenant context is required for updating company credit');
        }

        try {
            const updatedRows = await db('companies')
                .where({ company_id: companyId, tenant })
                .increment('credit_balance', amount);

            if (updatedRows === 0) {
                throw new Error(`Company ${companyId} not found or belongs to different tenant`);
            }

            console.log(`Updated credit balance for company ${companyId} by ${amount}`);
        } catch (error) {
            console.error(`Error updating credit for company ${companyId}:`, error);
            throw error;
        }
    }

    static async getCompanyCredit(companyId: string): Promise<number> {
        const { knex: db, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('Tenant context is required for getting company credit');
        }

        try {
            const result = await db('companies')
                .where({ company_id: companyId, tenant })
                .select('credit_balance')
                .first();

            if (!result) {
                console.log(`No credit balance found for company ${companyId} in tenant ${tenant}`);
                return 0;
            }

            console.log(`Retrieved credit balance for company ${companyId}: ${result.credit_balance ?? 0}`);
            return result.credit_balance ?? 0;
        } catch (error) {
            console.error(`Error getting credit balance for company ${companyId}:`, error);
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
     * Get all active bundles for a company with their associated plans
     */
    static async getCompanyBundles(companyId: string): Promise<any[]> {
        const { knex: db, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('Tenant context is required for fetching company bundles');
        }

        try {
            // Get all active bundles for the company
            const bundles = await db('company_plan_bundles as cpb')
                .join('plan_bundles as pb', function() {
                    this.on('cpb.bundle_id', '=', 'pb.bundle_id')
                        .andOn('pb.tenant', '=', 'cpb.tenant');
                })
                .where({
                    'cpb.company_id': companyId,
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
            console.error(`Error fetching bundles for company ${companyId}:`, error);
            throw error;
        }
    }
}

export default CompanyBillingPlan;
