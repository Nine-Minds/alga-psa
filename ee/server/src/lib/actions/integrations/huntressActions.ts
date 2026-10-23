'use server';

/**
 * Huntress integration server actions: connect, status, routing settings,
 * organization mappings, and manual poll trigger.
 */

import { revalidatePath } from 'next/cache';
import type { Knex } from 'knex';
import { moveRmmOrganizationAssets } from '@alga-psa/shared/rmm/moveRmmOrganizationAssets';
import { resolveMappingBillingProfileId } from '@alga-psa/shared/rmm/mappingBillingProfile';
import { isRmmContactAssignmentMode } from '@alga-psa/shared/rmm/userMatching';
import axios from 'axios';
import logger from '@alga-psa/core/logger';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { tenantDb } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { TIER_FEATURES } from '@alga-psa/types';
import { createTenantKnex } from '@/lib/db';
import { assertTierAccess } from 'server/src/lib/tier-gating/assertTierAccess';
import {
  HuntressClient,
  HUNTRESS_API_KEY_SECRET,
  HUNTRESS_API_SECRET_SECRET,
  HUNTRESS_DEFAULT_BASE_URL,
  createHuntressClient,
} from '../../integrations/huntress/huntressClient';
import {
  type HuntressSettings,
  type HuntressSeverityPriorityMap,
  isRoutingConfigComplete,
  parseHuntressSettings,
  prefillSeverityPriorityMap,
} from '../../integrations/huntress/settings';
import { syncHuntressOrganizations } from '../../integrations/huntress/organizations/orgSync';
import {
  pollHuntressIncidents,
  type HuntressPollResult,
} from '../../integrations/huntress/incidents/incidentPoller';
import type { RmmOrganizationMapping } from '../../../interfaces/rmm.interfaces';

const SETTINGS_PATH = '/msp/settings';

function huntressActionErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (!status) {
      return 'Unable to reach Huntress. Check network connectivity and try again.';
    }
    if (status === 401 || status === 403) {
      return 'Huntress rejected the API credentials. Check the API key and secret.';
    }
    if (status === 404) {
      return 'The requested Huntress resource was not found. Refresh the integration and try again.';
    }
    if (status === 429) {
      return 'Huntress rate limit reached. Please try again later.';
    }
    if (status >= 500) {
      return 'Huntress is temporarily unavailable. Please try again later.';
    }
    return fallback;
  }

  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (message.startsWith('You do not have permission')) {
    return message;
  }
  return fallback;
}

// Huntress visibility in the UI is EE-gated (requiresEnterprise); server
// actions enforce tier + permissions only.
function withHuntressAccess<TArgs extends unknown[], TResult>(
  handler: (user: any, context: { tenant: string }, ...args: TArgs) => Promise<TResult>
) {
  return withAuth(async (user, context, ...args: TArgs): Promise<TResult> => {
    await assertTierAccess(TIER_FEATURES.INTEGRATIONS);
    return handler(user, context as { tenant: string }, ...args);
  });
}

async function requireSettingsUpdatePermission(user: any): Promise<void> {
  const allowed = await hasPermission(user, 'settings', 'update');
  if (!allowed) {
    throw new Error('You do not have permission to manage integrations');
  }
}

async function getIntegrationRow(knex: any, tenant: string) {
  return tenantDb(knex, tenant).table('rmm_integrations').where({ provider: 'huntress' }).first();
}

export interface HuntressConnectionStatus {
  is_connected: boolean;
  integration_id?: string;
  account_name?: string;
  account_subdomain?: string;
  sync_status?: string;
  sync_error?: string | null;
  last_poll_at?: string | null;
  routing_config_complete: boolean;
  settings: HuntressSettings | null;
  organization_count: number;
  unmapped_count: number;
  open_alert_count: number;
}

