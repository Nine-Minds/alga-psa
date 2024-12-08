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
        const { knex: db } = await createTenantKnex();
        const query = db('company_billing_plans')
            .where('company_id', companyId)
            .where('service_category', serviceCategory)
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
        const { knex: db } = await createTenantKnex();
        const [createdBillingPlan] = await db('company_billing_plans').insert(billingData).returning('*');
        return createdBillingPlan;
    }

    static async update(billingPlanId: string, billingData: Partial<ICompanyBillingPlan>): Promise<ICompanyBillingPlan> {
        const { knex: db } = await createTenantKnex();
        const [updatedBillingPlan] = await db('company_billing_plans')
            .where('company_billing_plan_id', billingPlanId)
            .update(billingData)
            .returning('*');
        return updatedBillingPlan;
    }

    static async getByCompanyId(companyId: string): Promise<ICompanyBillingPlan[]> {
        const { knex: db } = await createTenantKnex();
        return db('company_billing_plans').where('company_id', companyId);
    }

    static async getById(billingPlanId: string): Promise<ICompanyBillingPlan | null> {
        const { knex: db } = await createTenantKnex();
        const [billingPlan] = await db('company_billing_plans').where('company_billing_plan_id', billingPlanId);
        return billingPlan || null;
    }

    static async updateCompanyCredit(companyId: string, amount: number): Promise<void> {
        const { knex: db } = await createTenantKnex();
        await db('companies')
            .where('company_id', companyId)
            .increment('credit_balance', amount);
    }

    static async getCompanyCredit(companyId: string): Promise<number> {
        const { knex: db } = await createTenantKnex();
        const result = await db('companies')
            .where('company_id', companyId)
            .select('credit_balance')
            .first();
        console.log('result', result);
        return result?.credit_balance ?? 0;
    }

    static async createTransaction(transaction: Omit<ITransaction, 'transaction_id' | 'created_at'>, trx?: Knex.Transaction): Promise<ITransaction> {
        const { knex: db, tenant } = await createTenantKnex();
        const dbInstance = trx || db; // Use the provided transaction or the default connection
        const [createdTransaction] = await dbInstance('transactions').insert({
            ...transaction,
            tenant,
            created_at: new Date().toISOString()
        }).returning('*');
        return createdTransaction;
    }
}

export default CompanyBillingPlan;
