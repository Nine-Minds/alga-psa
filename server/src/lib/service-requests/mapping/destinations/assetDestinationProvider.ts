import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { updateAssetRecord } from '@alga-psa/assets/actions';
import type {
  ApplyFieldResult,
  AssetSelector,
  MappingApplyFieldContext,
  MappingDestinationProvider,
  MappingResolveContext,
  MappingTargetField,
  ResolveTargetResult,
} from '../types';
import {
  alwaysValid,
  coerceToDate,
  coerceToString,
  mappingValuesEqual,
} from '../coercion';

/**
 * Asset destination provider. Resolution is deliberate and ambiguity-hard
 * (plan §5): zero OR multiple candidate assets never guess — the field fails
 * with `failed_asset_unresolved` / `failed_asset_ambiguous`. Every candidate
 * query is tenant- and client-scoped, so cross-account resolution is
 * structurally impossible.
 *
 * Writes go through the actor-injectable `updateAssetRecord` core, which
 * validates against `updateAssetSchema`, validates `attributes` against the
 * resolved asset type's `fields_schema`, and writes asset history.
 *
 * `client_id` is never a target (never re-parent an asset). `location_id` is
 * excluded (OQ-5); free-text `location` is offered instead.
 */

const ASSET_PERMISSION = { resource: 'asset', action: 'update' } as const;
const ATTRIBUTES_PREFIX = 'attributes.';
const ATTRIBUTE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const MATCH_ATTRIBUTES = ['asset_tag', 'serial_number', 'name'] as const;

const ASSET_TARGET_FIELDS: MappingTargetField[] = [
  {
    fieldKey: 'name',
    displayLabel: 'Asset name',
    dataType: 'string',
    coerce: coerceToString,
    validate: alwaysValid,
    requiredPermission: ASSET_PERMISSION,
  },
  {
    fieldKey: 'asset_tag',
    displayLabel: 'Asset tag',
    dataType: 'string',
    coerce: coerceToString,
    validate: alwaysValid,
    requiredPermission: ASSET_PERMISSION,
  },
  {
    fieldKey: 'serial_number',
    displayLabel: 'Serial number',
    dataType: 'string',
    coerce: coerceToString,
    validate: alwaysValid,
    requiredPermission: ASSET_PERMISSION,
  },
  {
    fieldKey: 'status',
    displayLabel: 'Status',
    dataType: 'string',
    coerce: coerceToString,
    validate: alwaysValid,
    requiredPermission: ASSET_PERMISSION,
  },
  {
    fieldKey: 'location',
    displayLabel: 'Location (free text)',
    dataType: 'string',
    coerce: coerceToString,
    validate: alwaysValid,
    requiredPermission: ASSET_PERMISSION,
  },
  {
    fieldKey: 'purchase_date',
    displayLabel: 'Purchase date',
    dataType: 'date',
    coerce: coerceToDate,
    validate: alwaysValid,
    requiredPermission: ASSET_PERMISSION,
  },
  {
    fieldKey: 'warranty_end_date',
    displayLabel: 'Warranty end date',
    dataType: 'date',
    coerce: coerceToDate,
    validate: alwaysValid,
    requiredPermission: ASSET_PERMISSION,
  },
];

const ASSET_TARGET_FIELD_MAP = new Map(
  ASSET_TARGET_FIELDS.map((field) => [field.fieldKey, field] as const)
);

interface AssetCandidateRow {
  asset_id: string;
  name: string | null;
  asset_tag: string | null;
  serial_number: string | null;
  asset_type: string | null;
}

function assetDisplay(row: Pick<AssetCandidateRow, 'name' | 'asset_tag' | 'serial_number' | 'asset_id'>): string {
  return row.name || row.asset_tag || row.serial_number || row.asset_id;
}

function buildAttributeField(fieldKey: string): MappingTargetField | undefined {
  const attributeKey = fieldKey.slice(ATTRIBUTES_PREFIX.length);
  if (!ATTRIBUTE_KEY_PATTERN.test(attributeKey)) {
    return undefined;
  }
  return {
    fieldKey,
    displayLabel: `Attribute: ${attributeKey}`,
    dataType: 'string',
    coerce: coerceToString,
    validate: alwaysValid,
    requiredPermission: ASSET_PERMISSION,
  };
}

