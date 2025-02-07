'use server';

import { getServerSession } from 'next-auth';
import { options } from '@/app/api/auth/[...nextauth]/options';
import { getConnection } from '@/lib/db/db';
import { 
  ICompanyBillingPlan, 
  IBillingResult, 
  IBucketUsage,
  IService,
  PaymentMethod
} from '@/interfaces/billing.interfaces';

export async function getClientBillingPlan(): Promise<ICompanyBillingPlan | null> {
  const session = await getServerSession(options);
  
  if (!session?.user?.tenant || !session.user.companyId) {
    throw new Error('Unauthorized');
  }

  const knex = await getConnection(session.user.tenant);
  
  try {
    const plan = await knex('company_billing_plans')
      .select(
        'company_billing_plans.*',
        'billing_plans.plan_name',
        'billing_plans.billing_frequency'
      )
      .join('billing_plans', function() {
        this.on('company_billing_plans.plan_id', '=', 'billing_plans.plan_id')
          .andOn('billing_plans.tenant', '=', 'company_billing_plans.tenant')
      })
      .where({
        'company_billing_plans.company_id': session.user.companyId,
        'company_billing_plans.is_active': true,
        'company_billing_plans.tenant': session.user.tenant
      })
      .first();

    return plan || null;
  } catch (error) {
    console.error('Error fetching client billing plan:', error);
    throw new Error('Failed to fetch billing plan');
  }
}

export async function getClientInvoices() {
  const session = await getServerSession(options);
  
  if (!session?.user?.tenant || !session.user.companyId) {
    throw new Error('Unauthorized');
  }

  const knex = await getConnection(session.user.tenant);
  
  try {
    const invoices = await knex('invoices')
      .select(
        'invoice_id as id',
        'invoice_number',
        'invoice_date as created_at',
        'total_amount',
        'status'
      )
      .where({
        company_id: session.user.companyId,
        tenant: session.user.tenant
      })
      .orderBy('invoice_date', 'desc');

    return invoices;
  } catch (error) {
    console.error('Error fetching client invoices:', error);
    throw new Error('Failed to fetch invoices');
  }
}

export async function getClientPaymentMethods(): Promise<PaymentMethod[]> {
  const session = await getServerSession(options);
  
  if (!session?.user?.tenant || !session.user.companyId) {
    throw new Error('Unauthorized');
  }

  const knex = await getConnection(session.user.tenant);
  
  try {
    const paymentMethods = await knex('payment_methods')
      .select('*')
      .where({
        company_id: session.user.companyId,
        is_deleted: false,
        tenant: session.user.tenant
      })
      .orderBy('created_at', 'desc');

    return paymentMethods;
  } catch (error) {
    console.error('Error fetching payment methods:', error);
    throw new Error('Failed to fetch payment methods');
  }
}

export async function getCurrentUsage(): Promise<{
  bucketUsage: IBucketUsage | null;
  services: IService[];
}> {
  const session = await getServerSession(options);
  
  if (!session?.user?.tenant || !session.user.companyId) {
    throw new Error('Unauthorized');
  }

  const knex = await getConnection(session.user.tenant);
  
  try {
    // Get current bucket usage if any
    const bucketUsage = await knex('bucket_usage')
      .select('*')
      .where({
        company_id: session.user.companyId,
        tenant: session.user.tenant
      })
      .whereRaw('? BETWEEN period_start AND period_end', [new Date()])
      .first();

    // Get all services associated with the company's plan
    const services = await knex('service_catalog')
      .select('service_catalog.*')
      .join('plan_services', function() {
        this.on('service_catalog.service_id', '=', 'plan_services.service_id')
          .andOn('service_catalog.tenant', '=', 'plan_services.tenant')
      })
      .join('company_billing_plans', function() {
        this.on('plan_services.plan_id', '=', 'company_billing_plans.plan_id')
          .andOn('plan_services.tenant', '=', 'company_billing_plans.tenant')
      })
      .where({
        'company_billing_plans.company_id': session.user.companyId,
        'company_billing_plans.is_active': true,
        'service_catalog.tenant': session.user.tenant,
        'plan_services.tenant': session.user.tenant,
        'company_billing_plans.tenant': session.user.tenant
      });

    return {
      bucketUsage,
      services
    };
  } catch (error) {
    console.error('Error fetching current usage:', error);
    throw new Error('Failed to fetch current usage');
  }
}
