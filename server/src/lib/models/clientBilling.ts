import { ICompanyBillingPlan, ITransaction } from '../../interfaces/billing.interfaces';
import { createTenantKnex } from '@/lib/db';
import { Knex } from 'knex';

class CompanyBillingPlan {
    static async checkOverlappingBilling(
        companyId: string,
        serviceCategory: string,
        startDate: Date,
        endDate: Date | null,
        excludeBillingPlanId?: string
    ): Promise<ICompanyBillingPlan[]> {
        const { knex: db, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('Tenant context is required for checking overlapping billing plans');
        }
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

        return query;
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

    static async getByCompanyId(companyId: string): Promise<ICompanyBillingPlan[]> {
        const { knex: db, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('Tenant context is required for fetching company billing plans');
        }

        try {
            const plans = await db('company_billing_plans')
                .where({ company_id: companyId, tenant })
                .select('*');

            console.log(`Retrieved ${plans.length} billing plans for company ${companyId}`);
            return plans;
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
}

export default CompanyBillingPlan;