function isAttributesTarget(fieldKey: string): boolean {
  return fieldKey.startsWith(ATTRIBUTES_PREFIX);
}

function getAssetSelector(rule: MappingResolveContext['rule']): AssetSelector | undefined {
  const selector = rule.assetSelector;
  if (!selector || typeof selector !== 'object') {
    return undefined;
  }
  if (selector.strategy === 'answer-asset-ref' && typeof selector.assetRefQuestionKey === 'string') {
    return selector;
  }
  if (
    selector.strategy === 'match-attribute' &&
    MATCH_ATTRIBUTES.includes(selector.matchAttribute) &&
    typeof selector.matchQuestionKey === 'string'
  ) {
    return selector;
  }
  return undefined;
}

async function loadAssetById(
  knex: Knex,
  tenant: string,
  clientId: string,
  assetId: string
): Promise<AssetCandidateRow | undefined> {
  return tenantDb(knex, tenant)
    .table('assets')
    .where({ client_id: clientId, asset_id: assetId })
    .first<AssetCandidateRow | undefined>(
      'asset_id',
      'name',
      'asset_tag',
      'serial_number',
      'asset_type'
    );
}

async function findAssetsByAttribute(
  knex: Knex,
  tenant: string,
  clientId: string,
  attribute: (typeof MATCH_ATTRIBUTES)[number],
  value: unknown
): Promise<AssetCandidateRow[]> {
  const rows = await tenantDb(knex, tenant)
    .table('assets')
    .where({ client_id: clientId })
    .where(attribute, value as never)
    .select('asset_id', 'name', 'asset_tag', 'serial_number', 'asset_type');
  return rows as unknown as AssetCandidateRow[];
}

/** Attributes are only offered when the resolved asset's type registers the key. */
async function attributeRegisteredForAssetType(
  knex: Knex,
  tenant: string,
  assetType: string | null,
  attributeKey: string
): Promise<boolean> {
  if (!assetType) {
    return false;
  }
  const entry = await tenantDb(knex, tenant)
    .table('asset_type_registry')
    .where({ slug: assetType })
    .first<{ fields_schema: Array<{ key?: string }> | null }>('fields_schema');
  if (!entry || !Array.isArray(entry.fields_schema)) {
    return false;
  }
  return entry.fields_schema.some((field) => field?.key === attributeKey);
}

async function resolveAsset(
  ctx: MappingResolveContext
): Promise<ResolveTargetResult> {
  const selector = getAssetSelector(ctx.rule);
  if (!selector) {
    return {
      ok: false,
      errorCode: 'failed_validation',
      errorDetail: 'Asset rule is missing a valid asset selector',
    };
  }

  const clientId = ctx.submission.clientId;
  if (!clientId) {
    return {
      ok: false,
      errorCode: 'failed_asset_unresolved',
      errorDetail: 'Submission has no associated account',
    };
  }

  if (selector.strategy === 'answer-asset-ref') {
    const answer = ctx.submission.submittedPayload[selector.assetRefQuestionKey];
    if (typeof answer !== 'string' || answer.trim() === '') {
      return {
        ok: false,
        errorCode: 'failed_asset_unresolved',
        errorDetail: `Answer "${selector.assetRefQuestionKey}" did not identify an asset`,
      };
    }
    const asset = await loadAssetById(ctx.knex, ctx.tenant, clientId, answer.trim());
    if (!asset) {
      return {
        ok: false,
        errorCode: 'failed_asset_unresolved',
        errorDetail: 'Referenced asset was not found for this account',
      };
    }
    return { ok: true, targetRef: asset.asset_id, targetDisplay: assetDisplay(asset) };
  }

  const answer = ctx.submission.submittedPayload[selector.matchQuestionKey];
  if (answer === undefined || answer === null || String(answer).trim() === '') {
    return {
      ok: false,
      errorCode: 'failed_asset_unresolved',
      errorDetail: `Answer "${selector.matchQuestionKey}" is empty`,
    };
  }

  const candidates = await findAssetsByAttribute(
    ctx.knex,
    ctx.tenant,
    clientId,
    selector.matchAttribute,
    answer
  );
  if (candidates.length === 0) {
    return {
      ok: false,
      errorCode: 'failed_asset_unresolved',
      errorDetail: `No asset matches ${selector.matchAttribute}="${String(answer)}"`,
    };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      errorCode: 'failed_asset_ambiguous',
      errorDetail: `${candidates.length} assets match ${selector.matchAttribute}="${String(answer)}"`,
    };
  }
  return {
    ok: true,
    targetRef: candidates[0].asset_id,
    targetDisplay: assetDisplay(candidates[0]),
  };
}

