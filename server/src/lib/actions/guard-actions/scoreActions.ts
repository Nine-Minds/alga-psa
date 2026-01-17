'use server';

import { createTenantKnex } from '../../db';
import { withTransaction } from '@alga-psa/shared/db';
import { getCurrentUser } from '../user-actions/userActions';
import { hasPermission } from '../../auth/rbac';
import { Knex } from 'knex';
import {
  IGuardSecurityScore,
  IGuardSecurityScoreWithCompany,
  IGuardScoreHistory,
  IGuardScoreListParams,
  IGuardScoreHistoryListParams,
  IGuardScorePaginatedResponse,
  IGuardPortfolioSummary,
  IWhatIfSimulationRequest,
  IWhatIfSimulationResponse,
  IScoreCalculationInput,
  GuardRiskLevel,
} from '../../../interfaces/guard/score.interfaces';
import type { GuardPiiType } from '../../../interfaces/guard/pii.interfaces';
import { calculateSecurityScore, calculateRiskLevel, simulateScoreImprovement } from './scoreCalculation';

/**
 * Get security score for a company
 */
export async function getSecurityScore(companyId: string): Promise<IGuardSecurityScoreWithCompany | null> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canView = await hasPermission(currentUser, 'guard:score', 'view');
  if (!canView) {
    throw new Error('Permission denied: guard:score:view');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    const score = await trx('guard_security_scores as s')
      .select(
        's.*',
        'c.company_name'
      )
      .join('companies as c', function() {
        this.on('s.company_id', '=', 'c.company_id')
          .andOn('s.tenant', '=', 'c.tenant');
      })
      .where('s.tenant', tenant)
      .where('s.company_id', companyId)
      .first();

    if (!score) {
      return null;
    }

    // Parse JSON fields
    return {
      ...score,
      breakdown: typeof score.breakdown === 'string' ? JSON.parse(score.breakdown) : score.breakdown,
      top_issues: typeof score.top_issues === 'string' ? JSON.parse(score.top_issues) : score.top_issues,
    } as IGuardSecurityScoreWithCompany;
  });
}

/**
 * Get all company security scores with pagination
 */
export async function getSecurityScores(
  params: IGuardScoreListParams = {}
): Promise<IGuardScorePaginatedResponse<IGuardSecurityScoreWithCompany>> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canView = await hasPermission(currentUser, 'guard:score', 'view');
  if (!canView) {
    throw new Error('Permission denied: guard:score:view');
  }

  const {
    page = 1,
    page_size = 20,
    sort_by = 'score',
    sort_order = 'asc',
    risk_level,
    min_score,
    max_score,
  } = params;

  return withTransaction(db, async (trx: Knex.Transaction) => {
    let query = trx('guard_security_scores as s')
      .select(
        's.*',
        'c.company_name'
      )
      .join('companies as c', function() {
        this.on('s.company_id', '=', 'c.company_id')
          .andOn('s.tenant', '=', 'c.tenant');
      })
      .where('s.tenant', tenant);

    // Apply filters
    if (risk_level) {
      query = query.where('s.risk_level', risk_level);
    }

    if (min_score !== undefined) {
      query = query.where('s.score', '>=', min_score);
    }

    if (max_score !== undefined) {
      query = query.where('s.score', '<=', max_score);
    }

    // Get total count
    const countResult = await query.clone()
      .clearSelect()
      .count('s.id as count')
      .first();
    const total = parseInt(countResult?.count as string || '0', 10);

    // Apply pagination and sorting
    const offset = (page - 1) * page_size;
    const sortColumn = sort_by === 'company_name' ? 'c.company_name' : `s.${sort_by}`;
    const scores = await query
      .orderBy(sortColumn, sort_order)
      .limit(page_size)
      .offset(offset);

    // Parse JSON fields
    const parsedScores = scores.map((s: any) => ({
      ...s,
      breakdown: typeof s.breakdown === 'string' ? JSON.parse(s.breakdown) : s.breakdown,
      top_issues: typeof s.top_issues === 'string' ? JSON.parse(s.top_issues) : s.top_issues,
    }));

    return {
      data: parsedScores as IGuardSecurityScoreWithCompany[],
      total,
      page,
      page_size,
      total_pages: Math.ceil(total / page_size),
    };
  });
}

