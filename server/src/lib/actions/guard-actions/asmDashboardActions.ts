'use server';

import { createTenantKnex } from '../../db';
import { withTransaction } from '@alga-psa/shared/db';
import { getCurrentUser } from '../user-actions/userActions';
import { hasPermission } from '../../auth/rbac';
import { Knex } from 'knex';
import {
  IGuardAsmDashboardStats,
  IGuardAsmJobWithDomain,
  GuardAsmResultType,
  ICveData,
  IScannerPodInfo,
} from '../../../interfaces/guard/asm.interfaces';

/**
 * Get ASM Dashboard statistics
 */
export async function getAsmDashboardStats(): Promise<IGuardAsmDashboardStats> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canView = await hasPermission(currentUser, 'guard:asm', 'view');
  if (!canView) {
    throw new Error('Permission denied: guard:asm:view');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Get total domains
    const domainsCount = await trx('guard_asm_domains')
      .where({ tenant })
      .count('* as count')
      .first();
    const total_domains = parseInt(domainsCount?.count as string || '0', 10);

    // Get active domains (enabled)
    const activeDomainsCount = await trx('guard_asm_domains')
      .where({ tenant, enabled: true })
      .count('* as count')
      .first();
    const active_domains = parseInt(activeDomainsCount?.count as string || '0', 10);

    // Get total scans
    const scansCount = await trx('guard_asm_jobs')
      .where({ tenant })
      .count('* as count')
      .first();
    const total_scans = parseInt(scansCount?.count as string || '0', 10);

    // Get scans last 30 days
    const recentScansCount = await trx('guard_asm_jobs')
      .where({ tenant })
      .where('started_at', '>=', thirtyDaysAgo)
      .count('* as count')
      .first();
    const scans_last_30_days = parseInt(recentScansCount?.count as string || '0', 10);

    // Get total findings
    const findingsCount = await trx('guard_asm_results')
      .where({ tenant })
      .count('* as count')
      .first();
    const total_findings = parseInt(findingsCount?.count as string || '0', 10);

    // Get findings by type
    const findingsByTypeRows = await trx('guard_asm_results')
      .where({ tenant })
      .select('result_type')
      .count('* as count')
      .groupBy('result_type');

    const findings_by_type: Record<GuardAsmResultType, number> = {} as Record<GuardAsmResultType, number>;
    for (const row of findingsByTypeRows) {
      findings_by_type[row.result_type as GuardAsmResultType] = parseInt(row.count as string, 10);
    }

    // Get findings by severity
    const findingsBySeverityRows = await trx('guard_asm_results')
      .where({ tenant })
      .whereNotNull('severity')
      .select('severity')
      .count('* as count')
      .groupBy('severity');

    const findings_by_severity = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const row of findingsBySeverityRows) {
      const sev = row.severity as keyof typeof findings_by_severity;
      if (sev in findings_by_severity) {
        findings_by_severity[sev] = parseInt(row.count as string, 10);
      }
    }

    // Get findings by company (top 10)
    const findingsByCompanyRows = await trx('guard_asm_results as r')
      .join('guard_asm_domains as d', function() {
        this.on('r.domain_id', '=', 'd.id')
          .andOn('r.tenant', '=', 'd.tenant');
      })
      .join('companies as c', function() {
        this.on('d.company_id', '=', 'c.company_id')
          .andOn('d.tenant', '=', 'c.tenant');
      })
      .where('r.tenant', tenant)
      .select('d.company_id', 'c.company_name')
      .count('r.id as count')
      .groupBy('d.company_id', 'c.company_name')
      .orderBy('count', 'desc')
      .limit(10);

    const findings_by_company = findingsByCompanyRows.map(row => ({
      company_id: String(row.company_id),
      company_name: String(row.company_name),
      count: parseInt(row.count as string, 10),
    }));

    // Get recent scans (last 5)
    const recentScans = await trx('guard_asm_jobs as j')
      .select(
        'j.*',
        'd.domain_name',
        'd.company_id',
        'c.company_name'
      )
      .join('guard_asm_domains as d', function() {
        this.on('j.domain_id', '=', 'd.id')
          .andOn('j.tenant', '=', 'd.tenant');
      })
      .join('companies as c', function() {
        this.on('d.company_id', '=', 'c.company_id')
          .andOn('d.tenant', '=', 'c.tenant');
      })
      .where('j.tenant', tenant)
      .orderBy('j.started_at', 'desc')
      .limit(5);

    // Get critical CVEs
    const criticalCves = await trx('guard_asm_results')
      .where({ tenant, result_type: 'cve', severity: 'critical' })
      .orderBy('found_at', 'desc')
      .limit(10);

    const critical_cves = criticalCves.map(row => {
      const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      return data as ICveData;
    });

    return {
      total_domains,
      active_domains,
      total_scans,
      scans_last_30_days,
      total_findings,
      findings_by_type,
      findings_by_severity,
      findings_by_company,
      recent_scans: recentScans as IGuardAsmJobWithDomain[],
      critical_cves,
    };
  });
}