export const connectHuntress = withHuntressAccess(
  async (
    user,
    { tenant },
    input: { apiKey: string; apiSecret: string; baseUrl?: string }
  ): Promise<{ success: boolean; error?: string; accountName?: string }> => {
    await requireSettingsUpdatePermission(user);

    const apiKey = input.apiKey?.trim();
    const apiSecret = input.apiSecret?.trim();
    const baseUrl =
      input.baseUrl?.trim() || process.env.HUNTRESS_API_BASE_URL || HUNTRESS_DEFAULT_BASE_URL;
    if (!apiKey || !apiSecret) {
      return { success: false, error: 'API key and secret are required' };
    }

    // Validate the credentials before storing anything.
    let account;
    try {
      account = await new HuntressClient({ apiKey, apiSecret, baseUrl }).getAccount();
    } catch (error) {
      logger.warn('[Huntress] Credential validation failed', { tenant, error });
      return {
        success: false,
        error: 'Could not authenticate with Huntress — check the API key and secret',
      };
    }

    const secretProvider = await getSecretProviderInstance();
    await secretProvider.setTenantSecret(tenant, HUNTRESS_API_KEY_SECRET, apiKey);
    await secretProvider.setTenantSecret(tenant, HUNTRESS_API_SECRET_SECRET, apiSecret);

    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, tenant);
    const existing = await getIntegrationRow(knex, tenant);
    const existingSettings = parseHuntressSettings(existing?.settings);

    // Pre-fill severity → priority by name match when not already configured.
    let severityPriorityMap = existingSettings.severityPriorityMap;
    if (!severityPriorityMap.critical || !severityPriorityMap.high || !severityPriorityMap.low) {
      const priorities = await db.table('priorities')
        .where({ item_type: 'ticket' })
        .select('priority_id', 'priority_name');
      severityPriorityMap = { ...prefillSeverityPriorityMap(priorities), ...severityPriorityMap };
    }

    const settings: HuntressSettings = {
      ...existingSettings,
      accountName: account.name,
      accountSubdomain: account.subdomain,
      severityPriorityMap,
    };

    let integrationId: string;
    if (existing) {
      integrationId = existing.integration_id;
      await db.table('rmm_integrations')
        .where({ integration_id: integrationId })
        .update({
          instance_url: baseUrl,
          is_active: true,
          connected_at: knex.fn.now(),
          sync_status: 'pending',
          sync_error: null,
          settings: JSON.stringify(settings),
          updated_at: knex.fn.now(),
        });
    } else {
      const [inserted] = await db.table('rmm_integrations')
        .insert({
          tenant,
          provider: 'huntress',
          instance_url: baseUrl,
          is_active: true,
          connected_at: knex.fn.now(),
          sync_status: 'pending',
          settings: JSON.stringify(settings),
        })
        .returning('integration_id');
      integrationId = (inserted as { integration_id: string }).integration_id;
    }

    // Initial org discovery is best-effort; the UI has a re-sync button.
    try {
      const client = new HuntressClient({ apiKey, apiSecret, baseUrl });
      await syncHuntressOrganizations(knex, tenant, integrationId, client);
    } catch (error) {
      logger.warn('[Huntress] Initial organization sync failed', { tenant, error });
    }

    revalidatePath(SETTINGS_PATH);
    return { success: true, accountName: account.name };
  }
);

export const getHuntressConnectionStatus = withHuntressAccess(
  async (_user, { tenant }): Promise<HuntressConnectionStatus> => {
    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, tenant);
    const row = await getIntegrationRow(knex, tenant);

    if (!row || !row.is_active) {
      return {
        is_connected: false,
        routing_config_complete: false,
        settings: null,
        organization_count: 0,
        unmapped_count: 0,
        open_alert_count: 0,
      };
    }

    const settings = parseHuntressSettings(row.settings);
    const [orgCount, unmappedCount, openAlertCount] = await Promise.all([
      db.table('rmm_organization_mappings')
        .where({ integration_id: row.integration_id })
        .count('* as n')
        .first(),
      db.table('rmm_organization_mappings')
        .where({ integration_id: row.integration_id })
        .whereNull('client_id')
        .count('* as n')
        .first(),
      db.table('rmm_alerts')
        .where({ integration_id: row.integration_id })
        // Open incidents (sent, auto_remediating) and open escalations
        // (open, overdue); the two status sets don't overlap.
        .whereIn('status', ['sent', 'auto_remediating', 'open', 'overdue'])
        .count('* as n')
        .first(),
    ]);

    return {
      is_connected: true,
      integration_id: row.integration_id,
      account_name: settings.accountName,
      account_subdomain: settings.accountSubdomain,
      sync_status: row.sync_status,
      sync_error: row.sync_error,
      last_poll_at: row.last_incremental_sync_at
        ? new Date(row.last_incremental_sync_at).toISOString()
        : null,
      routing_config_complete: isRoutingConfigComplete(settings),
      settings,
      organization_count: Number(orgCount?.n ?? 0),
      unmapped_count: Number(unmappedCount?.n ?? 0),
      open_alert_count: Number(openAlertCount?.n ?? 0),
    };
  }
);

export interface HuntressSettingsUpdate {
  boardId?: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
  fallbackClientId?: string;
  fallbackBoardId?: string;
  severityPriorityMap?: HuntressSeverityPriorityMap;
  autoCloseTickets?: boolean;
  closedStatusId?: string | null;
  pollIntervalMinutes?: number;
  backfillDays?: number;
  ingestEscalations?: boolean;
}

