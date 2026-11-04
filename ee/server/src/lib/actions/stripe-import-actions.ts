'use server';

/**
 * Server actions for importing existing Stripe customers and their saved cards (EE).
 *
 * preview -> (operator review + per-row attestation) -> execute. Execute re-classifies server-side and
 * refuses to run unless the result is identical to the plan the operator previewed.
 */

import { createTenantKnex } from '@/lib/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { tenantDb } from '@alga-psa/db';
import { setClientAutopay } from '@alga-psa/clients/actions';
import {
  StripeCustomerImportService,
  computePlanDigest,
  type ImportRowResult,
} from '../payments/StripeCustomerImportService';
import type { ImportPlan, MatchAmbiguity, MatchProposal } from '../payments/stripeImportClassifier';
import { resolveImportRows, type RawImportRow } from '../payments/stripeImportRows';

interface ActionResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function assertCanImport(user: any, knex: any): Promise<void> {
  // Import writes tenant-wide billing data, so it needs the same permission as managing auto-pay.
  if (!(await hasPermission(user, 'billing', 'update', knex))) {
    throw new Error('Permission denied: Cannot import Stripe customers');
  }
}

export const previewStripeImportAction = withAuth(async (
  user,
  { tenant },
  input: { rows: RawImportRow[] },
): Promise<ActionResult<{ plan: ImportPlan; digest: string }>> => {
  try {
    const { knex } = await createTenantKnex();
    await assertCanImport(user, knex);
    const service = await StripeCustomerImportService.create(tenant);
    const rows = resolveImportRows(input.rows, (await service.loadAlgaState()).profiles);
    const plan = await service.preview(rows);
    return { success: true, data: { plan, digest: computePlanDigest(plan) } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to preview import' };
  }
});

export const proposeStripeImportMatchesAction = withAuth(async (
  user,
  { tenant },
): Promise<ActionResult<{ proposals: MatchProposal[]; ambiguous: MatchAmbiguity[]; truncated: boolean; labels: Record<string, { clientName: string; profileName: string }> }>> => {
  try {
    const { knex } = await createTenantKnex();
    await assertCanImport(user, knex);
    const service = await StripeCustomerImportService.create(tenant);
    return { success: true, data: await service.proposeMatches() };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to match Stripe customers' };
  }
});

export const executeStripeImportAction = withAuth(async (
  user,
  { tenant },
  input: { rows: RawImportRow[]; planDigest: string; attestedRowIds: string[] },
): Promise<ActionResult<{ results: ImportRowResult[] }>> => {
  try {
    const { knex } = await createTenantKnex();
    await assertCanImport(user, knex);
    const service = await StripeCustomerImportService.create(tenant);
    const rows = resolveImportRows(input.rows, (await service.loadAlgaState()).profiles);
    const plan = await service.preview(rows);
    if (computePlanDigest(plan) !== input.planDigest) {
      return { success: false, error: 'The import plan changed since it was previewed. Preview again before importing.' };
    }
    const config = await tenantDb(knex, tenant).table('payment_provider_configs').where({ provider_type: 'stripe', is_enabled: true }).first('settings');
    const consentTextVersion = String((config?.settings as any)?.autopayConsentTextVersion ?? '1');
    const results = await service.execute(plan, {
      attestedRowIds: input.attestedRowIds,
      // Enrollment goes through the existing setClientAutopay so its permission check, audit trail and workflow events fire.
      enroll: async (row, paymentMethodId) => {
        await setClientAutopay({
          clientId: row.clientId, billingProfileId: row.billingProfileId, paymentMethodId,
          enabled: true, consentTextVersion, clientAuthorized: true,
        });
      },
    });
    return { success: true, data: { results } };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Failed to import Stripe customers' };
  }
});
