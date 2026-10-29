'use server';

import type { Knex } from 'knex';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { actionError, permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { IContractLine, IContractLineServiceRateTier } from '@alga-psa/types';
import { resolveFixedMemberRatePair } from '@shared/billingClients/fixedMemberRate';
import { normalizeContractLineDate } from '../lib/billing/contractLineWindow';
import { lockTenantBilling } from '../lib/billing/billingMutationLock';
import { computeContractLineVersion } from '../lib/billing/contractLineVersion';
import {
  assertContractLineIsAuthorable,
  contractLineActionErrorFrom,
  updateContractLineInTransaction,
} from '../lib/billing/contractLineUpdate';
import { ContractLineServiceConfigurationService } from '../services/contractLineServiceConfigurationService';
import { syncPrepaidBlockIssuancesForContractLine } from '../services/prepaidBlockIssuanceSync';
import { syncRecurringServicePeriodsForContractLine } from './recurringServicePeriodSync';
import type { ContractLineServiceMembershipAddition } from './contractLineServiceActions';
import { applyContractLineServiceMembershipChangesInTransaction } from '../lib/billing/contractLineMembership';
import {
  deleteBucketOverlayInTransaction,
  upsertBucketOverlayInTransaction,
  type BucketOverlayInput,
} from './bucketOverlayActions';
import { planExistingMemberWrite } from '../lib/billing/contractLineMemberDiff';
import { resolveNextUnbilledSeatBoundary } from '../lib/billing/seatRevisions';
import { getAnalyticsAsync } from '../lib/authHelpers';

/**
 * The user's intent for a whole Contract Lines edit. Storage decisions — the
 * fixed-member `base_rate_basis`, provenance, whether a change becomes a dated
 * revision or an in-place update — are made here, never by the browser.
 */
export interface ContractLineEditMemberDraft {
  /** Existing member configuration; absent for a member being added. */
  config_id?: string;
  service_id: string;
  /** Required for an added member. */
  configuration_type?: 'Fixed' | 'Hourly' | 'Usage';
  quantity?: number;
  /** Minor units; null = use the catalog price. */
  custom_rate?: number | null;
  hourly_rate?: number;
  /** Fixed/Usage unit rate (minor units); null = use the catalog price (Fixed). */
  base_rate?: number | null;
  measurement_mode?: 'additive' | 'replacement' | null;
  minimum_usage?: number;
  enable_tiered_pricing?: boolean;
  unit_of_measure?: string;
  rateTiers?: IContractLineServiceRateTier[];
}

export interface ContractLineEditDraft {
  line: {
    billing_timing?: IContractLine['billing_timing'];
    cadence_owner?: IContractLine['cadence_owner'];
    minimum_billable_time?: number | null;
    round_up_to_nearest?: number | null;
    location_id?: string | null;
    invoice_line_description?: string | null;
    start_date?: string | null;
    end_date?: string | null;
  };
  members: ContractLineEditMemberDraft[];
  removed_config_ids: string[];
  added_service_ids: string[];
  removed_service_ids: string[];
  /** Per service: an overlay to set, or null to delete. Absent = untouched. */
  bucket_overlays: Array<{ service_id: string; overlay: BucketOverlayInput | null }>;
  /** The effective boundary the editor showed for dated unit-price changes. */
  effective_boundary?: string | null;
  /** Token from getContractLineEditVersion, as the editor loaded the line. */
  expected_version: string;
}

export type ContractLineConflict = {
  readonly status: 'contract-line-conflict';
  readonly message: string;
  readonly messageKey: string;
  readonly currentVersion: string | null;
};

export type SaveContractLineEditSuccess = {
  readonly status: 'saved';
  readonly line: IContractLine;
  readonly version: string;
  readonly rematerialized: boolean;
};

export type SaveContractLineEditResult = SaveContractLineEditSuccess | ContractLineConflict | ReturnType<typeof actionError> | ReturnType<typeof permissionError>;

/** Version token for the editor to hold while a line is being edited. */
export const getContractLineEditVersion = withAuth(async (
  user,
  { tenant },
  contractLineId: string,
): Promise<string | null | ReturnType<typeof permissionError>> => {
  const { knex } = await createTenantKnex();
  if (!await hasPermission(user, 'billing', 'read', knex)) {
    return permissionError('Permission denied: billing read required', 'msp/billing:errors.permissions.billingRead');
  }
  return computeContractLineVersion(knex, tenant, contractLineId);
});

const LINE_FIELDS = [
  'billing_timing', 'cadence_owner', 'minimum_billable_time', 'round_up_to_nearest',
  'location_id', 'invoice_line_description', 'start_date', 'end_date',
] as const;

const finiteNonNegative = (value: unknown, label: string) => {
  if (value === undefined || value === null) return;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be zero or greater.`);
};

interface ExistingConfigRow {
  config_id: string;
  service_id: string;
  configuration_type: 'Fixed' | 'Hourly' | 'Usage' | 'Bucket';
}

type PlannedMemberUpdate = {
  configId: string;
  base: Record<string, unknown>;
  type: Record<string, unknown>;
  rateTiers?: IContractLineServiceRateTier[];
  expectedRevisionVersion?: number | null;
};

/**
 * Saves a whole contract-line edit in ONE transaction under the tenant billing
 * lock. Order: validate/resolve (no writes) → line fields (rematerialization
 * suppressed) → member edits → membership changes → bucket overlays →
 * rematerialize service periods once → commit. A failure anywhere changes
 * nothing.
 */
export const saveContractLineEdit = withAuth(async (
  user,
  { tenant },
  contractLineId: string,
  draft: ContractLineEditDraft,
): Promise<SaveContractLineEditResult> => {
  try {
    const { knex } = await createTenantKnex();
    if (!tenant) throw new Error('tenant context not found');

    const outcome = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const db = tenantDb(trx, tenant);

      // ---- 1. Validate and resolve. No writes before the "write" marker. ----
      if (!await hasPermission(user, 'billing', 'update', trx)) {
        return permissionError('Permission denied: billing update required', 'msp/billing:errors.permissions.billingUpdate');
      }
      if (draft.added_service_ids.length > 0 && !await hasPermission(user, 'billing', 'create', trx)) {
        return permissionError('Permission denied: billing create required', 'msp/billing:errors.permissions.billingCreate');
      }
      if ((draft.removed_service_ids.length > 0 || draft.removed_config_ids.length > 0) && !await hasPermission(user, 'billing', 'delete', trx)) {
        return permissionError('Permission denied: billing delete required', 'msp/billing:errors.permissions.billingDelete');
      }

      await lockTenantBilling(trx, tenant);
      const lineRow = await db.table('contract_lines')
        .where({ contract_line_id: contractLineId }).forUpdate().first();
      if (!lineRow) throw new Error(`Contract Line with ID ${contractLineId} not found.`);
      await assertContractLineIsAuthorable(trx, tenant, contractLineId);

      const currentVersion = await computeContractLineVersion(trx, tenant, contractLineId);
      if (!draft.expected_version || draft.expected_version !== currentVersion) {
        return {
          status: 'contract-line-conflict',
          message: 'This contract line was changed by someone else since you started editing. Reload it and re-apply your edit.',
          messageKey: 'msp/contract-lines:errors.line.versionConflict',
          currentVersion,
        } satisfies ContractLineConflict;
      }

      const addedIds = draft.added_service_ids;
      const removedIds = draft.removed_service_ids;
      if (new Set(addedIds).size !== addedIds.length) {
        return actionError('A service can only be added once in a contract line edit.', 'msp/contract-lines:errors.service.addedOnce');
      }
      if (new Set(removedIds).size !== removedIds.length) {
        return actionError('A service can only be removed once in a contract line edit.', 'msp/contract-lines:errors.service.removedOnce');
      }
      if (removedIds.some((id) => addedIds.includes(id))) {
        return actionError('The same service cannot be added and removed in one contract line edit.', 'msp/contract-lines:errors.service.addedAndRemoved');
      }

      const existingConfigs = await db.table('contract_line_service_configuration')
        .where({ contract_line_id: contractLineId })
        .select<ExistingConfigRow[]>('config_id', 'service_id', 'configuration_type');
      const configById = new Map(existingConfigs.map((c) => [c.config_id, c]));
      const fixedRows = await db.table('contract_line_service_fixed_config')
        .whereIn('config_id', existingConfigs.filter((c) => c.configuration_type === 'Fixed').map((c) => c.config_id))
        .select('config_id', 'pricing_basis', 'base_rate_basis');
      const fixedByConfig = new Map<string, { pricing_basis: string | null; base_rate_basis: 'per_unit' | 'share' | null }>(
        fixedRows.map((r: any) => [r.config_id, r]),
      );

      for (const configId of draft.removed_config_ids) {
        if (!configById.has(configId)) throw new Error(`Configuration with ID ${configId} not found`);
      }

      const boundary = draft.effective_boundary || undefined;
      const configService = new ContractLineServiceConfigurationService(trx, tenant);
      const planned: PlannedMemberUpdate[] = [];
      const additions: ContractLineServiceMembershipAddition[] = [];

      for (const member of draft.members) {
        finiteNonNegative(member.quantity, 'Quantity');
        finiteNonNegative(member.custom_rate, 'Rate');
        finiteNonNegative(member.hourly_rate, 'Hourly rate');
        finiteNonNegative(member.base_rate, 'Base rate');
        finiteNonNegative(member.minimum_usage, 'Minimum usage');

        if (!member.config_id) {
          if (!addedIds.includes(member.service_id)) {
            throw new Error(`Service ${member.service_id} is not part of this contract line edit.`);
          }
          const type = member.configuration_type;
          if (!type) throw new Error('A configuration type is required for an added service.');
          const customRate = type === 'Usage' ? (member.base_rate ?? member.custom_rate) : member.custom_rate;
          const typeConfig =
            type === 'Hourly'
              ? { hourly_rate: member.hourly_rate ?? member.custom_rate ?? undefined }
              : type === 'Usage'
                ? {
                    base_rate: member.base_rate ?? member.custom_rate ?? undefined,
                    measurement_mode: member.measurement_mode ?? 'additive',
                    minimum_usage: member.minimum_usage ?? 0,
                    enable_tiered_pricing: member.enable_tiered_pricing ?? false,
                    ...(member.unit_of_measure ? { unit_of_measure: member.unit_of_measure } : {}),
                  }
                // A Fixed member's authoring rate is a catalog price per unit; the
                // resolver validates the pair and a null rate carries no basis.
                : (() => {
                    const rate = member.base_rate ?? member.custom_rate ?? null;
                    return resolveFixedMemberRatePair({ base_rate: rate, base_rate_basis: 'per_unit' });
                  })();
          additions.push({
            serviceId: member.service_id,
            quantity: member.quantity,
            customRate,
            configurationType: type,
            typeConfig: typeConfig as ContractLineServiceMembershipAddition['typeConfig'],
            ...(type === 'Usage' ? { rateTiers: member.rateTiers ?? [] } : {}),
          });
          continue;
        }

        const config = configById.get(member.config_id);
        if (!config || config.service_id !== member.service_id) {
          throw new Error(`Configuration with ID ${member.config_id} not found`);
        }
        if (removedIds.includes(config.service_id) || draft.removed_config_ids.includes(config.config_id)) continue;

        // Plan a write only for what the user changed, comparing with the values
        // the editor was showing: effective-at-boundary for unit-priced Fixed and
        // Usage members, stored otherwise. An untouched member produces no write
        // and no revision, so a revision already scheduled for it is never replaced.
        const stored = fixedByConfig.get(config.config_id);
        const showsEffective = config.configuration_type === 'Usage'
          || (config.configuration_type === 'Fixed' && stored?.pricing_basis === 'unit');
        const current = await configService.getConfigurationWithDetails(
          config.config_id,
          showsEffective ? boundary : undefined,
        );
        const write = planExistingMemberWrite({
          configurationType: config.configuration_type,
          member,
          current: current as any,
          storedFixed: stored,
        });
        if (!write) continue;

        let expectedRevisionVersion: number | null | undefined;
        if (config.configuration_type === 'Fixed') {
          // A changed unit member may land on a boundary that already holds a
          // scheduled revision. Replace it only if it is still the one read here
          // (under the billing lock): compare-and-set, never an unconditional upsert.
          const revisionBoundary = boundary
            ?? await resolveNextUnbilledSeatBoundary({ trx, tenant, contractLineId });
          if (revisionBoundary) {
            if (stored?.pricing_basis === 'unit') write.type.effective_period_start = revisionBoundary;
            const existingRevision = await db.table('contract_line_unit_pricing_revisions')
              .where({ config_id: config.config_id, effective_period_start: revisionBoundary })
              .first('version');
            expectedRevisionVersion = existingRevision ? Number(existingRevision.version ?? 1) : null;
          }
        }
        planned.push({ configId: config.config_id, ...write, expectedRevisionVersion });
      }

      for (const entry of draft.bucket_overlays) {
        if (entry.overlay) finiteNonNegative(entry.overlay.total_minutes, 'Bucket minutes');
        if (entry.overlay) finiteNonNegative(entry.overlay.overage_rate, 'Bucket overage rate');
      }
      const linePatch: Partial<IContractLine> = {};
      for (const key of LINE_FIELDS) {
        if (key in draft.line) (linePatch as Record<string, unknown>)[key] = (draft.line as Record<string, unknown>)[key];
      }

      // ---- Writes. Everything below shares `trx`; any throw rolls it all back. ----
      const before = {
        billing_timing: lineRow.billing_timing,
        cadence_owner: lineRow.cadence_owner,
        start_date: normalizeContractLineDate(lineRow.start_date),
        end_date: normalizeContractLineDate(lineRow.end_date),
      };

      // 2. Line fields, rematerialization suppressed.
      let updatedLine: IContractLine = lineRow as IContractLine;
      let updatedFields: string[] = [];
      if (Object.keys(linePatch).length > 0) {
        const res = await updateContractLineInTransaction(trx, tenant, contractLineId, linePatch);
        updatedLine = res.line;
        updatedFields = res.updatedFields;
      }

      // 3. Member and configuration edits (the service is bound to `trx`, so its
      //    own transactions nest as savepoints).
      for (const update of planned) {
        if (Object.keys(update.base).length === 0 && Object.keys(update.type).length === 0 && !update.rateTiers) continue;
        await configService.updateConfiguration(
          update.configId,
          update.base as any,
          update.type as any,
          update.rateTiers,
          // Compare-and-set against the revision read under the lock (null = the
          // boundary was empty). Never an unconditional upsert.
          update.expectedRevisionVersion === undefined ? null : update.expectedRevisionVersion,
        );
      }
      for (const configId of draft.removed_config_ids) {
        const config = configById.get(configId)!;
        if (removedIds.includes(config.service_id)) continue; // goes with the membership
        await configService.deleteConfiguration(configId);
      }

      // 4. Membership additions and removals.
      const membershipChanged = additions.length > 0 || removedIds.length > 0;
      if (membershipChanged) {
        await applyContractLineServiceMembershipChangesInTransaction(trx, tenant, contractLineId, {
          additions,
          removals: removedIds,
        });
      }

      // 5. Bucket overlays (after memberships so an added service has its configuration).
      for (const entry of draft.bucket_overlays) {
        if (removedIds.includes(entry.service_id)) continue;
        if (entry.overlay) {
          if (!await hasPermission(user, 'billing', 'update', trx)) throw new Error('Permission denied: Cannot update bucket overlays');
          await upsertBucketOverlayInTransaction(trx, tenant, contractLineId, entry.service_id, {
            total_minutes: entry.overlay.total_minutes,
            overage_rate: entry.overlay.overage_rate,
            allow_rollover: entry.overlay.allow_rollover ?? false,
            billing_period: entry.overlay.billing_period ?? 'monthly',
          });
        } else {
          if (!await hasPermission(user, 'billing', 'delete', trx)) throw new Error('Permission denied: Cannot delete bucket overlays');
          await deleteBucketOverlayInTransaction(trx, tenant, contractLineId, entry.service_id);
        }
      }

      // 6. Rematerialize exactly once, from the final state — and only when
      //    something that shapes service periods changed. A pricing-only edit
      //    (same cadence, timing and window; no membership change) does not.
      const after = await db.table('contract_lines').where({ contract_line_id: contractLineId }).first();
      const periodShapeChanged =
        membershipChanged ||
        before.billing_timing !== after.billing_timing ||
        before.cadence_owner !== after.cadence_owner ||
        before.start_date !== normalizeContractLineDate(after.start_date) ||
        before.end_date !== normalizeContractLineDate(after.end_date);
      if (periodShapeChanged) {
        // LEVERAGE: pattern line-obligation-sync — prepaid block issuances follow the same line-obligation changes as recurring service periods
        await syncRecurringServicePeriodsForContractLine(trx, {
          tenant,
          contractLineId,
          sourceRunPrefix: 'contract_line_update',
        });
        await syncPrepaidBlockIssuancesForContractLine(trx, tenant, contractLineId);
      }

      // The version must move on every save, including member-only edits.
      // Bound from JS (no now() in CASE/COALESCE on Citus).
      await db.table('contract_lines').where({ contract_line_id: contractLineId }).update({ updated_at: new Date() });
      const version = (await computeContractLineVersion(trx, tenant, contractLineId))!;

      return {
        status: 'saved',
        line: { ...updatedLine, ...(after as IContractLine) },
        version,
        rematerialized: periodShapeChanged,
        updatedFields,
      } as SaveContractLineEditSuccess & { updatedFields: string[] };
    });

    if (!('updatedFields' in outcome)) return outcome;
    const { updatedFields, ...saved } = outcome;
    try {
      const { analytics, AnalyticsEvents } = await getAnalyticsAsync();
      analytics.capture(AnalyticsEvents.BILLING_RULE_UPDATED, {
        contract_line_id: contractLineId,
        updated_fields: updatedFields,
      }, user.user_id);
    } catch (analyticsError) {
      console.warn('Contract line save analytics failed:', analyticsError);
    }
    return saved;
  } catch (error) {
    console.error(`Error saving contract line edit ${contractLineId}:`, error);
    const expected = contractLineActionErrorFrom(error);
    if (expected) return expected;
    // Domain validation throws plain Errors with user-meaningful messages; DB
    // driver errors carry a `code` and are not surfaced verbatim.
    if (error instanceof Error && !(error as { code?: string }).code) {
      return actionError(error.message);
    }
    throw error;
  }
});
