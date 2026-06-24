'use server';

/**
 * Huntress integration server actions: connect, status, routing settings,
 * organization mappings, and manual poll trigger.
 */

import { revalidatePath } from 'next/cache';
import logger from '@alga-psa/core/logger';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { withAuth, hasPermission } from '@alga-psa/auth';
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

// Huntress visibility is gated in the UI via the huntress-rmm-integration
// feature flag; server actions enforce tier + permissions only.
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
  return knex('rmm_integrations').where({ tenant, provider: 'huntress' }).first();
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
    const baseUrl = input.baseUrl?.trim() || HUNTRESS_DEFAULT_BASE_URL;
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
    const existing = await getIntegrationRow(knex, tenant);
    const existingSettings = parseHuntressSettings(existing?.settings);

    // Pre-fill severity → priority by name match when not already configured.
    let severityPriorityMap = existingSettings.severityPriorityMap;
    if (!severityPriorityMap.critical || !severityPriorityMap.high || !severityPriorityMap.low) {
      const priorities = await knex('priorities')
        .where({ tenant, item_type: 'ticket' })
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
      await knex('rmm_integrations')
        .where({ tenant, integration_id: integrationId })
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
      const [inserted] = await knex('rmm_integrations')
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
      knex('rmm_organization_mappings')
        .where({ tenant, integration_id: row.integration_id })
        .count('* as n')
        .first(),
      knex('rmm_organization_mappings')
        .where({ tenant, integration_id: row.integration_id })
        .whereNull('client_id')
        .count('* as n')
        .first(),
      knex('rmm_alerts')
        .where({ tenant, integration_id: row.integration_id })
        .whereIn('status', ['sent', 'auto_remediating'])
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
}

export const updateHuntressSettings = withHuntressAccess(
  async (
    user,
    { tenant },
    updates: HuntressSettingsUpdate
  ): Promise<{ success: boolean; error?: string; routing_config_complete?: boolean }> => {
    await requireSettingsUpdatePermission(user);

    const { knex } = await createTenantKnex();
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
    });
    merged.incidentCursor = current.incidentCursor;

    await knex('rmm_integrations')
      .where({ tenant, integration_id: row.integration_id })
      .update({ settings: JSON.stringify(merged), updated_at: knex.fn.now() });

    revalidatePath(SETTINGS_PATH);
    return { success: true, routing_config_complete: isRoutingConfigComplete(merged) };
  }
);

export const disconnectHuntressIntegration = withHuntressAccess(
  async (user, { tenant }): Promise<{ success: boolean; error?: string }> => {
    await requireSettingsUpdatePermission(user);

    const { knex } = await createTenantKnex();
    const row = await getIntegrationRow(knex, tenant);
    if (!row) return { success: true };

    await knex('rmm_integrations')
      .where({ tenant, integration_id: row.integration_id })
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
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[Huntress] Organization sync failed', { tenant, error: message });
      return { success: false, error: message };
    }
  }
);

export const getHuntressOrganizationMappings = withHuntressAccess(
  async (_user, { tenant }): Promise<RmmOrganizationMapping[]> => {
    const { knex } = await createTenantKnex();
    const rows = await knex('rmm_organization_mappings as rom')
      .join('rmm_integrations as ri', function (this: any) {
        this.on('ri.integration_id', '=', 'rom.integration_id').andOn(
          'ri.tenant',
          '=',
          'rom.tenant'
        );
      })
      .leftJoin('clients as c', function (this: any) {
        this.on('c.client_id', '=', 'rom.client_id').andOn('c.tenant', '=', 'rom.tenant');
      })
      .where('rom.tenant', tenant)
      .where('ri.provider', 'huntress')
      .select('rom.*', 'c.client_name as company_name')
      .orderBy('rom.external_organization_name', 'asc');
    return rows as RmmOrganizationMapping[];
  }
);

export const updateHuntressOrganizationMapping = withHuntressAccess(
  async (
    user,
    { tenant },
    mappingId: string,
    updates: { client_id?: string | null; default_contact_id?: string | null; auto_create_tickets?: boolean }
  ): Promise<{ success: boolean; error?: string }> => {
    await requireSettingsUpdatePermission(user);

    const { knex } = await createTenantKnex();
    const mapping = await knex('rmm_organization_mappings')
      .where({ tenant, mapping_id: mappingId })
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

    await knex('rmm_organization_mappings')
      .where({ tenant, mapping_id: mappingId })
      .update(changes);

    revalidatePath(SETTINGS_PATH);
    return { success: true };
  }
);

export const getHuntressRoutingOptions = withHuntressAccess(
  async (_user, { tenant }) => {
    const { knex } = await createTenantKnex();
    const [boards, priorities, categories, closedStatuses] = await Promise.all([
      knex('boards').where({ tenant }).select('board_id', 'board_name').orderBy('board_name'),
      knex('priorities')
        .where({ tenant, item_type: 'ticket' })
        .select('priority_id', 'priority_name')
        .orderBy('order_number'),
      knex('categories')
        .where({ tenant })
        .select('category_id', 'category_name', 'parent_category', 'board_id')
        .orderBy('category_name'),
      knex('statuses')
        .where({ tenant, item_type: 'ticket', is_closed: true })
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
