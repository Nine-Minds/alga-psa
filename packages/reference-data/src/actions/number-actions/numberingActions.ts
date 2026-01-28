'use server';

import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { Knex } from 'knex';
import type { EntityType } from '@alga-psa/shared/services/numberingService';

export interface NumberSettings {
  prefix: string;
  last_number: number;
  initial_value: number;
  padding_length: number;
}

export interface UpdateResponse {
  success: boolean;
  error?: string;
  settings?: NumberSettings;
}

export const getNumberSettings = withAuth(async (_user, { tenant }, entityType: EntityType): Promise<NumberSettings> => {
  const { knex: db } = await createTenantKnex();
  const settings = await withTransaction(db, async (trx: Knex.Transaction) => {
    return await trx('next_number')
      .where('entity_type', entityType)
      .andWhere('tenant', tenant)
      .first();
  });
  return settings;
});

export const updateNumberSettings = withAuth(async (
  _user,
  { tenant },
  entityType: EntityType,
  updates: Partial<NumberSettings>
): Promise<UpdateResponse> => {
  const { knex: db } = await createTenantKnex();

  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      // Get current settings if they exist
      const currentSettings = await trx('next_number')
        .where('entity_type', entityType)
        .andWhere('tenant', tenant)
        .first();
      const isNewSettings = !currentSettings;

      // Combine current settings with updates
      const finalSettings = {
        ...(currentSettings || {
          prefix: entityType === 'TICKET' ? 'TK-' : 'INV-',
          padding_length: 6,
          last_number: 0,
          initial_value: 1
        }),
        ...updates
      };

      // Only validate fields that are being updated
      if ('initial_value' in updates) {
        if (!Number.isInteger(finalSettings.initial_value) || finalSettings.initial_value < 1) {
          return { success: false, error: 'Initial value must be a positive integer' };
        }
      }

      if ('last_number' in updates) {
        if (!Number.isInteger(finalSettings.last_number) || finalSettings.last_number < 1) {
          return { success: false, error: 'Last number must be a positive integer' };
        }

        if ('initial_value' in updates || !isNewSettings) {
          if (finalSettings.last_number < finalSettings.initial_value) {
            return { success: false, error: 'Last number cannot be less than the initial value' };
          }
        }

        // Only check for decreasing last_number if we're updating existing settings
        if (!isNewSettings && currentSettings && finalSettings.last_number < currentSettings.last_number) {
          return { success: false, error: 'New number must be greater than the current last number' };
        }
      }

      if ('padding_length' in updates) {
        if (!Number.isInteger(finalSettings.padding_length) ||
            finalSettings.padding_length < 1 ||
            finalSettings.padding_length > 10) {
          return { success: false, error: 'Padding length must be a positive integer between 1 and 10' };
        }
      }

      if ('prefix' in updates) {
        if (!finalSettings.prefix || typeof finalSettings.prefix !== 'string') {
          return { success: false, error: 'Prefix is required' };
        }
      }

      // Insert or update settings
      if (isNewSettings) {
        await trx('next_number').insert({
          tenant,
          entity_type: entityType,
          ...finalSettings
        });
      } else {
        await trx('next_number')
          .where('entity_type', entityType)
          .andWhere('tenant', tenant)
          .update(updates);
      }

      const updatedSettings = await trx('next_number')
        .where('entity_type', entityType)
        .andWhere('tenant', tenant)
        .first();
      return { success: true, settings: updatedSettings };
    });
  } catch (error) {
    console.error(`Error updating ${entityType} number settings:`, error);
    return { success: false, error: 'Failed to update number settings' };
  }
});

// Check if user can edit numbering settings
export const canEditNumberingSettings = withAuth(async (user): Promise<boolean> => {
  return hasPermission(user, 'settings', 'update');
});

// Legacy support
export const getTicketNumberSettings = async () => await getNumberSettings('TICKET');
export const getInvoiceNumberSettings = async () => await getNumberSettings('INVOICE');
