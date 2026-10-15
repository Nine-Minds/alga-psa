import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { ClientModel } from '@alga-psa/shared/models/clientModel';
import type {
  ApplyFieldResult,
  MappingApplyFieldContext,
  MappingDestinationProvider,
  MappingResolveContext,
  MappingTargetField,
  ResolveTargetResult,
} from '../types';
import {
  alwaysValid,
  coerceToBoolean,
  coerceToInteger,
  coerceToNumber,
  coerceToString,
  mappingValuesEqual,
  validateEnum,
} from '../coercion';

/**
 * Account destination provider. The target is always the submission's
 * `client_id` — exactly one per submission, so resolution can never be
 * ambiguous. Writes go through the canonical trx-scoped
 * `ClientModel.updateClient`, preserving client validation.
 *
 * The allowlist is code-defined and closed. Phone / email / street address live
 * on `client_locations`, not `clients`, so they are deliberately absent (OQ-3);
 * reference targets (`account_manager_id`, `location_id`, `region_code`) are
 * excluded too (OQ-5).
 */

const CLIENT_PERMISSION = { resource: 'client', action: 'update' } as const;

const BILLING_CYCLE_VALUES = [
  'weekly',
  'bi-weekly',
  'monthly',
  'quarterly',
  'semi-annually',
  'annually',
];
const INVOICE_DELIVERY_VALUES = ['email', 'mail', 'portal'];

const PROPERTIES_PREFIX = 'properties.';

function stringField(fieldKey: string, displayLabel: string): MappingTargetField {
  return {
    fieldKey,
    displayLabel,
    dataType: 'string',
    coerce: coerceToString,
    validate: alwaysValid,
    requiredPermission: CLIENT_PERMISSION,
  };
}

function numberField(fieldKey: string, displayLabel: string): MappingTargetField {
  return {
    fieldKey,
    displayLabel,
    dataType: 'number',
    coerce: coerceToNumber,
    validate: alwaysValid,
    requiredPermission: CLIENT_PERMISSION,
  };
}

// Integer-valued columns (bigint) need integer semantics, not the generic
// number coercion: `"1200.50"` must fail visibly in preview and apply alike
// instead of reaching Postgres and failing there.
function integerField(fieldKey: string, displayLabel: string): MappingTargetField {
  return {
    fieldKey,
    displayLabel,
    dataType: 'number',
    coerce: coerceToInteger,
    validate: alwaysValid,
    requiredPermission: CLIENT_PERMISSION,
  };
}

function booleanField(fieldKey: string, displayLabel: string): MappingTargetField {
  return {
    fieldKey,
    displayLabel,
    dataType: 'boolean',
    coerce: coerceToBoolean,
    validate: alwaysValid,
    requiredPermission: CLIENT_PERMISSION,
  };
}

function enumField(
  fieldKey: string,
  displayLabel: string,
  enumValues: string[]
): MappingTargetField {
  return {
    fieldKey,
    displayLabel,
    dataType: 'enum',
    enumValues,
    coerce: coerceToString,
    validate: validateEnum(enumValues),
    requiredPermission: CLIENT_PERMISSION,
  };
}

const ACCOUNT_TARGET_FIELDS: MappingTargetField[] = [
  stringField('client_name', 'Account name'),
  stringField('url', 'Website URL'),
  enumField('client_type', 'Account type', ['company', 'individual']),
  stringField('notes', 'Notes'),
  stringField('tax_id_number', 'Tax ID number'),
  stringField('payment_terms', 'Payment terms'),
  enumField('billing_cycle', 'Billing cycle', BILLING_CYCLE_VALUES),
  integerField('credit_limit', 'Credit limit'),
  stringField('preferred_payment_method', 'Preferred payment method'),
  booleanField('auto_invoice', 'Auto-invoice'),
  enumField('invoice_delivery_method', 'Invoice delivery method', INVOICE_DELIVERY_VALUES),
  booleanField('is_tax_exempt', 'Tax exempt'),
  stringField('tax_exemption_certificate', 'Tax exemption certificate'),
  stringField('timezone', 'Timezone'),
  stringField('billing_email', 'Billing email'),
  booleanField('is_inactive', 'Inactive'),
  stringField('properties.industry', 'Industry'),
  stringField('properties.company_size', 'Company size'),
  numberField('properties.annual_revenue', 'Annual revenue'),
  stringField('properties.status', 'Account status'),
  stringField('properties.website', 'Website (properties)'),
];

