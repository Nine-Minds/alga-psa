import { getAdminConnection, getTenantIdBySlug } from '@alga-psa/db';
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

function mapRow(row: TeamsTenantContextRow): TeamsTenantContextResolution {
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

export async function resolveTeamsTenantContext(
  input: ResolveTeamsTenantContextInput
): Promise<TeamsTenantContextResolution> {
  const explicitTenantId = await resolveTenantId(normalizeOptionalString(input.explicitTenantId));
  const microsoftTenantId = normalizeOptionalString(input.microsoftTenantId);
  const db = await getAdminConnection();

  let rowsQuery = db<TeamsTenantContextRow>('teams_integrations as teams')
    .join('microsoft_profiles as profiles', function joinSelectedProfile() {
      this.on('teams.tenant', '=', 'profiles.tenant').andOn('teams.selected_profile_id', '=', 'profiles.profile_id');
    })
    .select(
      'teams.tenant',
      'teams.install_status',
      'teams.enabled_capabilities',
      'teams.app_id',
      'teams.bot_id',
      'profiles.tenant_id as microsoft_tenant_id'
    )
    .where('profiles.is_archived', false);

  if (explicitTenantId) {
    rowsQuery = rowsQuery.where('teams.tenant', explicitTenantId);
  }

  if (microsoftTenantId) {
    rowsQuery = rowsQuery.where('profiles.tenant_id', microsoftTenantId);
  }

  const rows = (await rowsQuery) || [];
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
