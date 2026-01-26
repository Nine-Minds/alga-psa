'use server';

import { createTenantKnex } from '@alga-psa/db';
import { Knex } from 'knex';
import { withTransaction } from '@alga-psa/db';
import { getSession } from '@alga-psa/auth';
import { getCurrencySymbol } from '@alga-psa/core';

export interface IClientProfile {
  name: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
}

/** @deprecated Use IClientProfile instead */
export type ClientProfileData = IClientProfile;

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
    type: 'Fixed' | 'Hourly' | 'Usage';
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

export async function getClientProfile(): Promise<IClientProfile> {
  const session = await getSession();
  if (!session?.user) throw new Error('Not authenticated');

  const { knex } = await createTenantKnex(session.user.tenant);
  
  if (session.user.user_type === 'client') {
    if (!session.user.contactId) throw new Error('No contact associated with user');
    
    // First get the contact to find the client
    const contact = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('contacts')
        .where({ 
          contact_name_id: session.user.contactId,
          tenant: session.user.tenant 
        })
        .first();
    });

    if (!contact?.client_id) throw new Error('No client associated with contact');

    // Then get the client details with location
    const client = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('clients as c')
        .leftJoin('client_locations as cl', function() {
          this.on('c.client_id', '=', 'cl.client_id')
              .andOn('c.tenant', '=', 'cl.tenant')
              .andOn('cl.is_default', '=', trx.raw('true'));
        })
        .select(
          'c.*',
          'cl.email as location_email',
          'cl.phone as location_phone',
          'cl.address_line1 as location_address'
        )
        .where({ 
          'c.client_id': contact.client_id,
          'c.tenant': session.user.tenant 
        })
        .first();
    });

    if (!client) throw new Error('Client not found');

    return {
      name: client.client_name,
      email: client.location_email || '',
      phone: client.location_phone || '',
      address: client.location_address || '',
      notes: client.notes || ''
    };
  } else {
    // For non-client users, use the original clientId logic
    if (!session.user.clientId) throw new Error('No client associated with user');

    const client = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('clients as c')
        .leftJoin('client_locations as cl', function() {
          this.on('c.client_id', '=', 'cl.client_id')
              .andOn('c.tenant', '=', 'cl.tenant')
              .andOn('cl.is_default', '=', trx.raw('true'));
        })
        .select(
          'c.*',
          'cl.email as location_email',
          'cl.phone as location_phone',
          'cl.address_line1 as location_address'
        )
        .where({ 
          'c.client_id': session.user.clientId,
          'c.tenant': session.user.tenant 
        })
        .first();
    });

    if (!client) throw new Error('Client not found');

    return {
      name: client.client_name,
      email: client.location_email || '',
      phone: client.location_phone || '',
      address: client.location_address || '',
      notes: client.notes || ''
    };
  }
}

export async function updateClientProfile(profile: IClientProfile): Promise<{ success: boolean }> {
  const session = await getSession();
  if (!session?.user) throw new Error('Not authenticated');
  if (!session.user.clientId) throw new Error('No client associated with user');

  const { knex } = await createTenantKnex(session.user.tenant);
  
  await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('clients')
      .where({ 
        client_id: session.user.clientId,
        tenant: session.user.tenant
      })
      .update({
        client_name: profile.name,
        email: profile.email,
        phone_no: profile.phone,
        address: profile.address,
        notes: profile.notes,
        updated_at: new Date().toISOString()
      });
  });

  return { success: true };
}

