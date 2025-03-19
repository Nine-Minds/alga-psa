'use server'

import { createTenantKnex } from 'server/src/lib/db';
import { getServerSession } from "next-auth/next";
import { options } from "server/src/app/api/auth/[...nextauth]/options";
import { IBucketPlan, IBucketUsage } from 'server/src/interfaces/billing.interfaces';

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

export async function getBucketPlan(bucketPlanId: string) {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const {knex: db, tenant} = await createTenantKnex();
  
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  try {
    const bucketPlan = await db<IBucketPlan>('bucket_plans')
      .where({
        bucket_plan_id: bucketPlanId,
        tenant
      })
      .first();
    
    if (!bucketPlan) {
      throw new Error('Bucket plan not found');
    }
    
    return bucketPlan;
  } catch (error) {
    console.error('Error fetching bucket plan:', error);
    throw new Error('Failed to fetch bucket plan');
  }
}

export async function getBucketPlanByPlanId(planId: string) {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const {knex: db, tenant} = await createTenantKnex();
  
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  try {
    const bucketPlan = await db<IBucketPlan>('bucket_plans')
      .where({
        plan_id: planId,
        tenant
      })
      .first();
    
    return bucketPlan || null;
  } catch (error) {
    console.error('Error fetching bucket plan by plan ID:', error);
    throw new Error('Failed to fetch bucket plan by plan ID');
  }
}

export async function getBucketPlans() {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const {knex: db, tenant} = await createTenantKnex();
  
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  try {
    const bucketPlans = await db<IBucketPlan>('bucket_plans')
      .where({ tenant })
      .orderBy('created_at', 'desc');
    
    return bucketPlans;
  } catch (error) {
    console.error('Error fetching bucket plans:', error);
    throw new Error('Failed to fetch bucket plans');
  }
}

export async function updateBucketPlan(bucketPlanId: string, bucketPlanData: Partial<IBucketPlan> & { service_catalog_id?: string }) {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const {knex: db, tenant} = await createTenantKnex();
  
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  try {
    // Remove tenant field if present to prevent override
    const { tenant: _, ...safeData } = bucketPlanData;
    
    const [updatedPlan] = await db<IBucketPlan>('bucket_plans')
      .where({
        bucket_plan_id: bucketPlanId,
        tenant
      })
      .update(safeData)
      .returning('*');
    
    if (!updatedPlan) {
      throw new Error('Bucket plan not found or could not be updated');
    }
    
    return updatedPlan;
  } catch (error) {
    console.error('Error updating bucket plan:', error);
    throw new Error('Failed to update bucket plan');
  }
}

export async function deleteBucketPlan(bucketPlanId: string) {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const {knex: db, tenant} = await createTenantKnex();
  
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  try {
    // Check if the bucket plan is in use
    const usageCount = await db('bucket_usage')
      .where({
        bucket_plan_id: bucketPlanId,
        tenant
      })
      .count('* as count')
      .first();
    
    if (usageCount && Number(usageCount.count) > 0) {
      throw new Error('Cannot delete bucket plan that is currently in use');
    }
    
    const deleted = await db<IBucketPlan>('bucket_plans')
      .where({
        bucket_plan_id: bucketPlanId,
        tenant
      })
      .delete();
    
    if (!deleted) {
      throw new Error('Bucket plan not found or could not be deleted');
    }
    
    return true;
  } catch (error) {
    console.error('Error deleting bucket plan:', error);
    throw new Error('Failed to delete bucket plan');
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
