'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { ADD_ONS, tenantHasAddOn } from '@alga-psa/types';
import type { Knex } from 'knex';
import { isEnterprise } from '../features';
import { getActiveAddOns } from '../tier-gating/getActiveAddOns';
import {
  buildGhostTicketInputs,
  getGhostUsageAiSettings,
  parseGhostClassification,
  selectClassifiableCandidates,
  setGhostUsageAiEnabledSetting,
  upsertGhostUsageReview,
} from '@alga-psa/inventory/lib';
import type {
  GhostRunResult,
  GhostUsageAiStatus,
  GhostUsageFilters,
} from '@alga-psa/inventory/lib';

/**
 * EE AI ghost-usage actions (PRD §17). These live in server/src — not in
 * packages/inventory — so the inventory package stays free of @ee imports;
 * the page passes them into GhostUsageReport as props (D12 pattern).
 *
 * Three independent gates (§17.1): EE edition, the AI Assistant add-on, and
 * the tenant opt-in (tenant_settings.settings.inventory.ghostUsageAi.enabled).
 * Any gate off → neutral results, never a throw that would disturb the CE report.
 */

const RUN_LIMIT_DEFAULT = 25;
const RUN_LIMIT_MAX = 100;
const CLASSIFY_CONCURRENCY = 3;

async function computeAiStatus(knex: Knex, tenant: string): Promise<GhostUsageAiStatus> {
  const edition_ok = isEnterprise;
  const addon_ok = edition_ok
    ? tenantHasAddOn(await getActiveAddOns(tenant), ADD_ONS.AI_ASSISTANT)
    : false;
  const enabled = (await getGhostUsageAiSettings(knex, tenant)).enabled;
  const available = edition_ok && addon_ok;
  return { edition_ok, addon_ok, enabled, available, can_run: available && enabled };
}

export const getGhostUsageAiStatus = withAuth(async (
  user,
  { tenant },
): Promise<GhostUsageAiStatus> => {
  if (!(await hasPermission(user, 'inventory', 'read'))) {
    throw new Error('Permission denied: inventory:read required');
  }
  const { knex } = await createTenantKnex();
  return computeAiStatus(knex, tenant);
});

export const setGhostUsageAiEnabled = withAuth(async (
  user,
  { tenant },
  enabled: boolean,
): Promise<GhostUsageAiStatus> => {
  if (!(await hasPermission(user, 'settings', 'update'))) {
    throw new Error('Permission denied: settings:update required');
  }
  const { knex } = await createTenantKnex();
  const status = await computeAiStatus(knex, tenant);
  // Enabling requires the feature to actually exist here; disabling is always allowed.
  if (enabled && !status.available) {
    throw new Error('AI triage requires Enterprise Edition and the AI Assistant add-on.');
  }
  await setGhostUsageAiEnabledSetting(knex, tenant, enabled);
  return { ...status, enabled, can_run: status.available && enabled };
});

export const runGhostUsageClassification = withAuth(async (
  user,
  { tenant },
  filters: GhostUsageFilters = {},
  opts: { limit?: number } = {},
): Promise<GhostRunResult> => {
  if (!(await hasPermission(user, 'inventory', 'update'))) {
    throw new Error('Permission denied: inventory:update required');
  }

  const zero = { classified: 0, unclear: 0, failed: 0, remaining_unclassified: 0 };
  if (!isEnterprise) return { attempted: false, reason: 'edition', ...zero };

  const { knex } = await createTenantKnex();
  if (!tenantHasAddOn(await getActiveAddOns(tenant), ADD_ONS.AI_ASSISTANT)) {
    return { attempted: false, reason: 'addon', ...zero };
  }
  if (!(await getGhostUsageAiSettings(knex, tenant)).enabled) {
    return { attempted: false, reason: 'opt_in', ...zero };
  }

  const limit = Math.max(1, Math.min(RUN_LIMIT_MAX, Math.floor(opts.limit ?? RUN_LIMIT_DEFAULT)));

  // Candidate selection and text assembly are short transactions; the model
  // calls happen OUTSIDE any transaction — never hold a DB txn across HTTP.
  const inputs = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const ticketIds = await selectClassifiableCandidates(trx, tenant, filters, limit);
    return ticketIds.length ? buildGhostTicketInputs(trx, tenant, ticketIds) : [];
  });

  let classified = 0;
  let unclear = 0;
  let failed = 0;

  if (inputs.length > 0) {
    // @ee resolves per edition (real impl in EE builds, stub in CE); the
    // isEnterprise gate above means the stub path is never reached at runtime.
    const { createGhostUsageClassifier } = await import('@ee/services/inventory/ghostUsageClassifier');
    const outputs = await createGhostUsageClassifier().classifyBatch(tenant, inputs, {
      concurrency: CLASSIFY_CONCURRENCY,
    });

    await withTransaction(knex, async (trx: Knex.Transaction) => {
      for (const out of outputs) {
        if (out.raw === null) {
          // Provider call failed — nothing was billed, leave the ticket
          // classifiable so the next run retries it.
          failed += 1;
          continue;
        }
        const parsed = parseGhostClassification(out.raw);
        if (!parsed) {
          // Billed but unparseable — consume the ticket as 'unclear' so
          // re-runs don't re-bill the same garbage (§17.4).
          unclear += 1;
          await upsertGhostUsageReview(trx, tenant, {
            ticket_id: out.ticket_id,
            ai_classification: 'unclear',
            ai_confidence: null,
            ai_reason: 'Model output could not be parsed',
            ai_model: out.model,
          });
          continue;
        }
        if (parsed.classification === 'unclear') unclear += 1;
        else classified += 1;
        await upsertGhostUsageReview(trx, tenant, {
          ticket_id: out.ticket_id,
          ai_classification: parsed.classification,
          ai_confidence: parsed.confidence,
          ai_reason: parsed.reason,
          ai_model: out.model,
        });
      }
    });
  }

  const remaining = await withTransaction(knex, (trx: Knex.Transaction) =>
    selectClassifiableCandidates(trx, tenant, filters, 100000),
  );

  return {
    attempted: true,
    classified,
    unclear,
    failed,
    remaining_unclassified: remaining.length,
  };
});