/**
 * Get score history for a company
 */
export async function getScoreHistory(
  companyId: string,
  params: IGuardScoreHistoryListParams = {}
): Promise<IGuardScorePaginatedResponse<IGuardScoreHistory>> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canView = await hasPermission(currentUser, 'guard:score', 'view');
  if (!canView) {
    throw new Error('Permission denied: guard:score:view');
  }

  const {
    page = 1,
    page_size = 20,
    date_from,
    date_to,
  } = params;

  return withTransaction(db, async (trx: Knex.Transaction) => {
    let query = trx('guard_security_score_history')
      .where({ tenant, company_id: companyId });

    if (date_from) {
      query = query.where('calculated_at', '>=', date_from);
    }

    if (date_to) {
      query = query.where('calculated_at', '<=', date_to);
    }

    // Get total count
    const countResult = await query.clone()
      .count('id as count')
      .first();
    const total = parseInt(countResult?.count as string || '0', 10);

    // Apply pagination
    const offset = (page - 1) * page_size;
    const history = await query
      .orderBy('calculated_at', 'desc')
      .limit(page_size)
      .offset(offset);

    return {
      data: history as IGuardScoreHistory[],
      total,
      page,
      page_size,
      total_pages: Math.ceil(total / page_size),
    };
  });
}

/**
 * Recalculate security score for a company
 */
