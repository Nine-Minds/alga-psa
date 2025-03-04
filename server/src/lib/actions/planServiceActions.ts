'use server'

import { createTenantKnex } from 'server/src/lib/db';
import { getServerSession } from "next-auth/next";
import { options } from "server/src/app/api/auth/[...nextauth]/options";
import { IPlanService } from 'server/src/interfaces';

export async function getPlanServices(planId: string): Promise<IPlanService[]> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const {knex: db, tenant} = await createTenantKnex();
    
  if (!tenant) {
    throw new Error('No tenant found');
  }

  try {
    const planServices = await db('plan_services')
      .where({
        plan_id: planId,
        tenant
      });
    return planServices;
  } catch (error) {
    console.error(`Error fetching plan services for tenant ${tenant}:`, error);
    throw new Error(`Failed to fetch plan services for tenant ${tenant}`);
  }
}

export async function addPlanService(planService: IPlanService): Promise<number> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  console.log('Inserting plan service:', planService);

  const {knex: db, tenant} = await createTenantKnex();
    
  if (!tenant) {
    throw new Error('No tenant found');
  }

  try {
    // Ensure tenant is included in the plan service
    const planServiceWithTenant = {
      ...planService,
      tenant
    };

    const result = await db('plan_services').insert(planServiceWithTenant);
    const insertedId = result[0];
    return insertedId;
  } catch (error) {
    console.error(`Error adding plan service for tenant ${tenant}:`, error);
    throw new Error(`Failed to add plan service for tenant ${tenant}`);
  }
}

export async function updatePlanService(planId: string, serviceId: string, updates: Partial<IPlanService>): Promise<void> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const {knex: db, tenant} = await createTenantKnex();
    
  if (!tenant) {
    throw new Error('No tenant found');
  }

  try {
    // Ensure tenant is included in both WHERE clause and updates
    const updatesWithTenant = {
      ...updates,
      tenant
    };

    await db('plan_services')
      .where({
        plan_id: planId,
        service_id: serviceId,
        tenant
      })
      .update(updatesWithTenant);
  } catch (error) {
    console.error(`Error updating plan service for tenant ${tenant}:`, error);
    throw new Error(`Failed to update plan service for tenant ${tenant}`);
  }
}

export async function removePlanService(planId: string, serviceId: string): Promise<void> {
  const session = await getServerSession(options);
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const {knex: db, tenant} = await createTenantKnex();
    
  if (!tenant) {
    throw new Error('No tenant found');
  }

  try {
    await db('plan_services')
      .where({
        plan_id: planId,
        service_id: serviceId,
        tenant
      })
      .del();
  } catch (error) {
    console.error(`Error removing plan service for tenant ${tenant}:`, error);
    throw new Error(`Failed to remove plan service for tenant ${tenant}`);
  }
}
