'use server';

/**
 * Asset Summary Actions
 *
 * Server actions for computing asset summary metrics (health, security, warranty).
 *
 * @see ee/docs/plans/asset-detail-view-enhancement.md §1.4.1
 */

import { createTenantKnex } from 'server/src/lib/db';
import {
  AssetSummaryMetrics,
  HealthStatus,
  SecurityStatus,
  WarrantyStatus,
} from '../../../interfaces/asset.interfaces';

/**
 * Get summary metrics for an asset
 * Computes health status, open tickets, security status, and warranty status
 */
export async function getAssetSummaryMetrics(assetId: string): Promise<AssetSummaryMetrics> {
  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('No tenant found');
  }

  try {
    // Get asset info
    const asset = await knex('assets')
      .where({ tenant, asset_id: assetId })
      .select(
        'asset_type',
        'agent_status',
        'last_seen_at',
        'warranty_end_date'
      )
      .first();

    if (!asset) {
      throw new Error('Asset not found');
    }

    // Calculate health status
    const { health_status, health_reason } = calculateHealthStatus(asset);

    // Count open tickets associated with this asset
    const ticketCountResult = await knex('asset_associations')
      .where({ tenant, asset_id: assetId, entity_type: 'ticket' })
      .join('tickets', function() {
        this.on('tickets.tenant', '=', 'asset_associations.tenant')
          .andOn('tickets.ticket_id', '=', 'asset_associations.entity_id');
      })
      .join('statuses', function() {
        this.on('statuses.tenant', '=', 'tickets.tenant')
          .andOn('statuses.status_id', '=', 'tickets.status_id');
      })
      .where('statuses.is_closed', false)
      .count('* as count')
      .first();

    const open_tickets_count = parseInt(String(ticketCountResult?.count || 0), 10);

    // Calculate security status based on asset extension data
    const { security_status, security_issues } = await calculateSecurityStatus(
      knex,
      tenant,
      assetId,
      asset.asset_type
    );

    // Calculate warranty status
    const { warranty_status, warranty_days_remaining } = calculateWarrantyStatus(
      asset.warranty_end_date
    );

    return {
      health_status,
      health_reason,
      open_tickets_count,
      security_status,
      security_issues,
      warranty_days_remaining,
      warranty_status,
    };
  } catch (error) {
    console.error('Error getting asset summary metrics:', error);
    throw new Error('Failed to get asset summary metrics');
  }
}

/**
 * Calculate health status based on agent status and last seen time
 */
function calculateHealthStatus(asset: {
  agent_status: string | null;
  last_seen_at: string | null;
}): { health_status: HealthStatus; health_reason: string | null } {
  // If no RMM data, return unknown
  if (!asset.agent_status) {
    return { health_status: 'unknown', health_reason: 'No RMM data available' };
  }

  // Check agent status
  if (asset.agent_status === 'offline') {
    // Check how long it's been offline
    if (asset.last_seen_at) {
      const lastSeen = new Date(asset.last_seen_at);
      const now = new Date();
      const hoursSinceLastSeen = (now.getTime() - lastSeen.getTime()) / (1000 * 60 * 60);

      if (hoursSinceLastSeen > 72) {
        return {
          health_status: 'critical',
          health_reason: `Device offline for ${Math.floor(hoursSinceLastSeen / 24)} days`,
        };
      } else if (hoursSinceLastSeen > 24) {
        return {
          health_status: 'warning',
          health_reason: `Device offline for ${Math.floor(hoursSinceLastSeen)} hours`,
        };
      }
    }
    return { health_status: 'warning', health_reason: 'Device offline' };
  }

  // Agent is online - consider healthy
  return { health_status: 'healthy', health_reason: null };
}

/**
 * Calculate security status based on antivirus and patch status
 */
async function calculateSecurityStatus(
  knex: ReturnType<typeof createTenantKnex> extends Promise<infer T> ? (T extends { knex: infer K } ? K : never) : never,
  tenant: string,
  assetId: string,
  assetType: string
): Promise<{ security_status: SecurityStatus; security_issues: string[] }> {
  const issues: string[] = [];

  // Get extension data based on asset type
  let extensionData: {
    antivirus_status?: string;
    antivirus_product?: string;
    pending_patches?: number;
    failed_patches?: number;
  } | null = null;

  if (assetType === 'workstation') {
    extensionData = await knex('workstation_assets')
      .where({ tenant, asset_id: assetId })
      .select('antivirus_status', 'antivirus_product', 'pending_patches', 'failed_patches')
      .first();
  } else if (assetType === 'server') {
    extensionData = await knex('server_assets')
      .where({ tenant, asset_id: assetId })
      .select('antivirus_status', 'antivirus_product', 'pending_patches', 'failed_patches')
      .first();
  }

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
function calculateWarrantyStatus(warrantyEndDate: string | null): {
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