export async function recalculateSecurityScore(
  companyId: string,
  triggeredBy: 'pii_scan' | 'asm_scan' | 'manual' | 'scheduled' = 'manual',
  triggeredJobId?: string
): Promise<IGuardSecurityScore> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser && triggeredBy === 'manual') {
    throw new Error('No authenticated user found');
  }

  if (currentUser && triggeredBy === 'manual') {
    const canRecalc = await hasPermission(currentUser, 'guard:score', 'recalculate');
    if (!canRecalc) {
      throw new Error('Permission denied: guard:score:recalculate');
    }
  }

  if (!tenant) {
    throw new Error('Tenant context required');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    // Gather PII results
    const piiResults = await trx('guard_pii_results')
      .where({ tenant, company_id: companyId })
      .select('pii_type')
      .count('* as count')
      .groupBy('pii_type');

    // Gather ASM CVEs
    const cveResults = await trx('guard_asm_results as r')
      .join('guard_asm_domains as d', function() {
        this.on('r.domain_id', '=', 'd.id')
          .andOn('r.tenant', '=', 'd.tenant');
      })
      .where('r.tenant', tenant)
      .where('d.company_id', companyId)
      .where('r.result_type', 'cve')
      .select('r.severity')
      .count('r.id as count')
      .groupBy('r.severity');

    // Gather open ports
    const portResults = await trx.raw(`
      SELECT (r.data->>'port')::int as port, COUNT(*) as count
      FROM guard_asm_results r
      JOIN guard_asm_domains d ON r.domain_id = d.id AND r.tenant = d.tenant
      WHERE r.tenant = ? AND d.company_id = ? AND r.result_type = 'open_port'
      GROUP BY r.data->>'port'
    `, [tenant, companyId]);

    // Gather cloud storage
    const cloudResults = await trx.raw(`
      SELECT r.data->>'provider' as provider, (r.data->>'is_public')::boolean as is_public
      FROM guard_asm_results r
      JOIN guard_asm_domains d ON r.domain_id = d.id AND r.tenant = d.tenant
      WHERE r.tenant = ? AND d.company_id = ? AND r.result_type = 'cloud_storage'
    `, [tenant, companyId]);

    // Gather email security
    const emailResults = await trx.raw(`
      SELECT
        (r.data->>'spf_valid')::boolean as spf_valid,
        (r.data->>'dkim_valid')::boolean as dkim_valid,
        r.data->>'dmarc_policy' as dmarc_policy
      FROM guard_asm_results r
      JOIN guard_asm_domains d ON r.domain_id = d.id AND r.tenant = d.tenant
      WHERE r.tenant = ? AND d.company_id = ? AND r.result_type = 'email_security'
    `, [tenant, companyId]);

    // Build calculation input
    const input: IScoreCalculationInput = {
      tenant,
      company_id: companyId,
      pii_results: piiResults.map((r: any) => ({
        pii_type: r.pii_type as GuardPiiType,
        count: parseInt(r.count as string, 10),
      })),
      asm_results: {
        cves: cveResults.map((r: any) => ({
          severity: r.severity || 'low',
          count: parseInt(r.count as string, 10),
        })),
        open_ports: (portResults.rows || []).map((r: any) => ({
          port: r.port,
          count: parseInt(r.count as string, 10),
        })),
        cloud_storage: (cloudResults.rows || []).map((r: any) => ({
          provider: r.provider,
          is_public: r.is_public,
        })),
        email_security: (emailResults.rows || []).map((r: any) => ({
          spf_valid: r.spf_valid ?? false,
          dkim_valid: r.dkim_valid ?? false,
          dmarc_policy: r.dmarc_policy,
        })),
      },
    };

    // Calculate score
    const scoreResult = calculateSecurityScore(input);

    // Get previous score for delta calculation
    const existingScore = await trx('guard_security_scores')
      .where({ tenant, company_id: companyId })
      .first();

    const delta = existingScore ? scoreResult.score - existingScore.score : 0;

    // Upsert score
    const scoreData = {
      tenant,
      company_id: companyId,
      score: scoreResult.score,
      risk_level: scoreResult.risk_level,
      pii_penalty: scoreResult.pii_penalty,
      asm_penalty: scoreResult.asm_penalty,
      breakdown: JSON.stringify(scoreResult.breakdown),
      top_issues: JSON.stringify(scoreResult.top_issues),
      last_calculated_at: new Date(),
      updated_at: new Date(),
    };

    let score: IGuardSecurityScore;

    if (existingScore) {
      const [updated] = await trx('guard_security_scores')
        .where({ tenant, company_id: companyId })
        .update(scoreData)
        .returning('*');
      score = updated;
    } else {
      const [inserted] = await trx('guard_security_scores')
        .insert({
          ...scoreData,
          created_at: new Date(),
        })
        .returning('*');
      score = inserted;
    }

    // Insert history record
    await trx('guard_security_score_history').insert({
      tenant,
      company_id: companyId,
      score: scoreResult.score,
      risk_level: scoreResult.risk_level,
      pii_penalty: scoreResult.pii_penalty,
      asm_penalty: scoreResult.asm_penalty,
      delta,
      triggered_by: triggeredBy,
      triggered_job_id: triggeredJobId,
      calculated_at: new Date(),
    });

    // Log audit event
    await trx('guard_audit_log').insert({
      tenant,
      user_id: currentUser?.user_id || 'system',
      action: 'score_calculated',
      resource_type: 'security_score',
      resource_id: score.id,
      details: JSON.stringify({
        company_id: companyId,
        score: scoreResult.score,
        risk_level: scoreResult.risk_level,
        delta,
        triggered_by: triggeredBy,
      }),
      created_at: new Date(),
    });

    // Parse JSON fields before returning
    return {
      ...score,
      breakdown: typeof score.breakdown === 'string' ? JSON.parse(score.breakdown) : score.breakdown,
      top_issues: typeof score.top_issues === 'string' ? JSON.parse(score.top_issues) : score.top_issues,
    };
  });
}

/**
 * Run what-if simulation
 */
