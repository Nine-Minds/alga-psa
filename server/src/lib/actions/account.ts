'use server';

import { createTenantKnex } from '../db';
import { getServerSession } from 'next-auth';
import { options as authOptions } from '../../app/api/auth/[...nextauth]/options';
import { Knex } from 'knex';

export interface CompanyProfile {
  name: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
}

export interface BillingCycle {
  id: string;
  period: string;
  startDate: string;
  endDate: string;
  status: 'active' | 'upcoming' | 'ended';
}

export interface Invoice {
  id: string;
  number: string;
  date: string;
  amount: number;
  status: 'paid' | 'pending' | 'overdue';
}

export interface PaymentMethod {
  id: string;
  type: 'credit_card' | 'bank_account';
  last4: string;
  expMonth?: string;
  expYear?: string;
  isDefault: boolean;
}

export interface Service {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'pending' | 'ended';
  startDate: string;
  nextBillingDate: string;
  rate?: {
    amount: string;
    isCustom: boolean;
    displayAmount: string;
  };
  quantity?: {
    amount: string;
    unit: string;
    display: string;
  };
  bucket?: {
    totalHours: string;
    overageRate: string;
    periodStart: string;
    periodEnd: string;
    display: string;
  };
  billing: {
    type: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket';
    frequency: string;
    isCustom: boolean;
    description?: string;
    display: string;
  };
  serviceType: string;
  displayStatus: string;
  canManage: boolean;
}

const formatDate = (date: string | null) => {
  if (!date) return '';
  try {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch (e) {
    return '';
  }
};

const determineBillingPeriod = (startDate: string, endDate: string | null): string => {
  if (!endDate) return 'Ongoing';
  
  try {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffMonths = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth();
    
    if (diffMonths === 1) return 'Monthly';
    if (diffMonths === 3) return 'Quarterly';
    if (diffMonths === 12) return 'Yearly';
    return `${diffMonths} Month${diffMonths !== 1 ? 's' : ''}`;
  } catch (e) {
    return 'Unknown';
  }
};

const determineBillingStatus = (startDate: string, endDate: string | null): BillingCycle['status'] => {
  try {
    const now = new Date();
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : null;

    if (end && end < now) return 'ended';
    if (start > now) return 'upcoming';
    return 'active';
  } catch (e) {
    return 'ended';
  }
};

const determineServiceStatus = (startDate: string, endDate: string | null): Service['status'] => {
  try {
    const now = new Date();
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : null;

    if (end && end < now) return 'ended';
    if (start > now) return 'pending';
    return 'active';
  } catch (e) {
    return 'ended';
  }
};

export async function getCompanyProfile(): Promise<CompanyProfile> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Not authenticated');
  
  const { knex } = await createTenantKnex();
  
  if (session.user.user_type === 'client') {
    if (!session.user.contactId) throw new Error('No contact associated with user');
    
    // First get the contact to find the company
    const contact = await knex('contacts')
      .where({ 
        contact_name_id: session.user.contactId,
        tenant: session.user.tenant 
      })
      .first();

    if (!contact?.company_id) throw new Error('No company associated with contact');

    // Then get the company details
    const company = await knex('companies')
      .where({ 
        company_id: contact.company_id,
        tenant: session.user.tenant 
      })
      .first();

    if (!company) throw new Error('Company not found');

    return {
      name: company.company_name,
      email: company.email || '',
      phone: company.phone_no || '',
      address: company.address || '',
      notes: company.notes || ''
    };
  } else {
    // For non-client users, use the original companyId logic
    if (!session.user.companyId) throw new Error('No company associated with user');

    const company = await knex('companies')
      .where({ 
        company_id: session.user.companyId,
        tenant: session.user.tenant 
      })
      .first();

    if (!company) throw new Error('Company not found');

    return {
      name: company.company_name,
      email: company.email || '',
      phone: company.phone_no || '',
      address: company.address || '',
      notes: company.notes || ''
    };
  }
}

