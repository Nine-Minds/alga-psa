'use server'

import { createTenantKnex } from '@/lib/db';
import { getServerSession } from "next-auth/next";
import { options } from "@/app/api/auth/[...nextauth]/options";
import { IBucketPlan, IBucketUsage } from '@/interfaces/billing.interfaces';

export async function createBucketPlan(bucketPlan: Omit<IBucketPlan, 'bucket_plan_id'> & { service_catalog_id: string }) {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const {knex: db, tenant} = await createTenantKnex();
  
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  try {
    const [createdPlan] = await db<IBucketPlan>('bucket_plans')
      .insert({
        ...bucketPlan,
        tenant
      })
      .returning('*');
    return createdPlan;
  } catch (error) {
    console.error('Error creating bucket plan:', error);
    throw new Error('Failed to create bucket plan');
  }
}

export async function getBucketPlanUsage(bucketPlanId: string, companyId: string, startDate: Date, endDate: Date) {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const {knex: db, tenant} = await createTenantKnex();

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  try {
    const usage = await db<IBucketUsage>('bucket_usage')
      .where({
        bucket_plan_id: bucketPlanId,
        company_id: companyId,
        tenant
      })
      .whereBetween('period_start', [startDate, endDate])
      .orderBy('period_start', 'asc');
    return usage;
  } catch (error) {
    console.error('Error fetching bucket plan usage:', error);
    throw new Error('Failed to fetch bucket plan usage');
  }
}