export async function runWhatIfSimulation(
  companyId: string,
  request: IWhatIfSimulationRequest
): Promise<IWhatIfSimulationResponse> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canView = await hasPermission(currentUser, 'guard:score', 'view');
  if (!canView) {
    throw new Error('Permission denied: guard:score:view');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    // Get current score
    const currentScore = await trx('guard_security_scores')
      .where({ tenant, company_id: companyId })
      .first();

    if (!currentScore) {
      throw new Error('No security score found for this company');
    }

    const topIssues = typeof currentScore.top_issues === 'string'
      ? JSON.parse(currentScore.top_issues)
      : currentScore.top_issues;

    // Calculate fixes to apply
    const fixesApplied: Array<{ type: string; count: number; impact: number }> = [];
    const issuesToRemove: Array<{ type: string; impact: number }> = [];

    // Process hypothetical fixes
    for (const fix of (request.hypothetical_fixes || [])) {
      // Find matching issues from top_issues
      const matchingIssues = topIssues.filter((issue: any) => {
        if (issue.type !== fix.type) return false;
        if (fix.severity && issue.severity !== fix.severity) return false;
        if (fix.specific_id && issue.resource_id !== fix.specific_id) return false;
        return true;
      });

      let count = fix.count || matchingIssues.length;
      let totalImpact = 0;

      for (let i = 0; i < Math.min(count, matchingIssues.length); i++) {
        issuesToRemove.push({
          type: matchingIssues[i].type,
          impact: matchingIssues[i].impact,
        });
        totalImpact += matchingIssues[i].impact;
      }

      if (totalImpact > 0) {
        fixesApplied.push({
          type: fix.type,
          count: Math.min(count, matchingIssues.length),
          impact: totalImpact,
        });
      }
    }

    // Simulate improvement
    const simulation = simulateScoreImprovement(
      {
        score: currentScore.score,
        risk_level: currentScore.risk_level,
        pii_penalty: currentScore.pii_penalty,
        asm_penalty: currentScore.asm_penalty,
        breakdown: {} as any,
        top_issues: [],
      },
      issuesToRemove
    );

    return {
      current_score: currentScore.score,
      projected_score: simulation.projected_score,
      score_improvement: simulation.improvement,
      current_risk_level: currentScore.risk_level,
      projected_risk_level: calculateRiskLevel(simulation.projected_score),
      fixes_applied: fixesApplied,
    };
  });
}

/**
 * Get portfolio summary for MSP dashboard
 */