export async function updateCompanyProfile(profile: CompanyProfile): Promise<{ success: boolean }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Not authenticated');
  if (!session.user.companyId) throw new Error('No company associated with user');

  const { knex } = await createTenantKnex();
  
  await knex('companies')
    .where({ 
      company_id: session.user.companyId,
      tenant: session.user.tenant
    })
    .update({
      company_name: profile.name,
      email: profile.email,
      phone_no: profile.phone,
      address: profile.address,
      notes: profile.notes,
      updated_at: new Date().toISOString()
    });

  return { success: true };
}

export async function getPaymentMethods(): Promise<PaymentMethod[]> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Not authenticated');
  if (!session.user.companyId) throw new Error('No company associated with user');

  const { knex } = await createTenantKnex();
  
  const methods = await knex('payment_methods')
    .where({ 
      company_id: session.user.companyId,
      tenant: session.user.tenant,
      is_deleted: false
    })
    .orderBy('is_default', 'desc')
    .select('*');

  return methods.map((method): PaymentMethod => ({
    id: method.payment_method_id,
    type: method.type,
    last4: method.last4,
    expMonth: method.exp_month,
    expYear: method.exp_year,
    isDefault: method.is_default
  }));
}

export async function addPaymentMethod(data: {
  type: PaymentMethod['type'];
  token: string;
  setDefault: boolean;
}): Promise<{ success: boolean }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Not authenticated');
  if (!session.user.companyId) throw new Error('No company associated with user');

  const { knex } = await createTenantKnex();

  // Start a transaction
  await knex.transaction(async (trx) => {
    // If this is set as default, unset any existing default
    if (data.setDefault) {
      await trx('payment_methods')
        .where({ 
          company_id: session.user.companyId,
          tenant: session.user.tenant,
          is_deleted: false
        })
        .update({ is_default: false });
    }

    // Process the payment token and get card/bank details
    // This is a placeholder - you would integrate with your payment processor here
    const paymentDetails = await processPaymentToken(data.token);

    // Add the new payment method
    await trx('payment_methods').insert({
      company_id: session.user.companyId,
      tenant: session.user.tenant,
      type: data.type,
      last4: paymentDetails.last4,
      exp_month: paymentDetails.expMonth,
      exp_year: paymentDetails.expYear,
      is_default: data.setDefault,
      created_at: new Date().toISOString()
    });
  });

  return { success: true };
}

export async function removePaymentMethod(id: string): Promise<{ success: boolean }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Not authenticated');
  if (!session.user.companyId) throw new Error('No company associated with user');

  const { knex } = await createTenantKnex();

  await knex('payment_methods')
    .where({ 
      payment_method_id: id,
      company_id: session.user.companyId,
      tenant: session.user.tenant
    })
    .update({ 
      is_deleted: true,
      updated_at: new Date().toISOString()
    });

  return { success: true };
}

export async function setDefaultPaymentMethod(id: string): Promise<{ success: boolean }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Not authenticated');
  if (!session.user.companyId) throw new Error('No company associated with user');

  const { knex } = await createTenantKnex();

  await knex.transaction(async (trx) => {
    // Unset any existing default
    await trx('payment_methods')
      .where({ 
        company_id: session.user.companyId,
        tenant: session.user.tenant,
        is_deleted: false
      })
      .update({ is_default: false });

    // Set the new default
    await trx('payment_methods')
      .where({ 
        payment_method_id: id,
        company_id: session.user.companyId,
        tenant: session.user.tenant,
        is_deleted: false
      })
      .update({ is_default: true });
  });

  return { success: true };
}

// This is a placeholder function - replace with actual payment processor integration
async function processPaymentToken(token: string) {
  // Simulate API call to payment processor
  return new Promise<{
    last4: string;
    expMonth: string;
    expYear: string;
  }>((resolve) => {
    setTimeout(() => {
      resolve({
        last4: '4242',
        expMonth: '12',
        expYear: '2025'
      });
    }, 500);
  });
}

