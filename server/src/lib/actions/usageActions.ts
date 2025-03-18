'use server';

import { createTenantKnex } from 'server/src/lib/db';
import { determineDefaultBillingPlan } from 'server/src/lib/utils/planDisambiguation';
import { getServerSession } from "next-auth/next";
import { options } from "server/src/app/api/auth/[...nextauth]/options";
import { ICreateUsageRecord, IUpdateUsageRecord, IUsageFilter, IUsageRecord } from 'server/src/interfaces/usage.interfaces';
import { revalidatePath } from 'next/cache';
import { Knex } from 'knex';

export async function createUsageRecord(data: ICreateUsageRecord): Promise<IUsageRecord> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const { knex, tenant } = await createTenantKnex();

  // If no billing plan ID is provided, try to determine the default one
  let billingPlanId = data.billing_plan_id;
  if (!billingPlanId && data.service_id && data.company_id) {
    try {
      const defaultPlanId = await determineDefaultBillingPlan(
        data.company_id,
        data.service_id
      );
      
      if (defaultPlanId) {
        billingPlanId = defaultPlanId;
      }
    } catch (error) {
      console.error('Error determining default billing plan:', error);
    }
  }

  const [record] = await knex('usage_tracking')
    .insert({
      tenant,
      company_id: data.company_id,
      service_id: data.service_id,
      quantity: data.quantity,
      usage_date: data.usage_date,
      billing_plan_id: billingPlanId,
    })
    .returning('*');

  revalidatePath('/msp/billing');
  return record;
}

export async function updateUsageRecord(data: IUpdateUsageRecord): Promise<IUsageRecord> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const { knex, tenant } = await createTenantKnex();

  // If billing plan ID is explicitly set to null or undefined, and we have company and service IDs,
  // try to determine the default one
  let billingPlanId = data.billing_plan_id;
  if (data.billing_plan_id === null || data.billing_plan_id === undefined) {
    // Get the current record to get company_id and service_id if not provided in the update
    const currentRecord = await knex('usage_tracking')
      .where({ tenant, usage_id: data.usage_id })
      .first();
    
    const companyId = data.company_id || currentRecord.company_id;
    const serviceId = data.service_id || currentRecord.service_id;
    
    if (companyId && serviceId) {
      try {
        const defaultPlanId = await determineDefaultBillingPlan(
          companyId,
          serviceId
        );
        
        if (defaultPlanId) {
          billingPlanId = defaultPlanId;
        }
      } catch (error) {
        console.error('Error determining default billing plan:', error);
      }
    }
  }

  const [record] = await knex('usage_tracking')
    .where({ tenant, usage_id: data.usage_id })
    .update({
      company_id: data.company_id,
      service_id: data.service_id,
      quantity: data.quantity,
      usage_date: data.usage_date,
      billing_plan_id: billingPlanId,
    })
    .returning('*');

  revalidatePath('/msp/billing');
  return record;
}

export async function deleteUsageRecord(usageId: string): Promise<void> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const { knex, tenant } = await createTenantKnex();

  await knex('usage_tracking')
    .where({ tenant, usage_id: usageId })
    .delete();

  revalidatePath('/msp/billing');
}

export async function getUsageRecords(filter?: IUsageFilter): Promise<IUsageRecord[]> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const { knex, tenant } = await createTenantKnex();

  let query = knex('usage_tracking')
    .select(
      'usage_tracking.*',
      'companies.company_name',
      'service_catalog.service_name'
    )
    .join('companies', function(this: Knex.JoinClause) {
      this.on('companies.company_id', '=', 'usage_tracking.company_id')
        .andOn('companies.tenant', '=', 'usage_tracking.tenant');
    })
    .join('service_catalog', function(this: Knex.JoinClause) {
      this.on('service_catalog.service_id', '=', 'usage_tracking.service_id')
        .andOn('service_catalog.tenant', '=', 'usage_tracking.tenant');
    })
    .where('usage_tracking.tenant', tenant);

  if (filter?.company_id) {
    query = query.where('usage_tracking.company_id', filter.company_id);
  }

  if (filter?.service_id) {
    query = query.where('usage_tracking.service_id', filter.service_id);
  }

  if (filter?.start_date) {
    query = query.where('usage_tracking.usage_date', '>=', filter.start_date);
  }

  if (filter?.end_date) {
    query = query.where('usage_tracking.usage_date', '<=', filter.end_date);
  }

  return query.orderBy('usage_tracking.usage_date', 'desc');
}

interface Company {
  company_id: string;
  company_name: string;
}

export async function getCompanies() {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const { knex, tenant } = await createTenantKnex();

  const companies = await knex('companies')
    .select('company_id', 'company_name')
    .where('tenant', tenant)
    .orderBy('company_name') as Company[];

  return companies.map((company: Company) => ({
    value: company.company_id,
    label: company.company_name
  }));
}