/**
 * Get ASM findings trend (daily counts for the last N days)
 */
export async function getAsmFindingsTrend(
  days: number = 30
): Promise<Array<{ date: string; count: number }>> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canView = await hasPermission(currentUser, 'guard:asm', 'view');
  if (!canView) {
    throw new Error('Permission denied: guard:asm:view');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const rows = await trx('guard_asm_results')
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
export async function getAsmScanActivityTrend(
  days: number = 30
): Promise<Array<{ date: string; count: number }>> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canView = await hasPermission(currentUser, 'guard:asm', 'view');
  if (!canView) {
    throw new Error('Permission denied: guard:asm:view');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const rows = await trx('guard_asm_jobs')
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
 * Get domain risk summary (domains with most findings)
 */
export async function getDomainRiskSummary(
  limit: number = 10
): Promise<Array<{
  domain_id: string;
  domain_name: string;
  company_id: string;
  company_name: string;
  total_findings: number;
  critical_count: number;
  high_count: number;
  latest_scan: Date | null;
}>> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canView = await hasPermission(currentUser, 'guard:asm', 'view');
  if (!canView) {
    throw new Error('Permission denied: guard:asm:view');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    // Get domains with most findings
    const domains = await trx('guard_asm_results as r')
      .join('guard_asm_domains as d', function() {
        this.on('r.domain_id', '=', 'd.id')
          .andOn('r.tenant', '=', 'd.tenant');
      })
      .join('companies as c', function() {
        this.on('d.company_id', '=', 'c.company_id')
          .andOn('d.tenant', '=', 'c.tenant');
      })
      .where('r.tenant', tenant)
      .select(
        'r.domain_id',
        'd.domain_name',
        'd.company_id',
        'c.company_name',
        'd.last_scanned_at as latest_scan'
      )
      .count('r.id as total_findings')
      .groupBy('r.domain_id', 'd.domain_name', 'd.company_id', 'c.company_name', 'd.last_scanned_at')
      .orderBy('total_findings', 'desc')
      .limit(limit);

    // Get critical/high counts for each domain
    const result = await Promise.all(
      domains.map(async (domain) => {
        const severityCounts = await trx('guard_asm_results')
          .where({ tenant, domain_id: domain.domain_id })
          .whereIn('severity', ['critical', 'high'])
          .select('severity')
          .count('* as count')
          .groupBy('severity');

        let critical_count = 0;
        let high_count = 0;
        for (const row of severityCounts) {
          if (row.severity === 'critical') {
            critical_count = parseInt(row.count as string, 10);
          } else if (row.severity === 'high') {
            high_count = parseInt(row.count as string, 10);
          }
        }

        return {
          domain_id: String(domain.domain_id),
          domain_name: String(domain.domain_name),
          company_id: String(domain.company_id),
          company_name: String(domain.company_name),
          total_findings: parseInt(domain.total_findings as string, 10),
          critical_count,
          high_count,
          latest_scan: domain.latest_scan ? new Date(domain.latest_scan as string) : null,
        };
      })
    );

    return result;
  });
}