export const updateHuntressSettings = withHuntressAccess(
  async (
    user,
    { tenant },
    updates: HuntressSettingsUpdate
  ): Promise<{ success: boolean; error?: string; routing_config_complete?: boolean }> => {
    await requireSettingsUpdatePermission(user);

    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, tenant);
    const row = await getIntegrationRow(knex, tenant);
    if (!row) return { success: false, error: 'Huntress is not connected' };

    const current = parseHuntressSettings(row.settings);
    // Only routing/poll keys are user-editable; cursor and account identity
    // are owned by the poller and connect flow.
    const merged = parseHuntressSettings({
      ...current,
      ...(updates.boardId !== undefined ? { boardId: updates.boardId } : {}),
      ...(updates.categoryId !== undefined ? { categoryId: updates.categoryId } : {}),
      ...(updates.subcategoryId !== undefined ? { subcategoryId: updates.subcategoryId } : {}),
      ...(updates.fallbackClientId !== undefined
        ? { fallbackClientId: updates.fallbackClientId }
        : {}),
      ...(updates.fallbackBoardId !== undefined
        ? { fallbackBoardId: updates.fallbackBoardId }
        : {}),
      ...(updates.severityPriorityMap !== undefined
        ? { severityPriorityMap: { ...current.severityPriorityMap, ...updates.severityPriorityMap } }
        : {}),
      ...(updates.autoCloseTickets !== undefined
        ? { autoCloseTickets: updates.autoCloseTickets }
        : {}),
      ...(updates.closedStatusId !== undefined ? { closedStatusId: updates.closedStatusId } : {}),
      ...(updates.pollIntervalMinutes !== undefined
        ? { pollIntervalMinutes: updates.pollIntervalMinutes }
        : {}),
      ...(updates.backfillDays !== undefined ? { backfillDays: updates.backfillDays } : {}),
      ...(updates.ingestEscalations !== undefined
        ? { ingestEscalations: updates.ingestEscalations }
        : {}),
    });
    merged.incidentCursor = current.incidentCursor;
    // Turning escalations (back) on starts from the backfill window rather
    // than a cursor left over from an earlier enabled period, which could be
    // months old and flood the board with stale open escalations.
    merged.escalationCursor =
      merged.ingestEscalations && !current.ingestEscalations
        ? undefined
        : current.escalationCursor;

    await db.table('rmm_integrations')
      .where({ integration_id: row.integration_id })
      .update({ settings: JSON.stringify(merged), updated_at: knex.fn.now() });

    revalidatePath(SETTINGS_PATH);
    return { success: true, routing_config_complete: isRoutingConfigComplete(merged) };
  }
);

export const disconnectHuntressIntegration = withHuntressAccess(
  async (user, { tenant }): Promise<{ success: boolean; error?: string }> => {
    await requireSettingsUpdatePermission(user);

    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, tenant);
    const row = await getIntegrationRow(knex, tenant);
    if (!row) return { success: true };

    await db.table('rmm_integrations')
      .where({ integration_id: row.integration_id })
      .update({ is_active: false, updated_at: knex.fn.now() });

    const secretProvider = await getSecretProviderInstance();
    await secretProvider.deleteTenantSecret(tenant, HUNTRESS_API_KEY_SECRET);
    await secretProvider.deleteTenantSecret(tenant, HUNTRESS_API_SECRET_SECRET);

    revalidatePath(SETTINGS_PATH);
    return { success: true };
  }
);

export const syncHuntressOrganizationMappings = withHuntressAccess(
  async (
    user,
    { tenant }
  ): Promise<{ success: boolean; error?: string; created?: number; autoMatched?: number }> => {
    await requireSettingsUpdatePermission(user);

    const { knex } = await createTenantKnex();
    const row = await getIntegrationRow(knex, tenant);
    if (!row || !row.is_active) return { success: false, error: 'Huntress is not connected' };

    const client = await createHuntressClient(tenant);
    if (!client) return { success: false, error: 'Huntress credentials are missing' };

    try {
      const result = await syncHuntressOrganizations(knex, tenant, row.integration_id, client);
      revalidatePath(SETTINGS_PATH);
      return { success: true, created: result.created, autoMatched: result.autoMatched };
    } catch (error) {
      const message = huntressActionErrorMessage(error, 'Unable to sync Huntress organizations.');
      logger.error('[Huntress] Organization sync failed', {
        tenant,
        error: error instanceof Error ? error.message : String(error),
      });
      return { success: false, error: message };
    }
  }
);

export const getHuntressOrganizationMappings = withHuntressAccess(
  async (_user, { tenant }): Promise<RmmOrganizationMapping[]> => {
    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, tenant);
    const mappingsQuery = db.table('rmm_organization_mappings as rom');
    db.tenantJoin(mappingsQuery, 'rmm_integrations as ri', 'ri.integration_id', 'rom.integration_id');
    db.tenantJoin(mappingsQuery, 'clients as c', 'c.client_id', 'rom.client_id', { type: 'left' });

    const rows = await mappingsQuery
      .where('ri.provider', 'huntress')
      .select('rom.*', 'c.client_name as company_name')
      .orderBy('rom.external_organization_name', 'asc');
    return rows as unknown as RmmOrganizationMapping[];
  }
);

