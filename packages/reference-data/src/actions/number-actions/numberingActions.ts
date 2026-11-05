'use server';

import { createTenantKnex, resolveEffectiveTimeZone, tenantDb } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { Knex } from 'knex';
import { NUMBERING_DEFAULTS, type EntityType } from '@alga-psa/shared/services/numberingService';
import { validateNumberDateFormat, type NumberDateFormatErrorCode } from '@alga-psa/shared/services/numberingFormat';

export interface NumberSettings {
  prefix: string;
  last_number: number;
  initial_value: number;
  padding_length: number | null;
  prefix_date_format: string | null;
}

export interface NumberSettingsView extends NumberSettings {
  /** Zone the date format is evaluated in at issuance. Derived, never persisted. */
  tenantTimezone: string;
}

export interface UpdateResponse {
  success: boolean;
  error?: string;
  /** Set for date-format failures so the client renders a translated message. */
  errorCode?: NumberDateFormatErrorCode;
  errorParams?: Record<string, string | number>;
  settings?: NumberSettings;
}

type NumberSettingsRow = NumberSettings & {
  tenant: string;
  entity_type: EntityType;
};

const EDITABLE_NUMBER_SETTINGS = new Set(['prefix', 'last_number', 'initial_value', 'padding_length', 'prefix_date_format']);

// QuickBooks Online rejects a DocNumber longer than 21 characters, and
// invoice_number syncs verbatim (quickBooksOnlineAdapter DocNumber mapping).
const QBO_DOC_NUMBER_MAX_LENGTH = 21;

/** Characters an INVOICE date format may still spend without breaking QBO sync. */
function invoiceDateFormatBudget(settings: Partial<NumberSettings>): number {
  const prefixLength = (settings.prefix ?? '').length;
  const nextNumber = Math.max(Number(settings.last_number ?? 0) + 1, Number(settings.initial_value ?? 1));
  const digits = Math.max(Number(settings.padding_length ?? 0), String(nextNumber).length);
  return Math.max(QBO_DOC_NUMBER_MAX_LENGTH - prefixLength - digits, 0);
}

export const getNumberSettings = withAuth(async (_user, { tenant }, entityType: EntityType): Promise<NumberSettingsView> => {
  const { knex: db } = await createTenantKnex();
  const { settings, tenantTimezone } = await withTransaction(db, async (trx: Knex.Transaction) => ({
    settings: await tenantDb(trx, tenant).table<NumberSettingsRow>('next_number')
      .where('entity_type', entityType)
      .first(),
    // Tenant-scoped, matching issuance: the preview must not drift with the
    // admin's browser zone.
    tenantTimezone: await resolveEffectiveTimeZone(trx, tenant),
  }));
  if (settings) {
    return { ...(settings as NumberSettings), tenantTimezone };
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
    prefix_date_format: null,
    tenantTimezone,
  };
});

export const updateNumberSettings = withAuth(async (
  user,
  { tenant },
  entityType: EntityType,
  updates: Partial<NumberSettings>
): Promise<UpdateResponse> => {
  if (!await hasPermission(user, 'settings', 'update')) {
    throw new Error('Permission denied: Cannot update numbering settings');
  }
  // Server-action arguments are untrusted at runtime. Never let a settings
  // payload relocate the tenant/entity row that owns the sequence.
  if (!Object.prototype.hasOwnProperty.call(NUMBERING_DEFAULTS, entityType)) {
    return { success: false, error: 'Unknown numbered entity type' };
  }
  if (Object.keys(updates).some((field) => !EDITABLE_NUMBER_SETTINGS.has(field))) {
    return { success: false, error: 'Unknown number setting' };
  }
  const { knex: db } = await createTenantKnex();

  try {
    return await withTransaction(db, async (trx: Knex.Transaction) => {
      const db = tenantDb(trx, tenant);
      // Use the allocator's initialization order and advisory lock. Reading an
      // unlocked counter lets a stale admin save rewind a concurrent issuance,
      // even when that issuance used a different client's asset prefix.
      await db.table<NumberSettingsRow>('next_number').insert({
        tenant,
        entity_type: entityType,
        last_number: 0,
        prefix_date_format: null,
        ...NUMBERING_DEFAULTS[entityType],
      }).onConflict(['tenant', 'entity_type']).ignore();
      await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?::uuid::text || ?::text))', [tenant, entityType]);
      const currentSettings = await db.table<NumberSettingsRow>('next_number')
        .where('entity_type', entityType)
        .forUpdate()
        .first();
      if (!currentSettings) throw new Error('Numbering settings could not be initialized');

      // An empty date format clears the feature; store NULL so issuance takes
      // the untouched pre-change path.
      const normalizedUpdates: Partial<NumberSettings> = { ...updates };
      if ('prefix_date_format' in updates) {
        const template = updates.prefix_date_format;
        normalizedUpdates.prefix_date_format =
          typeof template === 'string' && template.trim() !== '' ? template : null;
      }

      // Combine current settings with updates
      const finalSettings = {
        ...currentSettings,
        ...normalizedUpdates
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

        if (finalSettings.last_number < finalSettings.initial_value) {
          return { success: false, error: 'Last number cannot be less than the initial value' };
        }

        // Never rewind a committed sequence value.
        if (finalSettings.last_number < currentSettings.last_number) {
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

      if ('prefix_date_format' in normalizedUpdates && normalizedUpdates.prefix_date_format) {
        const validation = validateNumberDateFormat(
          normalizedUpdates.prefix_date_format,
          entityType === 'INVOICE' ? { maxExpandedLength: invoiceDateFormatBudget(finalSettings) } : {}
        );
        if (!validation.valid) {
          return {
            success: false,
            error: validation.error,
            errorCode: validation.errorCode,
            errorParams: validation.errorParams,
          };
        }
      }

      if (Object.keys(normalizedUpdates).length > 0) {
        await db.table<NumberSettingsRow>('next_number')
          .where('entity_type', entityType)
          .update(normalizedUpdates);
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