/**
 * Get scanner pod information (for whitelisting purposes)
 */
export async function getScannerPodIps(): Promise<IScannerPodInfo[]> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canView = await hasPermission(currentUser, 'guard:asm', 'view');
  if (!canView) {
    throw new Error('Permission denied: guard:asm:view');
  }

  // Note: In production, this would query a separate scanner_pods table
  // or call the Kubernetes API to get current scanner pod IPs.
  // For now, return a placeholder that will be implemented with ASM scanner infrastructure.
  return withTransaction(db, async (trx: Knex.Transaction) => {
    // Check if scanner_pods table exists (it may not in all environments)
    const tableExists = await trx.schema.hasTable('guard_scanner_pods');

    if (!tableExists) {
      // Return default cloud scanner IPs (placeholder)
      return [
        {
          pod_id: 'cloud-scanner-us-east-1',
          ip_address: '203.0.113.10',
          region: 'us-east-1',
          status: 'active' as const,
          last_heartbeat: new Date(),
        },
        {
          pod_id: 'cloud-scanner-us-west-2',
          ip_address: '203.0.113.20',
          region: 'us-west-2',
          status: 'active' as const,
          last_heartbeat: new Date(),
        },
        {
          pod_id: 'cloud-scanner-eu-west-1',
          ip_address: '203.0.113.30',
          region: 'eu-west-1',
          status: 'active' as const,
          last_heartbeat: new Date(),
        },
      ];
    }

    // Query actual scanner pods if table exists
    const pods = await trx('guard_scanner_pods')
      .where({ status: 'active' })
      .select('*');

    return pods.map(pod => ({
      pod_id: pod.pod_id,
      ip_address: pod.ip_address,
      region: pod.region,
      status: pod.status,
      last_heartbeat: pod.last_heartbeat,
    }));
  });
}

/**
 * Get vulnerability summary across all domains
 */
export async function getVulnerabilitySummary(): Promise<{
  total_cves: number;
  by_severity: { critical: number; high: number; medium: number; low: number };
  top_cves: ICveData[];
  affected_domains: number;
}> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canView = await hasPermission(currentUser, 'guard:asm', 'view');
  if (!canView) {
    throw new Error('Permission denied: guard:asm:view');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    // Get total CVE count
    const totalCount = await trx('guard_asm_results')
      .where({ tenant, result_type: 'cve' })
      .count('* as count')
      .first();
    const total_cves = parseInt(totalCount?.count as string || '0', 10);

    // Get CVE counts by severity
    const severityCounts = await trx('guard_asm_results')
      .where({ tenant, result_type: 'cve' })
      .select('severity')
      .count('* as count')
      .groupBy('severity');

    const by_severity = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const row of severityCounts) {
      const sev = row.severity as keyof typeof by_severity;
      if (sev in by_severity) {
        by_severity[sev] = parseInt(row.count as string, 10);
      }
    }

    // Get top CVEs by CVSS score
    const topCveRows = await trx('guard_asm_results')
      .where({ tenant, result_type: 'cve' })
      .orderBy('severity', 'desc')
      .limit(10);

    const top_cves = topCveRows.map(row => {
      const data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      return data as ICveData;
    });

    // Get count of affected domains
    const affectedDomainsCount = await trx('guard_asm_results')
      .where({ tenant, result_type: 'cve' })
      .countDistinct('domain_id as count')
      .first();
    const affected_domains = parseInt(affectedDomainsCount?.count as string || '0', 10);

    return {
      total_cves,
      by_severity,
      top_cves,
      affected_domains,
    };
  });
}
