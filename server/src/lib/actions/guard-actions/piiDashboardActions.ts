'use server';

import { createTenantKnex } from '../../db';
import { withTransaction } from '@alga-psa/shared/db';
import { getCurrentUser } from '../user-actions/userActions';
import { hasPermission } from '../../auth/rbac';
import { Knex } from 'knex';
import {
  IGuardPiiDashboardStats,
  IGuardPiiJobWithProfile,
  GuardPiiType,
} from '../../../interfaces/guard/pii.interfaces';

/**
 * Get PII Dashboard statistics
 */
export async function getPiiDashboardStats(): Promise<IGuardPiiDashboardStats> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canView = await hasPermission(currentUser, 'guard:pii', 'view');
  if (!canView) {
    throw new Error('Permission denied: guard:pii:view');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Get total profiles
    const profilesCount = await trx('guard_pii_profiles')
      .where({ tenant })
      .count('* as count')
      .first();
    const total_profiles = parseInt(profilesCount?.count as string || '0', 10);

    // Get active profiles
    const activeProfilesCount = await trx('guard_pii_profiles')
      .where({ tenant, enabled: true })
      .count('* as count')
      .first();
    const active_profiles = parseInt(activeProfilesCount?.count as string || '0', 10);

    // Get total scans
    const scansCount = await trx('guard_pii_jobs')
      .where({ tenant })
      .count('* as count')
      .first();
    const total_scans = parseInt(scansCount?.count as string || '0', 10);

    // Get scans last 30 days
    const recentScansCount = await trx('guard_pii_jobs')
      .where({ tenant })
      .where('started_at', '>=', thirtyDaysAgo)
      .count('* as count')
      .first();
    const scans_last_30_days = parseInt(recentScansCount?.count as string || '0', 10);

    // Get total findings
    const findingsCount = await trx('guard_pii_results')
      .where({ tenant })
      .count('* as count')
      .first();
    const total_findings = parseInt(findingsCount?.count as string || '0', 10);

    // Get findings last 30 days
    const recentFindingsCount = await trx('guard_pii_results')
      .where({ tenant })
      .where('found_at', '>=', thirtyDaysAgo)
      .count('* as count')
      .first();
    const findings_last_30_days = parseInt(recentFindingsCount?.count as string || '0', 10);

    // Get findings by type
    const findingsByTypeRows = await trx('guard_pii_results')
      .where({ tenant })
      .select('pii_type')
      .count('* as count')
      .groupBy('pii_type');

    const findings_by_type: Record<GuardPiiType, number> = {} as Record<GuardPiiType, number>;
    for (const row of findingsByTypeRows) {
      findings_by_type[row.pii_type as GuardPiiType] = parseInt(row.count as string, 10);
    }

    // Get findings by company (top 10)
    const findingsByCompanyRows = await trx('guard_pii_results as r')
      .join('companies as c', function() {
        this.on('r.company_id', '=', 'c.company_id')
          .andOn('r.tenant', '=', 'c.tenant');
      })
      .where('r.tenant', tenant)
      .select('r.company_id', 'c.company_name')
      .count('r.id as count')
      .groupBy('r.company_id', 'c.company_name')
      .orderBy('count', 'desc')
      .limit(10);

    const findings_by_company = findingsByCompanyRows.map(row => ({
      company_id: String(row.company_id),
      company_name: String(row.company_name),
      count: parseInt(row.count as string, 10),
    }));

    // Get recent scans (last 5)
    const recentScans = await trx('guard_pii_jobs as j')
      .select(
        'j.*',
        'p.name as profile_name'
      )
      .join('guard_pii_profiles as p', function() {
        this.on('j.profile_id', '=', 'p.id')
          .andOn('j.tenant', '=', 'p.tenant');
      })
      .where('j.tenant', tenant)
      .orderBy('j.started_at', 'desc')
      .limit(5);

    return {
      total_profiles,
      active_profiles,
      total_scans,
      scans_last_30_days,
      total_findings,
      findings_last_30_days,
      findings_by_type,
      findings_by_company,
      recent_scans: recentScans as IGuardPiiJobWithProfile[],
    };
  });
}

/**
 * Get PII findings trend (daily counts for the last N days)
 */
export async function getPiiFindingsTrend(
  days: number = 30
): Promise<Array<{ date: string; count: number }>> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canView = await hasPermission(currentUser, 'guard:pii', 'view');
  if (!canView) {
    throw new Error('Permission denied: guard:pii:view');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const rows = await trx('guard_pii_results')
      .where({ tenant })
      .where('found_at', '>=', startDate)
      .select(trx.raw("DATE(found_at) as date"))
      .count('* as count')
      .groupBy(trx.raw("DATE(found_at)"))
      .orderBy('date', 'asc');

    return rows.map(row => ({
      date: row.date,
      count: parseInt(row.count as string, 10),
    }));
  });
}

/**
 * Get scan activity trend (daily scan counts for the last N days)
 */
export async function getPiiScanActivityTrend(
  days: number = 30
): Promise<Array<{ date: string; count: number }>> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canView = await hasPermission(currentUser, 'guard:pii', 'view');
  if (!canView) {
    throw new Error('Permission denied: guard:pii:view');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const rows = await trx('guard_pii_jobs')
      .where({ tenant })
      .where('started_at', '>=', startDate)
      .select(trx.raw("DATE(started_at) as date"))
      .count('* as count')
      .groupBy(trx.raw("DATE(started_at)"))
      .orderBy('date', 'asc');

    return rows.map(row => ({
      date: row.date,
      count: parseInt(row.count as string, 10),
    }));
  });
}

/**
 * Get company risk summary (companies with most PII findings)
 */
export async function getCompanyRiskSummary(
  limit: number = 10
): Promise<Array<{
  company_id: string;
  company_name: string;
  total_findings: number;
  latest_scan: Date | null;
  findings_by_type: Record<GuardPiiType, number>;
}>> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canView = await hasPermission(currentUser, 'guard:pii', 'view');
  if (!canView) {
    throw new Error('Permission denied: guard:pii:view');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    // Get companies with most findings
    const companies = await trx('guard_pii_results as r')
      .join('companies as c', function() {
        this.on('r.company_id', '=', 'c.company_id')
          .andOn('r.tenant', '=', 'c.tenant');
      })
      .where('r.tenant', tenant)
      .select('r.company_id', 'c.company_name')
      .count('r.id as total_findings')
      .max('r.found_at as latest_scan')
      .groupBy('r.company_id', 'c.company_name')
      .orderBy('total_findings', 'desc')
      .limit(limit);

    // Get findings by type for each company
    const result = await Promise.all(
      companies.map(async (company) => {
        const typeBreakdown = await trx('guard_pii_results')
          .where({ tenant, company_id: company.company_id })
          .select('pii_type')
          .count('* as count')
          .groupBy('pii_type');

        const findings_by_type: Record<string, number> = {};
        for (const row of typeBreakdown) {
          findings_by_type[row.pii_type] = parseInt(row.count as string, 10);
        }

        return {
          company_id: company.company_id,
          company_name: company.company_name,
          total_findings: parseInt(company.total_findings as string, 10),
          latest_scan: company.latest_scan,
          findings_by_type: findings_by_type as Record<GuardPiiType, number>,
        };
      })
    );

    return result;
  });
}