export async function getInvoices(): Promise<Invoice[]> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Not authenticated');
  if (!session.user.companyId) throw new Error('No company associated with user');

  const { knex } = await createTenantKnex();
  
  const invoices = await knex('invoices')
    .where({ 
      company_id: session.user.companyId,
      tenant: session.user.tenant
    })
    .orderBy('created_at', 'desc')
    .limit(10)
    .select('*');

  return invoices.map((invoice: {
    invoice_id: string;
    invoice_number: string;
    created_at: string;
    total_amount: number | null;
    status: string;
    due_date: string;
  }): Invoice => {
    // Determine status based on due date and existing status
    let status: Invoice['status'] = 'pending';
    if (invoice.status === 'paid') {
      status = 'paid';
    } else if (invoice.due_date && new Date(invoice.due_date) < new Date()) {
      status = 'overdue';
    }

    return {
      id: invoice.invoice_id,
      number: invoice.invoice_number,
      date: formatDate(invoice.created_at),
      amount: Number(invoice.total_amount || 0),
      status
    };
  });
}

export async function getBillingCycles(): Promise<BillingCycle[]> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Not authenticated');
  if (!session.user.companyId) throw new Error('No company associated with user');

  const { knex } = await createTenantKnex();
  
  const cycles = await knex('company_billing_plans')
    .where({ 
      company_id: session.user.companyId,
      tenant: session.user.tenant
    })
    .orderBy('start_date', 'desc')
    .limit(12)
    .select('*');

  return cycles.map((cycle: {
    company_billing_plan_id: string;
    start_date: string;
    end_date: string | null;
  }): BillingCycle => ({
    id: cycle.company_billing_plan_id,
    period: determineBillingPeriod(cycle.start_date, cycle.end_date),
    startDate: formatDate(cycle.start_date),
    endDate: formatDate(cycle.end_date),
    status: determineBillingStatus(cycle.start_date, cycle.end_date)
  }));
}

