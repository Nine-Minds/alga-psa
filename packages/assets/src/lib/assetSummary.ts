import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { AssetSummaryMetrics, HealthStatus, SecurityStatus, WarrantyStatus } from '@alga-psa/types';
import { ASSET_SECURITY_FIELDS, assetSecurityRecordSource } from '@alga-psa/authorization/recordProjection';

export interface AssetSummaryFacts {
  asset: {
    asset_type: string;
    agent_status: string | null;
    last_seen_at: string | Date | null;
    warranty_end_date: string | Date | null;
  };
  extensionData: AssetSecurityFacts | null;
}

interface AssetSecurityFacts {
  antivirus_status?: string | null;
  antivirus_product?: string | null;
  pending_patches?: number | null;
  failed_patches?: number | null;
}

/** Load the raw inputs once; the authorized caller projects the calculated response under its retained policy. */
export async function loadAssetSummaryFacts(knex: Knex, tenant: string, assetId: string): Promise<AssetSummaryFacts> {
  const db = tenantDb(knex, tenant);
  const asset = await db.table('assets').where({ asset_id: assetId })
    .select('asset_type', 'agent_status', 'last_seen_at', 'warranty_end_date').first();
  if (!asset) throw new Error('Asset not found');

  const source = assetSecurityRecordSource(asset.asset_type);
  const extensionData = source
    ? await db.table(source.resource[0]).where({ asset_id: assetId }).select(...ASSET_SECURITY_FIELDS).first()
    : null;
  return { asset, extensionData: extensionData ?? null };
}

function assetSummaryTicketQuery(knex: Knex, tenant: string, assetId: string) {
  const db = tenantDb(knex, tenant);
  const query = db.table('asset_associations')
    .where('asset_associations.asset_id', assetId)
    .where('asset_associations.entity_type', 'ticket');
  db.tenantJoin(query, 'tickets', 'tickets.ticket_id', 'asset_associations.entity_id');
  db.tenantJoin(query, 'statuses', 'statuses.status_id', 'tickets.status_id');
  return query;
}

/** Legacy UI action count; REST counts projected candidates from the same joins instead. */
export async function countOpenAssetTickets(knex: Knex, tenant: string, assetId: string): Promise<number> {
  const row = await assetSummaryTicketQuery(knex, tenant, assetId)
    .where('statuses.is_closed', false).count('* as count').first();
  return Number(row?.count ?? 0);
}

/** Include all candidates so hidden status predicates cannot influence a REST count before projection. */
export async function loadAssetSummaryTickets(knex: Knex, tenant: string, assetId: string): Promise<Record<string, any>[]> {
  return assetSummaryTicketQuery(knex, tenant, assetId).select(
    'tickets.*', 'asset_associations.asset_id', 'asset_associations.entity_id', 'statuses.is_closed as status_is_closed',
  );
}

export function calculateAssetSummaryMetrics(facts: AssetSummaryFacts, openTicketsCount: number): AssetSummaryMetrics {
  return {
    ...calculateHealthStatus(facts.asset),
    ...calculateSecurityStatus(facts.extensionData),
    ...calculateWarrantyStatus(facts.asset.warranty_end_date),
    open_tickets_count: openTicketsCount,
  };
}

/**
* Calculate health status based on agent status and last seen time
*/
function calculateHealthStatus(asset: {
  agent_status: string | null;
  last_seen_at: string | Date | null;
}): { health_status: HealthStatus; health_reason: string | null } {
  // If no RMM data, return unknown
  if (!asset.agent_status) {
    return { health_status: 'unknown', health_reason: 'No RMM data available' };
  }

  // Check agent status
  if (asset.agent_status === 'offline' || asset.agent_status === 'overdue') {
    const stateLabel = asset.agent_status === 'overdue' ? 'overdue' : 'offline';

    // Check how long it's been offline
    if (asset.last_seen_at) {
      const lastSeen = new Date(asset.last_seen_at);
      const now = new Date();
      const hoursSinceLastSeen = (now.getTime() - lastSeen.getTime()) / (1000 * 60 * 60);

      if (hoursSinceLastSeen > 72) {
        return {
          health_status: 'critical',
          health_reason: `Device ${stateLabel} for ${Math.floor(hoursSinceLastSeen / 24)} days`,
        };
      } else if (hoursSinceLastSeen > 24) {
        return {
          health_status: 'warning',
          health_reason: `Device ${stateLabel} for ${Math.floor(hoursSinceLastSeen)} hours`,
        };
      }
    }
    return { health_status: 'warning', health_reason: `Device ${stateLabel}` };
  }

  // Agent is online - consider healthy
  return { health_status: 'healthy', health_reason: null };
}

/**
* Calculate security status based on antivirus and patch status
*/
function calculateSecurityStatus(extensionData: AssetSecurityFacts | null): { security_status: SecurityStatus; security_issues: string[] } {
  const issues: string[] = [];

  if (!extensionData) {
    return { security_status: 'secure', security_issues: [] };
  }

  // Check antivirus status
  if (extensionData.antivirus_status === 'at_risk') {
    issues.push('Antivirus protection at risk');
  } else if (!extensionData.antivirus_product) {
    issues.push('No antivirus detected');
  }

  // Check patch status
  if (extensionData.failed_patches && extensionData.failed_patches > 0) {
    issues.push(`${extensionData.failed_patches} failed patches`);
  }

  if (extensionData.pending_patches && extensionData.pending_patches > 10) {
    issues.push(`${extensionData.pending_patches} pending patches`);
  }

  // Determine security status based on issues
  let security_status: SecurityStatus = 'secure';
  if (issues.length > 0) {
    // Critical if AV is at risk or many failed patches
    if (
      extensionData.antivirus_status === 'at_risk' ||
      (extensionData.failed_patches && extensionData.failed_patches > 5)
    ) {
      security_status = 'critical';
    } else {
      security_status = 'at_risk';
    }
  }

  return { security_status, security_issues: issues };
}

/**
* Calculate warranty status based on warranty end date
*/
function calculateWarrantyStatus(warrantyEndDate: string | Date | null): {
  warranty_status: WarrantyStatus;
  warranty_days_remaining: number | null;
} {
  if (!warrantyEndDate) {
    return { warranty_status: 'unknown', warranty_days_remaining: null };
  }

  const endDate = new Date(warrantyEndDate);
  const now = new Date();
  const daysRemaining = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysRemaining < 0) {
    return { warranty_status: 'expired', warranty_days_remaining: daysRemaining };
  } else if (daysRemaining <= 90) {
    return { warranty_status: 'expiring_soon', warranty_days_remaining: daysRemaining };
  } else {
    return { warranty_status: 'active', warranty_days_remaining: daysRemaining };
  }
}