function parseAttributes(raw: unknown): Record<string, unknown> {
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
      // fall through
    }
  }
  return {};
}

export const assetDestinationProvider: MappingDestinationProvider = {
  kind: 'asset',
  displayName: 'Asset',

  listTargetFields(): MappingTargetField[] {
    return ASSET_TARGET_FIELDS;
  },

  getTargetField(fieldKey: string): MappingTargetField | undefined {
    if (ASSET_TARGET_FIELD_MAP.has(fieldKey)) {
      return ASSET_TARGET_FIELD_MAP.get(fieldKey);
    }
    if (isAttributesTarget(fieldKey)) {
      return buildAttributeField(fieldKey);
    }
    return undefined;
  },

  async resolveTarget(ctx: MappingResolveContext): Promise<ResolveTargetResult> {
    const resolved = await resolveAsset(ctx);
    if (!resolved.ok) {
      return resolved;
    }

    if (isAttributesTarget(ctx.rule.targetFieldKey) && resolved.targetRef) {
      const attributeKey = ctx.rule.targetFieldKey.slice(ATTRIBUTES_PREFIX.length);
      const asset = await loadAssetById(
        ctx.knex,
        ctx.tenant,
        ctx.submission.clientId,
        resolved.targetRef
      );
      const registered = await attributeRegisteredForAssetType(
        ctx.knex,
        ctx.tenant,
        asset?.asset_type ?? null,
        attributeKey
      );
      if (!registered) {
        return {
          ok: false,
          errorCode: 'failed_validation',
          errorDetail: `Asset type does not register attribute "${attributeKey}"`,
        };
      }
    }

    return resolved;
  },

  async applyField(ctx: MappingApplyFieldContext): Promise<ApplyFieldResult> {
    const { knex, tenant, field, targetRef, value, dryRun, actorUserId } = ctx;
    const asset = await tenantDb(knex, tenant)
      .table('assets')
      .where({ asset_id: targetRef })
      .first<Record<string, unknown> | undefined>(
        'asset_id',
        'attributes',
        ...ASSET_TARGET_FIELDS.map((target) => target.fieldKey)
      );
    if (!asset) {
      throw new Error('Asset not found for mapping target');
    }

    if (isAttributesTarget(field.fieldKey)) {
      const attributeKey = field.fieldKey.slice(ATTRIBUTES_PREFIX.length);
      const currentAttributes = parseAttributes(asset.attributes);
      const beforeValue = currentAttributes[attributeKey] ?? null;
      const afterValue = value;
      if (mappingValuesEqual(field.dataType, beforeValue, afterValue)) {
        return { status: 'skipped_no_change', beforeValue, afterValue };
      }
      if (!dryRun) {
        await updateAssetRecord(
          knex,
          tenant,
          actorUserId,
          targetRef,
          { attributes: { [attributeKey]: afterValue } } as Record<string, unknown>,
          { suppressRevalidate: true }
        );
      }
      return { status: 'applied', beforeValue, afterValue };
    }

    const beforeValue = asset[field.fieldKey] ?? null;
    const afterValue = value;
    if (mappingValuesEqual(field.dataType, beforeValue, afterValue)) {
      return { status: 'skipped_no_change', beforeValue, afterValue };
    }
    if (!dryRun) {
      await updateAssetRecord(
        knex,
        tenant,
        actorUserId,
        targetRef,
        { [field.fieldKey]: afterValue } as Record<string, unknown>,
        { suppressRevalidate: true }
      );
    }
    return { status: 'applied', beforeValue, afterValue };
  },
};
