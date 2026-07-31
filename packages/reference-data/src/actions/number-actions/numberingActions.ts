'use server';

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { Knex } from 'knex';
import { NUMBERING_DEFAULTS, type EntityType } from '@alga-psa/shared/services/numberingService';

export interface NumberSettings {
  prefix: string;
  last_number: number;
  initial_value: number;
  padding_length: number | null;
}

export interface UpdateResponse {
  success: boolean;
  error?: string;
  settings?: NumberSettings;
}

type NumberSettingsRow = NumberSettings & {
  tenant: string;
  entity_type: EntityType;
};

export const getNumberSettings = withAuth(async (_user, { tenant }, entityType: EntityType): Promise<NumberSettings> => {
  const { knex: db } = await createTenantKnex();
  const settings = await withTransaction(db, async (trx: Knex.Transaction) => {
    return await tenantDb(trx, tenant).table<NumberSettingsRow>('next_number')
      .where('entity_type', entityType)
      .first();
  });
  if (settings) {
    return settings as NumberSettings;
  }
  // No row yet (a type whose first number hasn't been generated — the row is
  // self-initialized on first getNextNumber). Return the effective defaults so
  // the settings UI shows the real format read-only, like the seeded types,
  // instead of dropping into "new settings" edit mode.
  const defaults = NUMBERING_DEFAULTS[entityType];
  return {
    prefix: defaults.prefix,
    padding_length: defaults.padding_length,
    last_number: 0,
    initial_value: defaults.initial_value,
  };
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
      const db = tenantDb(trx, tenant);

      const currentSettings = await db.table<NumberSettingsRow>('next_number')
        .where('entity_type', entityType)
        .first();
      const isNewSettings = !currentSettings;

      // Combine current settings with updates
      const finalSettings = {
        ...(currentSettings || { last_number: 0, ...NUMBERING_DEFAULTS[entityType] }),
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
        const padding = finalSettings.padding_length;
        if (typeof padding !== 'number' || !Number.isInteger(padding) || padding < 1 || padding > 10) {
          return { success: false, error: 'Padding length must be a positive integer between 1 and 10' };
        }
      }

      if ('prefix' in updates) {
        if (typeof finalSettings.prefix !== 'string') {
          return { success: false, error: 'Prefix must be a string' };
        }
      }

      // Insert or update settings
      if (isNewSettings) {
        await db.table<NumberSettingsRow>('next_number').insert({
          tenant,
          entity_type: entityType,
          ...finalSettings
        });
      } else {
        await db.table<NumberSettingsRow>('next_number')
          .where('entity_type', entityType)
          .update(updates);
      }

      const updatedSettings = await db.table<NumberSettingsRow>('next_number')
        .where('entity_type', entityType)
        .first();
      if (!updatedSettings) {
        return { success: false, error: 'Failed to retrieve updated number settings' };
      }
      return { success: true, settings: updatedSettings };
    });
  } catch (error) {
    console.error(`Error updating ${entityType} number settings:`, error);
    return { success: false, error: 'Failed to update number settings' };
  }
});

// Check if user can edit numbering settings
export const canEditNumberingSettings = withAuth(async (user): Promise<boolean> => {
  return await hasPermission(user, 'settings', 'update');
});

// Legacy support
export const getTicketNumberSettings = async () => await getNumberSettings('TICKET');
export const getInvoiceNumberSettings = async () => await getNumberSettings('INVOICE');
