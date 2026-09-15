import { getAdminConnection, getTenantIdBySlug, tenantDb } from '@alga-psa/db';
import {
  TEAMS_CAPABILITIES,
  type TeamsCapability,
  type TeamsInstallStatus,
} from './teamsShared';

interface TeamsTenantContextRow {
  tenant: string;
  install_status: TeamsInstallStatus;
  enabled_capabilities: unknown;
  app_id: string | null;
  bot_id: string | null;
  microsoft_tenant_id: string;
}

export type TeamsTenantContextResolution =
  | {
      status: 'resolved';
      tenantId: string;
      installStatus: TeamsInstallStatus;
      enabledCapabilities: TeamsCapability[];
      appId: string | null;
      botId: string | null;
      microsoftTenantId: string;
      /**
       * Set only when the tenant was discovered through the sender's own
       * (client) Microsoft tenant: the single active client whose
       * clients.entra_tenant_id equals the VERIFIED sender tid. Downstream
       * guest intake uses it for client-level attribution.
       */
      entraMatchedClientId?: string;
    }
  | {
      status: 'not_configured' | 'ambiguous';
      tenantId: string | null;
      microsoftTenantId: string | null;
      message: string;
    };

interface ResolveTeamsTenantContextInput {
  explicitTenantId?: string | null;
  microsoftTenantId?: string | null;
  requiredCapability?: TeamsCapability;
  /**
   * The sender's Microsoft tenant id taken ONLY from the verified Bot
   * Framework JWT tid claim — never from activity body fields. When no
   * teams_integrations row matches the sender tid, this enables the
   * clients.entra_tenant_id fallback discovery so employees of a client's own
   * Microsoft tenant can reach the MSP's bot for guest intake.
   */
  verifiedSenderMicrosoftTenantId?: string | null;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeCapabilities(value: unknown): TeamsCapability[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const supported = new Set(TEAMS_CAPABILITIES as readonly string[]);
  return value.filter((entry): entry is TeamsCapability => typeof entry === 'string' && supported.has(entry));
}

async function resolveTenantId(explicitTenantId: string | null): Promise<string | null> {
  if (!explicitTenantId) {
    return null;
  }

  const slugResolvedTenantId = await getTenantIdBySlug(explicitTenantId);
  return slugResolvedTenantId || explicitTenantId;
}

type ResolvedTeamsTenantContext = Extract<TeamsTenantContextResolution, { status: 'resolved' }>;

function mapRow(row: TeamsTenantContextRow): ResolvedTeamsTenantContext {
  return {
    status: 'resolved',
    tenantId: row.tenant,
    installStatus: row.install_status,
    enabledCapabilities: normalizeCapabilities(row.enabled_capabilities),
    appId: row.app_id || null,
    botId: row.bot_id || null,
    microsoftTenantId: row.microsoft_tenant_id,
  };
}

function isRowEligible(row: TeamsTenantContextRow, requiredCapability?: TeamsCapability): boolean {
  if (row.install_status !== 'active') {
    return false;
  }

  if (!requiredCapability) {
    return true;
  }

  return normalizeCapabilities(row.enabled_capabilities).includes(requiredCapability);
}

type AdminDb = Awaited<ReturnType<typeof getAdminConnection>>;

async function queryTeamsIntegrationRows(
  db: AdminDb,
  explicitTenantId: string | null,
  microsoftTenantId: string | null
): Promise<TeamsTenantContextRow[]> {
  const teamsDb = tenantDb(db, explicitTenantId ?? 'teams-tenant-context-discovery');
  const rowsQuery = (
    explicitTenantId
      ? teamsDb.table<TeamsTenantContextRow>('teams_integrations as teams')
      : teamsDb.unscoped<TeamsTenantContextRow>(
          'teams_integrations as teams',
          'Teams tenant context discovery resolves the PSA tenant before tenant-scoped facade construction'
        )
  )
    .select(
      'teams.tenant',
      'teams.install_status',
      'teams.enabled_capabilities',
      'teams.app_id',
      'teams.bot_id',
      'profiles.tenant_id as microsoft_tenant_id'
    )
    .where('profiles.is_archived', false);

  teamsDb.tenantJoin(rowsQuery, 'microsoft_profiles as profiles', 'teams.selected_profile_id', 'profiles.profile_id');
  if (microsoftTenantId) {
    rowsQuery.where('profiles.tenant_id', microsoftTenantId);
  }

  return (await rowsQuery) || [];
}

export interface TeamsClientTenantMatch {
  tenant: string;
  clientId: string;
}

/**
 * Cross-tenant discovery for senders inside a CLIENT's own Microsoft tenant.
 * Their verified tid matches no teams_integrations profile — the tid is the
 * only handle we have, so we must discover the owning PSA tenant from
 * clients.entra_tenant_id before tenant context exists. Exactly one active
 * client in exactly one PSA tenant may claim the tid; zero or multiple
 * matches (within or across PSA tenants) return null so resolution keeps
 * today's unresolved behavior.
 */
export async function discoverTeamsClientTenantByEntraTenantId(
  verifiedMicrosoftTenantId: string | null | undefined
): Promise<TeamsClientTenantMatch | null> {
  const tid = normalizeOptionalString(verifiedMicrosoftTenantId);
  if (!tid) {
    return null;
  }

  const db = await getAdminConnection();
  const rows = await tenantDb(db, 'teams-client-tenant-discovery')
    .unscoped<{ tenant: string; client_id: string }>(
      'clients',
      'Teams guest intake discovers the PSA tenant owning a client Entra tenant id before tenant context exists'
    )
    .where('entra_tenant_id', tid)
    .andWhere('is_inactive', false)
    .select('tenant', 'client_id')
    .limit(2);

  if (!Array.isArray(rows) || rows.length !== 1) {
    return null;
  }
  return { tenant: rows[0].tenant, clientId: rows[0].client_id };
}

export async function resolveTeamsTenantContext(
  input: ResolveTeamsTenantContextInput
): Promise<TeamsTenantContextResolution> {
  const explicitTenantId = await resolveTenantId(normalizeOptionalString(input.explicitTenantId));
  const microsoftTenantId = normalizeOptionalString(input.microsoftTenantId);
  const db = await getAdminConnection();
  const rows = await queryTeamsIntegrationRows(db, explicitTenantId, microsoftTenantId);
  const eligibleRows = rows.filter((row) => isRowEligible(row, input.requiredCapability));

  if (eligibleRows.length === 1) {
    return mapRow(eligibleRows[0]);
  }

  if (eligibleRows.length > 1) {
    return {
      status: 'ambiguous',
      tenantId: explicitTenantId,
      microsoftTenantId,
      message: 'Multiple PSA tenants match this Teams bot request. Use a tenant-specific bot endpoint or finish Teams setup again.',
    };
  }

  if (rows.length === 0) {
    // No teams_integrations profile matches the sender's Microsoft tenant.
    // If the VERIFIED sender tid maps to exactly one active client of exactly
    // one PSA tenant (clients.entra_tenant_id), resolve to that tenant so
    // client-tenant employees can reach the MSP's bot for guest intake. Any
    // ambiguity keeps today's unresolved behavior.
    const clientMatch = await discoverTeamsClientTenantByEntraTenantId(
      input.verifiedSenderMicrosoftTenantId
    );
    if (clientMatch && (!explicitTenantId || clientMatch.tenant === explicitTenantId)) {
      const clientTenantRows = await queryTeamsIntegrationRows(db, clientMatch.tenant, null);
      const clientTenantEligible = clientTenantRows.filter((row) =>
        isRowEligible(row, input.requiredCapability)
      );
      if (clientTenantEligible.length === 1) {
        return { ...mapRow(clientTenantEligible[0]), entraMatchedClientId: clientMatch.clientId };
      }
    }

    return {
      status: 'not_configured',
      tenantId: explicitTenantId,
      microsoftTenantId,
      message: explicitTenantId
        ? 'Teams is not configured for this tenant yet.'
        : 'No active Teams integration matches this Microsoft tenant.',
    };
  }

  return {
    status: 'not_configured',
    tenantId: explicitTenantId || rows[0]?.tenant || null,
    microsoftTenantId: microsoftTenantId || rows[0]?.microsoft_tenant_id || null,
    message:
      input.requiredCapability === 'personal_bot'
        ? 'The Teams personal bot is not active for this tenant.'
        : 'Teams is not active for this tenant.',
  };
}