export async function getPaymentMethods(): Promise<PaymentMethod[]> {
  const session = await getSession();
  if (!session?.user) throw new Error('Not authenticated');
  if (!session.user.clientId) throw new Error('No client associated with user');

  const { knex } = await createTenantKnex(session.user.tenant);
  
  const methods = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('payment_methods')
      .where({ 
        client_id: session.user.clientId,
        tenant: session.user.tenant,
        is_deleted: false
      })
      .orderBy('is_default', 'desc')
      .select('*');
  });

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
  const session = await getSession();
  if (!session?.user) throw new Error('Not authenticated');
  if (!session.user.clientId) throw new Error('No client associated with user');

  const { knex } = await createTenantKnex(session.user.tenant);

  // Start a transaction
  await withTransaction(knex, async (trx: Knex.Transaction) => {
    // If this is set as default, unset any existing default
    if (data.setDefault) {
      await trx('payment_methods')
        .where({ 
          client_id: session.user.clientId,
          tenant: session.user.tenant,
          is_deleted: false
        })
        .update({ is_default: false });
    }

    // Process the payment token and get card/bank details
    // This is a placeholder - you would integrate with your payment processor here
    const paymentDetails = await processPaymentToken(data.token);

    // Add the new payment method
    return await trx('payment_methods').insert({
      client_id: session.user.clientId,
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
  const session = await getSession();
  if (!session?.user) throw new Error('Not authenticated');
  if (!session.user.clientId) throw new Error('No client associated with user');

  const { knex } = await createTenantKnex(session.user.tenant);

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('payment_methods')
      .where({ 
        payment_method_id: id,
        client_id: session.user.clientId,
        tenant: session.user.tenant
      })
      .update({ 
        is_deleted: true,
        updated_at: new Date().toISOString()
      });
  });

  return { success: true };
}

export async function setDefaultPaymentMethod(id: string): Promise<{ success: boolean }> {
  const session = await getSession();
  if (!session?.user) throw new Error('Not authenticated');
  if (!session.user.clientId) throw new Error('No client associated with user');

  const { knex } = await createTenantKnex(session.user.tenant);

  await withTransaction(knex, async (trx: Knex.Transaction) => {
    // Unset any existing default
    await trx('payment_methods')
      .where({ 
        client_id: session.user.clientId,
        tenant: session.user.tenant,
        is_deleted: false
      })
      .update({ is_default: false });

    // Set the new default
    return await trx('payment_methods')
      .where({ 
        payment_method_id: id,
        client_id: session.user.clientId,
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
  const session = await getSession();
  if (!session?.user) throw new Error('Not authenticated');
  if (!session.user.clientId) throw new Error('No client associated with user');

  const { knex } = await createTenantKnex(session.user.tenant);
  
  const invoices = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('invoices')
      .where({ 
        client_id: session.user.clientId,
        tenant: session.user.tenant
      })
      .orderBy('created_at', 'desc')
      .limit(10)
      .select('*');
  });

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
  const session = await getSession();
  if (!session?.user) throw new Error('Not authenticated');
  if (!session.user.clientId) throw new Error('No client associated with user');

  const { knex } = await createTenantKnex(session.user.tenant);
  
  const cycles = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('client_contract_lines')
      .where({ 
        client_id: session.user.clientId,
        tenant: session.user.tenant
      })
      .orderBy('start_date', 'desc')
      .limit(12)
      .select('*');
  });

  return cycles.map((cycle: {
    client_contract_line_id: string;
    start_date: string;
    end_date: string | null;
  }): BillingCycle => ({
    id: cycle.client_contract_line_id,
    period: determineBillingPeriod(cycle.start_date, cycle.end_date),
    startDate: formatDate(cycle.start_date),
    endDate: formatDate(cycle.end_date),
    status: determineBillingStatus(cycle.start_date, cycle.end_date)
  }));
}

export async function getActiveServices(): Promise<Service[]> {
  const session = await getSession();
  if (!session?.user) throw new Error('Not authenticated');
  if (!session.user.clientId) throw new Error('No client associated with user');

  const { knex } = await createTenantKnex(session.user.tenant);
  
  const now = new Date().toISOString();
  
  const services = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('client_contract_lines as ccl')
      .join('contract_lines as cl', function(this: Knex.JoinClause) {
        this.on('ccl.contract_line_id', '=', 'cl.contract_line_id')
            .andOn('ccl.tenant', '=', 'cl.tenant');
      })
      .join('contract_line_services as ps', function(this: Knex.JoinClause) {
        this.on('cl.contract_line_id', '=', 'ps.contract_line_id')
            .andOn('cl.tenant', '=', 'ps.tenant');
      })
      .join('service_catalog as sc', function(this: Knex.JoinClause) {
        this.on('ps.service_id', '=', 'sc.service_id')
            .andOn('ps.tenant', '=', 'sc.tenant');
      })
      // Removed old join to bucket_plans
      .leftJoin('contract_line_service_configuration as psc', function(this: Knex.JoinClause) { // Added join for configurations
        this.on('ps.contract_line_id', '=', 'psc.contract_line_id')
            .andOn('ps.service_id', '=', 'psc.service_id')
            .andOn('ps.tenant', '=', 'psc.tenant');
      })
      .leftJoin('contract_line_service_bucket_config as psbc', function(this: Knex.JoinClause) { // Added join for bucket specifics
        this.on('psc.config_id', '=', 'psbc.config_id')
            .andOn('psc.tenant', '=', 'psbc.tenant');
      })
      .where({
        'ccl.client_id': session.user.clientId,
        'ccl.tenant': session.user.tenant,
        'cl.tenant': session.user.tenant,
        'ps.tenant': session.user.tenant,
        'sc.tenant': session.user.tenant
      })
      .whereIn('cl.contract_line_type', ['Fixed', 'Hourly', 'Usage'])
      .andWhere('ccl.start_date', '<=', now)
      .andWhere(function(this: Knex.QueryBuilder) {
        this.where('ccl.end_date', '>', now)
            .orWhereNull('ccl.end_date');
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
        'cl.contract_line_type',
        'cl.is_custom',
        'cl.billing_frequency',
        'cl.description as contract_line_description',
        // 'bucket.total_hours', // Removed old bucket field
        // 'bucket.overage_rate', // Removed old bucket field
        // 'bucket.billing_period as bucket_period', // Removed old bucket field
        'psc.config_id', // Added config_id
        'psbc.total_hours as psbc_total_hours', // Added new bucket field
        'psbc.overage_rate as psbc_overage_rate', // Added new bucket field
        'psbc.allow_rollover as psbc_allow_rollover', // Added new bucket field
        trx.raw("'active' as status"),
        'ccl.start_date',
        'ccl.end_date'
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
        'cl.contract_line_type',
        'cl.is_custom',
        'cl.billing_frequency',
        'cl.description',
        // 'bucket.total_hours', // Removed old bucket field
        // 'bucket.overage_rate', // Removed old bucket field
        // 'bucket.billing_period', // Removed old bucket field
        'psc.config_id', // Added config_id
        'psbc.total_hours', // Added new bucket field
        'psbc.overage_rate', // Added new bucket field
        'psbc.allow_rollover', // Added new bucket field
        'ccl.start_date',
        'ccl.end_date'
      );
  });

  return services.map((service: {
    id: string;
    name: string;
    description: string;
    status: string;
    service_type: string;
    contract_line_type: Service['billing']['type'];
    is_custom: boolean;
    billing_frequency: string;
    plan_description: string | null;
    default_rate: number | null;
    custom_rate: number | null;
    quantity: number | null;
    unit_of_measure: string | null;
    total_hours: number | null;
    overage_rate: number | null;
    // bucket_period: string | null; // Removed
    psbc_total_hours: number | null; // Added from new join
    psbc_overage_rate: number | null; // Added from new join
    psbc_allow_rollover: boolean | null; // Added from new join
    start_date: string;
    end_date: string | null;
  }): Service => {
    const hasCustomRate = service.custom_rate !== null;
    const rate = hasCustomRate ? service.custom_rate : service.default_rate;
    const isBucketPlan = Boolean(service.psbc_total_hours);

    // Determine base status
    const status = determineServiceStatus(service.start_date, service.end_date);

    // Format rate display
    const currencySymbol = getCurrencySymbol('USD'); // TODO: Get currency from contract when available
    const rateDisplay = rate ?
      `${currencySymbol}${(rate / 100).toFixed(2)}${service.billing_frequency ? ` per ${service.billing_frequency.toLowerCase()}` : ''}` :
      'Contact for pricing';

    // Format quantity display
    const quantityDisplay = service.quantity ?
      `${service.quantity} ${service.unit_of_measure || 'units'}` :
      'N/A';

    // Format bucket display using new fields
    const bucketDisplay = service.psbc_total_hours ? // Use new field
      `${service.psbc_total_hours} hours${service.psbc_overage_rate ? ` (+${currencySymbol}${(service.psbc_overage_rate / 100).toFixed(2)}/hr overage)` : ''}` : // Use new field
      'N/A';

    // Format billing display
    const billingDisplay = `${service.contract_line_type}${service.is_custom ? ' (Custom)' : ''} - ${service.billing_frequency || 'Contact for details'}`;

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
      // Update bucket object creation using new fields
      bucket: isBucketPlan && service.psbc_total_hours ? { // Check new field
        totalHours: service.psbc_total_hours.toString(), // Use new field
        overageRate: service.psbc_overage_rate ? // Use new field
          `${currencySymbol}${(service.psbc_overage_rate / 100).toFixed(2)}` :
          'N/A',
        // periodStart/End are derived from the client_contract_line dates
        periodStart: formatDate(service.start_date),
        periodEnd: formatDate(service.end_date),
        display: bucketDisplay
        // Consider adding allow_rollover if needed in the UI:
        // allowRollover: service.psbc_allow_rollover ?? false,
      } : undefined,
      billing: {
        type: service.contract_line_type,
        frequency: service.billing_frequency,
        isCustom: service.is_custom,
        description: service.plan_description || undefined,
        display: billingDisplay
      },
      serviceType: service.service_type,
      displayStatus: `${status} - ${service.contract_line_type}${service.is_custom ? ' Custom' : ''}`,
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
  const session = await getSession();
  if (!session?.user) throw new Error('Not authenticated');
  if (!session.user.clientId) throw new Error('No client associated with user');

  const { knex } = await createTenantKnex(session.user.tenant);
  
  // Get current service details
  const currentService = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('client_contract_lines as ccl')
      .join('contract_lines as cl', function(this: Knex.JoinClause) {
        this.on('ccl.contract_line_id', '=', 'cl.contract_line_id')
            .andOn('ccl.tenant', '=', 'cl.tenant');
      })
      .join('contract_line_services as ps', function(this: Knex.JoinClause) {
        this.on('cl.contract_line_id', '=', 'ps.contract_line_id')
            .andOn('cl.tenant', '=', 'ps.tenant');
      })
      .where({ 
        'ps.service_id': serviceId,
        'ccl.client_id': session.user.clientId,
        'ccl.tenant': session.user.tenant
      })
      .first();
  });

  if (!currentService) throw new Error('Service not found');

  // Get available plans for this service
  const plans = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return await trx('contract_lines as cl')
      .join('contract_line_services as ps', function(this: Knex.JoinClause) {
        this.on('cl.contract_line_id', '=', 'ps.contract_line_id')
            .andOn('cl.tenant', '=', 'ps.tenant');
      })
      .join('service_catalog as sc', function(this: Knex.JoinClause) {
        this.on('ps.service_id', '=', 'sc.service_id')
            .andOn('ps.tenant', '=', 'sc.tenant');
      })
      .where({ 
        'ps.service_id': serviceId,
        'cl.tenant': session.user.tenant,
        'cl.is_active': true
      })
      .select(
        'cl.contract_line_id as id',
        'cl.contract_line_name as name',
        'cl.description',
        'sc.default_rate'
      );
  });

  const currencySymbol = getCurrencySymbol('USD'); // TODO: Get currency from contract when available
  return plans.map((plan): ServicePlan => ({
    id: plan.id,
    name: plan.name,
    description: plan.description || '',
    rate: {
      amount: plan.default_rate.toString(),
      displayAmount: `${currencySymbol}${(plan.default_rate / 100).toFixed(2)}/mo`
    },
    isCurrentPlan: plan.id === currentService.contract_line_id
  }));
}

/**
 * @deprecated This function operated on the legacy client_contract_lines table which is being phased out.
 * Contracts are now client-specific via client_contracts, so plan upgrade/downgrade needs to be
 * reimplemented to modify contract lines on the client's contract directly.
 * TODO: Refactor to work with the new contract architecture.
 */
export async function upgradeService(_serviceId: string, _planId: string): Promise<{ success: boolean }> {
  throw new Error('Service upgrade functionality is temporarily unavailable. Please contact support to change your plan.');
}

export async function downgradeService(serviceId: string, planId: string): Promise<{ success: boolean }> {
  // Downgrade follows the same logic as upgrade
  return upgradeService(serviceId, planId);
}