export async function getActiveServices(): Promise<Service[]> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Not authenticated');
  if (!session.user.companyId) throw new Error('No company associated with user');

  const { knex } = await createTenantKnex();
  
  const now = new Date().toISOString();
  
  const services = await knex('company_billing_plans as cbp')
    .join('billing_plans as bp', function(this: Knex.JoinClause) {
      this.on('cbp.plan_id', '=', 'bp.plan_id')
          .andOn('cbp.tenant', '=', 'bp.tenant');
    })
    .join('plan_services as ps', function(this: Knex.JoinClause) {
      this.on('bp.plan_id', '=', 'ps.plan_id')
          .andOn('bp.tenant', '=', 'ps.tenant');
    })
    .join('service_catalog as sc', function(this: Knex.JoinClause) {
      this.on('ps.service_id', '=', 'sc.service_id')
          .andOn('ps.tenant', '=', 'sc.tenant');
    })
    .leftJoin('bucket_plans as bucket', function(this: Knex.JoinClause) {
      this.on('bp.plan_id', '=', 'bucket.plan_id')
          .andOn('bp.tenant', '=', 'bucket.tenant');
    })
    .where({ 
      'cbp.company_id': session.user.companyId,
      'cbp.tenant': session.user.tenant,
      'bp.tenant': session.user.tenant,
      'ps.tenant': session.user.tenant,
      'sc.tenant': session.user.tenant
    })
    .whereIn('bp.plan_type', ['Fixed', 'Hourly', 'Usage', 'Bucket'])
    .andWhere('cbp.start_date', '<=', now)
    .andWhere(function(this: Knex.QueryBuilder) {
      this.where('cbp.end_date', '>', now)
          .orWhereNull('cbp.end_date');
    })
    .select(
      'sc.service_id as id',
      'sc.service_name as name',
      'sc.description',
      'sc.service_type',
      'sc.default_rate',
      'sc.unit_of_measure',
      'ps.custom_rate',
      'ps.quantity',
      'bp.plan_type',
      'bp.is_custom',
      'bp.billing_frequency',
      'bp.description as plan_description',
      'bucket.total_hours',
      'bucket.overage_rate',
      'bucket.billing_period as bucket_period',
      knex.raw("'active' as status"),
      'cbp.start_date',
      'cbp.end_date'
    )
    .groupBy(
      'sc.service_id',
      'sc.service_name',
      'sc.description',
      'sc.service_type',
      'sc.default_rate',
      'sc.unit_of_measure',
      'ps.custom_rate',
      'ps.quantity',
      'bp.plan_type',
      'bp.is_custom',
      'bp.billing_frequency',
      'bp.description',
      'bucket.total_hours',
      'bucket.overage_rate',
      'bucket.billing_period',
      'cbp.start_date',
      'cbp.end_date'
    );

  return services.map((service: {
    id: string;
    name: string;
    description: string;
    status: string;
    service_type: string;
    plan_type: Service['billing']['type'];
    is_custom: boolean;
    billing_frequency: string;
    plan_description: string | null;
    default_rate: number | null;
    custom_rate: number | null;
    quantity: number | null;
    unit_of_measure: string | null;
    total_hours: number | null;
    overage_rate: number | null;
    bucket_period: string | null;
    start_date: string;
    end_date: string | null;
  }): Service => {
    const hasCustomRate = service.custom_rate !== null;
    const rate = hasCustomRate ? service.custom_rate : service.default_rate;
    const isBucketPlan = service.plan_type === 'Bucket';

    // Determine base status
    const status = determineServiceStatus(service.start_date, service.end_date);

    // Format rate display
    const rateDisplay = rate ? 
      `$${(rate / 100).toFixed(2)}${service.billing_frequency ? ` per ${service.billing_frequency.toLowerCase()}` : ''}` : 
      'Contact for pricing';

    // Format quantity display
    const quantityDisplay = service.quantity ?
      `${service.quantity} ${service.unit_of_measure || 'units'}` :
      'N/A';

    // Format bucket display
    const bucketDisplay = service.total_hours ?
      `${service.total_hours} hours${service.overage_rate ? ` (+$${(service.overage_rate / 100).toFixed(2)}/hr overage)` : ''}` :
      'N/A';

    // Format billing display
    const billingDisplay = `${service.plan_type}${service.is_custom ? ' (Custom)' : ''} - ${service.billing_frequency || 'Contact for details'}`;

    return {
      id: service.id,
      name: service.name,
      description: service.description || '',
      status,
      startDate: formatDate(service.start_date),
      nextBillingDate: formatDate(service.end_date),
      rate: rate ? {
        amount: rate.toString(),
        isCustom: hasCustomRate,
        displayAmount: rateDisplay
      } : undefined,
      quantity: service.quantity ? {
        amount: service.quantity.toString(),
        unit: service.unit_of_measure || 'units',
        display: quantityDisplay
      } : undefined,
      bucket: isBucketPlan && service.total_hours ? {
        totalHours: service.total_hours.toString(),
        overageRate: service.overage_rate ? 
          `$${(service.overage_rate / 100).toFixed(2)}` : 
          'N/A',
        periodStart: formatDate(service.start_date),
        periodEnd: formatDate(service.end_date),
        display: bucketDisplay
      } : undefined,
      billing: {
        type: service.plan_type,
        frequency: service.billing_frequency,
        isCustom: service.is_custom,
        description: service.plan_description || undefined,
        display: billingDisplay
      },
      serviceType: service.service_type,
      displayStatus: `${status} - ${service.plan_type}${service.is_custom ? ' Custom' : ''}`,
      canManage: status === 'active' // Only allow management of active services
    };
  });
}

export interface ServiceUpgrade {
  id: string;
  name: string;
  description: string;
  features: string[];
  rate: {
    amount: string;
    displayAmount: string;
  };
}