const ACCOUNT_TARGET_FIELD_MAP = new Map(
  ACCOUNT_TARGET_FIELDS.map((field) => [field.fieldKey, field] as const)
);

const SCALAR_COLUMNS = ACCOUNT_TARGET_FIELDS.filter(
  (field) => !field.fieldKey.startsWith(PROPERTIES_PREFIX)
).map((field) => field.fieldKey);

function parseProperties(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...(parsed as Record<string, unknown>) };
      }
    } catch {
      // fall through to empty
    }
  }
  return {};
}

async function loadClientRow(
  knex: Knex,
  tenant: string,
  clientId: string
): Promise<Record<string, unknown> | undefined> {
  return tenantDb(knex, tenant)
    .table('clients')
    .where({ client_id: clientId })
    .first<Record<string, unknown> | undefined>('client_id', 'properties', ...SCALAR_COLUMNS);
}

export const accountDestinationProvider: MappingDestinationProvider = {
  kind: 'account',
  displayName: 'Account',

  listTargetFields(): MappingTargetField[] {
    return ACCOUNT_TARGET_FIELDS;
  },

  getTargetField(fieldKey: string): MappingTargetField | undefined {
    return ACCOUNT_TARGET_FIELD_MAP.get(fieldKey);
  },

  async resolveTarget(ctx: MappingResolveContext): Promise<ResolveTargetResult> {
    const clientId = ctx.submission.clientId;
    if (!clientId) {
      return {
        ok: false,
        errorCode: 'failed_validation',
        errorDetail: 'Submission has no associated account',
      };
    }
    const row = await tenantDb(ctx.knex, ctx.tenant)
      .table('clients')
      .where({ client_id: clientId })
      .first<{ client_name: string | null }>('client_name');
    return {
      ok: true,
      targetRef: clientId,
      targetDisplay: row?.client_name ?? clientId,
    };
  },

  async applyField(ctx: MappingApplyFieldContext): Promise<ApplyFieldResult> {
    const { knex, tenant, field, targetRef, value, dryRun } = ctx;
    const row = await loadClientRow(knex, tenant, targetRef);
    if (!row) {
      throw new Error('Account not found for mapping target');
    }

    if (field.fieldKey.startsWith(PROPERTIES_PREFIX)) {
      const propertyKey = field.fieldKey.slice(PROPERTIES_PREFIX.length);
      const currentProperties = parseProperties(row.properties);
      const beforeValue = currentProperties[propertyKey] ?? null;
      const afterValue = value;

      if (mappingValuesEqual(field.dataType, beforeValue, afterValue)) {
        return { status: 'skipped_no_change', beforeValue, afterValue };
      }
      if (!dryRun) {
        const merged = { ...currentProperties, [propertyKey]: afterValue };
        await ClientModel.updateClient(
          targetRef,
          { properties: merged },
          tenant,
          knex as Knex.Transaction
        );
      }
      return { status: 'applied', beforeValue, afterValue };
    }

    const beforeValue = row[field.fieldKey] ?? null;
    const afterValue = value;
    if (mappingValuesEqual(field.dataType, beforeValue, afterValue)) {
      return { status: 'skipped_no_change', beforeValue, afterValue };
    }
    if (!dryRun) {
      if (field.fieldKey === 'url') {
        // updateClient mirrors url -> properties.website and would otherwise
        // replace the whole properties blob; pass the merged set explicitly.
        const merged = { ...parseProperties(row.properties), website: afterValue };
        await ClientModel.updateClient(
          targetRef,
          { url: afterValue as string, properties: merged },
          tenant,
          knex as Knex.Transaction
        );
      } else {
        await ClientModel.updateClient(
          targetRef,
          { [field.fieldKey]: afterValue } as Record<string, unknown>,
          tenant,
          knex as Knex.Transaction
        );
      }
    }
    return { status: 'applied', beforeValue, afterValue };
  },
};
