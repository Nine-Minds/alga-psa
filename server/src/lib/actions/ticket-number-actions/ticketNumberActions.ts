'use server';

import { createTenantKnex } from 'server/src/lib/db';

interface UpdateNumberResponse {
  success: boolean;
  error?: string;
  settings?: any;
}

export async function getTicketNumberSettings() {
  const { knex: db, tenant } = await createTenantKnex();
  const settings = await db('next_number')
    .where('entity_type', 'TICKET')
    .andWhere('tenant', tenant)
    .first();
  return settings;
}

export async function updateTicketPrefix(prefix: string) {
  const { knex: db, tenant } = await createTenantKnex();
  await db('next_number')
    .where('entity_type', 'TICKET')
    .andWhere('tenant', tenant)
    .update({
      prefix: prefix
    });
  
  return await getTicketNumberSettings();
}

export async function updateInitialValue(value: number): Promise<UpdateNumberResponse> {
  const { knex: db, tenant } = await createTenantKnex();
  
  try {
    // Validate input
    if (!Number.isInteger(value) || value < 1) {
      return { success: false, error: 'Initial value must be a positive integer' };
    }

    // Get current settings
    const currentSettings = await getTicketNumberSettings();
    if (!currentSettings) {
      return { success: false, error: 'Failed to retrieve current settings' };
    }

    // Check if new value is valid
    if (value > currentSettings.last_number) {
      return { success: false, error: 'Initial value cannot be greater than the last used number' };
    }

    // Update the initial value
    await db('next_number')
      .where('entity_type', 'TICKET')
      .andWhere('tenant', tenant)
      .update({
        initial_value: value
      });

    const updatedSettings = await getTicketNumberSettings();
    return { success: true, settings: updatedSettings };
  } catch (error) {
    console.error('Error updating initial value:', error);
    return { success: false, error: 'Failed to update initial value' };
  }
}

export async function updateLastNumber(value: number): Promise<UpdateNumberResponse> {
  const { knex: db, tenant } = await createTenantKnex();
  
  try {
    // Validate input
    if (!Number.isInteger(value) || value < 1) {
      return { success: false, error: 'Last number must be a positive integer' };
    }

    // Get current settings
    const currentSettings = await getTicketNumberSettings();
    if (!currentSettings) {
      return { success: false, error: 'Failed to retrieve current settings' };
    }

    // Check if new value is valid
    if (value < currentSettings.last_number) {
      return { success: false, error: 'New number must be greater than the current last number' };
    }
    if (value < currentSettings.initial_value) {
      return { success: false, error: 'Last number cannot be less than the initial value' };
    }

    // Update the last number
    await db('next_number')
      .where('entity_type', 'TICKET')
      .andWhere('tenant', tenant)
      .update({
        last_number: value
      });

    const updatedSettings = await getTicketNumberSettings();
    return { success: true, settings: updatedSettings };
  } catch (error) {
    console.error('Error updating last number:', error);
    return { success: false, error: 'Failed to update last number' };
  }
}