export interface ServicePlan {
  id: string;
  name: string;
  description: string;
  rate: {
    amount: string;
    displayAmount: string;
  };
  isCurrentPlan: boolean;
}

export async function getServiceUpgrades(serviceId: string): Promise<ServicePlan[]> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Not authenticated');
  if (!session.user.companyId) throw new Error('No company associated with user');

  const { knex } = await createTenantKnex();
  
  // Get current service details
  const currentService = await knex('company_billing_plans as cbp')
    .join('billing_plans as bp', function(this: Knex.JoinClause) {
      this.on('cbp.plan_id', '=', 'bp.plan_id')
          .andOn('cbp.tenant', '=', 'bp.tenant');
    })
    .join('plan_services as ps', function(this: Knex.JoinClause) {
      this.on('bp.plan_id', '=', 'ps.plan_id')
          .andOn('bp.tenant', '=', 'ps.tenant');
    })
    .where({ 
      'ps.service_id': serviceId,
      'cbp.company_id': session.user.companyId,
      'cbp.tenant': session.user.tenant
    })
    .first();

  if (!currentService) throw new Error('Service not found');

  // Get available plans for this service
  const plans = await knex('billing_plans as bp')
    .join('plan_services as ps', function(this: Knex.JoinClause) {
      this.on('bp.plan_id', '=', 'ps.plan_id')
          .andOn('bp.tenant', '=', 'ps.tenant');
    })
    .join('service_catalog as sc', function(this: Knex.JoinClause) {
      this.on('ps.service_id', '=', 'sc.service_id')
          .andOn('ps.tenant', '=', 'sc.tenant');
    })
    .where({ 
      'ps.service_id': serviceId,
      'bp.tenant': session.user.tenant,
      'bp.is_active': true
    })
    .select(
      'bp.plan_id as id',
      'bp.plan_name as name',
      'bp.description',
      'sc.default_rate'
    );

  return plans.map((plan): ServicePlan => ({
    id: plan.id,
    name: plan.name,
    description: plan.description || '',
    rate: {
      amount: plan.default_rate.toString(),
      displayAmount: `$${(plan.default_rate / 100).toFixed(2)}/mo`
    },
    isCurrentPlan: plan.id === currentService.plan_id
  }));
}

export async function upgradeService(serviceId: string, planId: string): Promise<{ success: boolean }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Not authenticated');
  if (!session.user.companyId) throw new Error('No company associated with user');

  const { knex } = await createTenantKnex();

  // Start a transaction
  await knex.transaction(async (trx) => {
    // Get current service plan
    const currentPlan = await trx('company_billing_plans as cbp')
      .join('plan_services as ps', function(this: Knex.JoinClause) {
        this.on('cbp.plan_id', '=', 'ps.plan_id')
            .andOn('cbp.tenant', '=', 'ps.tenant');
      })
      .where({ 
        'ps.service_id': serviceId,
        'cbp.company_id': session.user.companyId,
        'cbp.tenant': session.user.tenant
      })
      .whereNull('cbp.end_date')
      .first();

    if (!currentPlan) throw new Error('No active plan found for this service');

    const now = new Date();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    // End current plan at the end of the billing cycle
    await trx('company_billing_plans')
      .where({ 
        company_billing_plan_id: currentPlan.company_billing_plan_id,
        tenant: session.user.tenant
      })
      .update({ 
        end_date: endOfMonth.toISOString(),
        updated_at: now.toISOString()
      });

    // Start new plan from the beginning of next month
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    await trx('company_billing_plans').insert({
      company_id: session.user.companyId,
      plan_id: planId,
      tenant: session.user.tenant,
      start_date: startOfNextMonth.toISOString(),
      created_at: now.toISOString()
    });
  });

  return { success: true };
}

export async function downgradeService(serviceId: string, planId: string): Promise<{ success: boolean }> {
  // Downgrade follows the same logic as upgrade
  return upgradeService(serviceId, planId);
}