export async function getPortfolioSummary(): Promise<IGuardPortfolioSummary> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canView = await hasPermission(currentUser, 'guard:score', 'view');
  if (!canView) {
    throw new Error('Permission denied: guard:score:view');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    // Get total companies with scores
    const totalResult = await trx('guard_security_scores')
      .where({ tenant })
      .count('* as count')
      .first();
    const total_companies = parseInt(totalResult?.count as string || '0', 10);

    // Get average score
    const avgResult = await trx('guard_security_scores')
      .where({ tenant })
      .avg('score as avg')
      .first();
    const average_score = Math.round(parseFloat(avgResult?.avg as string || '0'));

    // Get risk distribution
    const riskDistribution = await trx('guard_security_scores')
      .where({ tenant })
      .select('risk_level')
      .count('* as count')
      .groupBy('risk_level');

    const risk_distribution: Record<GuardRiskLevel, number> = {
      critical: 0,
      high: 0,
      moderate: 0,
      low: 0,
    };

    for (const row of riskDistribution) {
      const level = row.risk_level as GuardRiskLevel;
      risk_distribution[level] = parseInt(row.count as string, 10);
    }

    // Get score trend (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const trendRows = await trx('guard_security_score_history')
      .where({ tenant })
      .where('calculated_at', '>=', thirtyDaysAgo)
      .select(trx.raw("DATE(calculated_at) as date"))
      .avg('score as average_score')
      .groupBy(trx.raw("DATE(calculated_at)"))
      .orderBy('date', 'asc');

    const score_trend = trendRows.map((row: any) => ({
      date: row.date,
      average_score: Math.round(parseFloat(row.average_score || '0')),
    }));

    // Get worst performers (lowest scores)
    const worstPerformers = await trx('guard_security_scores as s')
      .select('s.company_id', 'c.company_name', 's.score', 's.risk_level')
      .join('companies as c', function() {
        this.on('s.company_id', '=', 'c.company_id')
          .andOn('s.tenant', '=', 'c.tenant');
      })
      .where('s.tenant', tenant)
      .orderBy('s.score', 'asc')
      .limit(5);

    const worst_performers = worstPerformers.map((row: any) => ({
      company_id: row.company_id,
      company_name: row.company_name,
      score: row.score,
      risk_level: row.risk_level,
    }));

    // Get most improved (highest positive delta in recent history)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const mostImprovedRows = await trx('guard_security_score_history as h')
      .select(
        'h.company_id',
        'c.company_name',
        trx.raw('SUM(h.delta) as score_change'),
        trx.raw('MAX(h.score) as current_score')
      )
      .join('companies as c', function() {
        this.on('h.company_id', '=', 'c.company_id')
          .andOn('h.tenant', '=', 'c.tenant');
      })
      .where('h.tenant', tenant)
      .where('h.calculated_at', '>=', sevenDaysAgo)
      .groupBy('h.company_id', 'c.company_name')
      .having(trx.raw('SUM(h.delta) > 0'))
      .orderBy('score_change', 'desc')
      .limit(5);

    const most_improved = mostImprovedRows.map((row: any) => ({
      company_id: row.company_id,
      company_name: row.company_name,
      score_change: parseInt(row.score_change || '0', 10),
      current_score: row.current_score,
    }));

    return {
      total_companies,
      average_score,
      risk_distribution,
      score_trend,
      worst_performers,
      most_improved,
    };
  });
}

/**
 * Get top issues across all companies
 */
export async function getTopIssuesAcrossPortfolio(
  limit: number = 10
): Promise<Array<{
  type: string;
  severity: string;
  count: number;
  affected_companies: number;
  total_impact: number;
}>> {
  const { knex: db, tenant } = await createTenantKnex();
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  const canView = await hasPermission(currentUser, 'guard:score', 'view');
  if (!canView) {
    throw new Error('Permission denied: guard:score:view');
  }

  return withTransaction(db, async (trx: Knex.Transaction) => {
    // Get all scores with top_issues
    const scores = await trx('guard_security_scores')
      .where({ tenant })
      .select('company_id', 'top_issues');

    // Aggregate issues across companies
    const issueMap = new Map<string, {
      type: string;
      severity: string;
      count: number;
      affected_companies: Set<string>;
      total_impact: number;
    }>();

    for (const score of scores) {
      const topIssues = typeof score.top_issues === 'string'
        ? JSON.parse(score.top_issues)
        : score.top_issues;

      for (const issue of (topIssues || [])) {
        const key = `${issue.type}:${issue.severity}`;
        if (!issueMap.has(key)) {
          issueMap.set(key, {
            type: issue.type,
            severity: issue.severity,
            count: 0,
            affected_companies: new Set(),
            total_impact: 0,
          });
        }
        const entry = issueMap.get(key)!;
        entry.count++;
        entry.affected_companies.add(score.company_id);
        entry.total_impact += issue.impact;
      }
    }

    // Convert to array and sort by total impact
    const results = Array.from(issueMap.values())
      .map(entry => ({
        type: entry.type,
        severity: entry.severity,
        count: entry.count,
        affected_companies: entry.affected_companies.size,
        total_impact: Math.round(entry.total_impact * 10) / 10,
      }))
      .sort((a, b) => b.total_impact - a.total_impact)
      .slice(0, limit);

    return results;
  });
}