export const updateHuntressOrganizationMapping = withHuntressAccess(
  async (
    user,
    { tenant },
    mappingId: string,
    updates: {
      client_id?: string | null;
      default_contact_id?: string | null;
      auto_create_tickets?: boolean;
      /** FR-D3: off | suggest | auto. */
      contact_assignment_mode?: string;
      /** FR-F1: the organization's billing profile, or null. */
      billing_profile_id?: string | null;
    }
  ): Promise<{ success: boolean; error?: string }> => {
    await requireSettingsUpdatePermission(user);

    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, tenant);
    const mapping = await db.table('rmm_organization_mappings')
      .where({ mapping_id: mappingId })
      .first();
    if (!mapping) return { success: false, error: 'Mapping not found' };

    const changes: Record<string, unknown> = { updated_at: knex.fn.now() };
    if (updates.client_id !== undefined) {
      changes.client_id = updates.client_id;
      // A manual choice supersedes any auto-match flag.
      const metadata =
        typeof mapping.metadata === 'string'
          ? JSON.parse(mapping.metadata || '{}')
          : mapping.metadata ?? {};
      changes.metadata = JSON.stringify({ ...metadata, auto_matched: false });
    }
    if (updates.auto_create_tickets !== undefined) {
      changes.auto_create_tickets = updates.auto_create_tickets;
    }
    if (updates.default_contact_id !== undefined) {
      changes.default_contact_id = updates.default_contact_id;
    }
    if (updates.contact_assignment_mode !== undefined) {
      if (!isRmmContactAssignmentMode(updates.contact_assignment_mode)) {
        return { success: false, error: 'Invalid people mode' };
      }
      changes.contact_assignment_mode = updates.contact_assignment_mode;
    }
    // FR-G4: a client change moves the organization's assets in the same
    // transaction as the mapping update, so the two can never disagree.
    await withTransaction(knex, async (trx: Knex.Transaction) => {
      const trxDb = tenantDb(trx, tenant);
      const existing = await trxDb.table('rmm_organization_mappings')
        .where({ mapping_id: mappingId })
        .first('client_id', 'integration_id', 'external_organization_id');

      // FR-F1: validated against the client the mapping ends up on, and
      // cleared by a client change whatever else the patch carries.
      const billingProfileId = await resolveMappingBillingProfileId(trx, tenant, {
        existingClientId: existing?.client_id ?? null,
        nextClientId: updates.client_id,
        billingProfileId: updates.billing_profile_id,
      });
      if (typeof billingProfileId !== 'undefined') changes.billing_profile_id = billingProfileId;

      await trxDb.table('rmm_organization_mappings')
        .where({ mapping_id: mappingId })
        .update({ ...changes, updated_at: trx.fn.now() });

      const nextClientId = changes.client_id as string | null | undefined;
      if (nextClientId && existing && String(existing.client_id ?? '') !== String(nextClientId)) {
        await moveRmmOrganizationAssets(trx, tenant, {
          integrationId: String(existing.integration_id),
          provider: 'huntress',
          externalOrganizationId: String(existing.external_organization_id),
          newClientId: String(nextClientId),
          actorUserId: (user as { user_id?: string }).user_id ?? null,
        });
      }
    });

    revalidatePath(SETTINGS_PATH);
    return { success: true };
  }
);

export const getHuntressRoutingOptions = withHuntressAccess(
  async (_user, { tenant }) => {
    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, tenant);
    const [boards, priorities, categories, closedStatuses] = await Promise.all([
      db.table('boards').select('board_id', 'board_name').orderBy('board_name'),
      db.table('priorities')
        .where({ item_type: 'ticket' })
        .select('priority_id', 'priority_name')
        .orderBy('order_number'),
      db.table('categories')
        .select('category_id', 'category_name', 'parent_category', 'board_id')
        .orderBy('category_name'),
      db.table('statuses')
        .where({ item_type: 'ticket', is_closed: true })
        .select('status_id', 'name as status_name')
        .orderBy('order_number'),
    ]);
    return { boards, priorities, categories, closedStatuses };
  }
);

export const runHuntressPollNow = withHuntressAccess(
  async (user, { tenant }): Promise<HuntressPollResult & { error?: string }> => {
    await requireSettingsUpdatePermission(user);

    const { knex } = await createTenantKnex();
    const row = await getIntegrationRow(knex, tenant);
    if (!row || !row.is_active) {
      return { success: false, processed: 0, failed: 0, error: 'Huntress is not connected' };
    }

    const result = await pollHuntressIncidents({
      tenantId: tenant,
      integrationId: row.integration_id,
      trigger: 'manual',
    });
    revalidatePath(SETTINGS_PATH);
    return result;
  }
);
