/**
 * Alga Guard - Security Score Calculation Engine
 *
 * Calculates a 0-100 security score based on PII findings and ASM vulnerabilities.
 * The score starts at 100 and penalties are deducted based on severity weights.
 */

import {
  IScoreCalculationInput,
  IScoreCalculationResult,
  IGuardScoreBreakdown,
  IGuardScoreIssue,
  ICategoryBreakdown,
  GuardRiskLevel,
  PII_SEVERITY_WEIGHTS,
  CVE_SEVERITY_WEIGHTS,
  PORT_RISK_WEIGHTS,
  HIGH_RISK_PORTS,
  CLOUD_STORAGE_WEIGHTS,
  EMAIL_SECURITY_WEIGHTS,
  RISK_LEVEL_THRESHOLDS,
  PII_DECAY_FACTOR,
  MAX_PII_PENALTY,
  MAX_ASM_PENALTY,
} from '../../../interfaces/guard/score.interfaces';
import type { GuardPiiType } from '../../../interfaces/guard/pii.interfaces';

/**
 * Base score (perfect security posture)
 */
const BASE_SCORE = 100;

/**
 * Calculate the risk level based on score
 */
export function calculateRiskLevel(score: number): GuardRiskLevel {
  if (score <= RISK_LEVEL_THRESHOLDS.critical.max) {
    return 'critical';
  } else if (score <= RISK_LEVEL_THRESHOLDS.high.max) {
    return 'high';
  } else if (score <= RISK_LEVEL_THRESHOLDS.moderate.max) {
    return 'moderate';
  }
  return 'low';
}

/**
 * Calculate PII penalty with decay factor for multiple instances
 *
 * Formula: penalty = sum(weight * (decay_factor ^ (count - 1)))
 * This means the first instance costs full weight, subsequent instances cost less
 */
export function calculatePiiPenalty(
  piiResults: Array<{ pii_type: GuardPiiType; count: number }>
): { penalty: number; breakdown: ICategoryBreakdown; issues: IGuardScoreIssue[] } {
  let totalPenalty = 0;
  const details: Record<string, number> = {};
  const issues: IGuardScoreIssue[] = [];
  let totalCount = 0;

  for (const result of piiResults) {
    const weight = PII_SEVERITY_WEIGHTS[result.pii_type] || 1;
    let penalty = 0;

    // Apply decay factor for multiple instances
    for (let i = 0; i < result.count; i++) {
      penalty += weight * Math.pow(PII_DECAY_FACTOR, i);
    }

    totalPenalty += penalty;
    details[result.pii_type] = result.count;
    totalCount += result.count;

    // Add to issues list
    if (result.count > 0) {
      issues.push({
        type: 'pii',
        severity: weight >= 8 ? 'critical' : weight >= 5 ? 'high' : weight >= 2 ? 'medium' : 'low',
        description: `${result.count} ${result.pii_type.replace('_', ' ')} instance(s) found`,
        impact: Math.round(penalty * 10) / 10,
        details: { pii_type: result.pii_type, count: result.count },
      });
    }
  }

  // Cap at maximum penalty
  const cappedPenalty = Math.min(totalPenalty, MAX_PII_PENALTY);

  return {
    penalty: Math.round(cappedPenalty * 10) / 10,
    breakdown: {
      penalty: Math.round(cappedPenalty * 10) / 10,
      count: totalCount,
      details,
    },
    issues,
  };
}

/**
 * Calculate CVE penalty based on severity
 */
export function calculateCvePenalty(
  cves: Array<{ severity: string; count: number }>
): { penalty: number; details: Record<string, number>; issues: IGuardScoreIssue[] } {
  let penalty = 0;
  const details: Record<string, number> = {};
  const issues: IGuardScoreIssue[] = [];

  for (const cve of cves) {
    const weight = CVE_SEVERITY_WEIGHTS[cve.severity.toLowerCase()] || 2;
    const cvePenalty = weight * cve.count;
    penalty += cvePenalty;
    details[cve.severity] = cve.count;

    if (cve.count > 0) {
      issues.push({
        type: 'cve',
        severity: cve.severity.toLowerCase() as 'critical' | 'high' | 'medium' | 'low',
        description: `${cve.count} ${cve.severity} severity CVE(s)`,
        impact: cvePenalty,
        details: { severity: cve.severity, count: cve.count },
      });
    }
  }

  return { penalty, details, issues };
}

/**
 * Calculate port exposure penalty
 */
export function calculatePortPenalty(
  ports: Array<{ port: number; count: number }>
): { penalty: number; details: Record<string, number>; issues: IGuardScoreIssue[] } {
  let penalty = 0;
  const details: Record<string, number> = {};
  const issues: IGuardScoreIssue[] = [];

  for (const portEntry of ports) {
    // Check if it's a known risky port
    const weight = PORT_RISK_WEIGHTS[portEntry.port] ??
      (HIGH_RISK_PORTS.includes(portEntry.port) ? 5 : 1);

    const portPenalty = weight * portEntry.count;
    penalty += portPenalty;
    details[String(portEntry.port)] = portEntry.count;

    if (weight > 0 && portEntry.count > 0) {
      const portName = getPortName(portEntry.port);
      issues.push({
        type: 'port',
        severity: weight >= 10 ? 'critical' : weight >= 5 ? 'high' : 'medium',
        description: `Port ${portEntry.port} (${portName}) exposed on ${portEntry.count} host(s)`,
        impact: portPenalty,
        details: { port: portEntry.port, count: portEntry.count },
      });
    }
  }

  return { penalty, details, issues };
}

/**
 * Get friendly port name
 */
function getPortName(port: number): string {
  const portNames: Record<number, string> = {
    21: 'FTP',
    22: 'SSH',
    23: 'Telnet',
    25: 'SMTP',
    80: 'HTTP',
    443: 'HTTPS',
    445: 'SMB',
    139: 'NetBIOS',
    1433: 'MS SQL',
    3306: 'MySQL',
    3389: 'RDP',
    5432: 'PostgreSQL',
    5900: 'VNC',
    27017: 'MongoDB',
  };
  return portNames[port] || 'Unknown';
}

/**
 * Calculate cloud storage exposure penalty
 */
export function calculateCloudStoragePenalty(
  storage: Array<{ provider: string; is_public: boolean }>
): { penalty: number; details: Record<string, number>; issues: IGuardScoreIssue[] } {
  let penalty = 0;
  const details: Record<string, number> = {};
  const issues: IGuardScoreIssue[] = [];

  for (const bucket of storage) {
    if (bucket.is_public) {
      const weight = CLOUD_STORAGE_WEIGHTS[bucket.provider] || 10;
      penalty += weight;
      details[bucket.provider] = (details[bucket.provider] || 0) + 1;

      issues.push({
        type: 'cloud_storage',
        severity: 'high',
        description: `Public ${bucket.provider.replace('_', ' ')} bucket exposed`,
        impact: weight,
        details: { provider: bucket.provider },
      });
    }
  }

  return { penalty, details, issues };
}

/**
 * Calculate email security penalty
 */
export function calculateEmailSecurityPenalty(
  emailSecurity: Array<{ spf_valid: boolean; dkim_valid: boolean; dmarc_policy: string | null }>
): { penalty: number; details: Record<string, number>; issues: IGuardScoreIssue[] } {
  let penalty = 0;
  const details: Record<string, number> = {
    missing_spf: 0,
    missing_dkim: 0,
    missing_dmarc: 0,
  };
  const issues: IGuardScoreIssue[] = [];

  for (const domain of emailSecurity) {
    if (!domain.spf_valid) {
      penalty += EMAIL_SECURITY_WEIGHTS.missing_spf;
      details.missing_spf++;
    }
    if (!domain.dkim_valid) {
      penalty += EMAIL_SECURITY_WEIGHTS.missing_dkim;
      details.missing_dkim++;
    }
    if (!domain.dmarc_policy || domain.dmarc_policy === 'none') {
      penalty += EMAIL_SECURITY_WEIGHTS.missing_dmarc;
      details.missing_dmarc++;
    }
  }

  // Add issues for missing security
  if (details.missing_spf > 0) {
    issues.push({
      type: 'email_security',
      severity: 'medium',
      description: `SPF record missing or invalid on ${details.missing_spf} domain(s)`,
      impact: EMAIL_SECURITY_WEIGHTS.missing_spf * details.missing_spf,
      details: { type: 'spf', count: details.missing_spf },
    });
  }
  if (details.missing_dkim > 0) {
    issues.push({
      type: 'email_security',
      severity: 'medium',
      description: `DKIM record missing or invalid on ${details.missing_dkim} domain(s)`,
      impact: EMAIL_SECURITY_WEIGHTS.missing_dkim * details.missing_dkim,
      details: { type: 'dkim', count: details.missing_dkim },
    });
  }
  if (details.missing_dmarc > 0) {
    issues.push({
      type: 'email_security',
      severity: 'medium',
      description: `DMARC policy missing or set to none on ${details.missing_dmarc} domain(s)`,
      impact: EMAIL_SECURITY_WEIGHTS.missing_dmarc * details.missing_dmarc,
      details: { type: 'dmarc', count: details.missing_dmarc },
    });
  }

  return { penalty, details, issues };
}

/**
 * Calculate the complete security score from all inputs
 */
export function calculateSecurityScore(
  input: IScoreCalculationInput
): IScoreCalculationResult {
  // Calculate PII penalty
  const piiResult = calculatePiiPenalty(input.pii_results);
  const piiPenalty = piiResult.penalty;

  // Calculate ASM penalties
  const cveResult = calculateCvePenalty(input.asm_results.cves);
  const portResult = calculatePortPenalty(input.asm_results.open_ports);
  const cloudResult = calculateCloudStoragePenalty(input.asm_results.cloud_storage);
  const emailResult = calculateEmailSecurityPenalty(input.asm_results.email_security);

  // Total ASM penalty (capped)
  const rawAsmPenalty = cveResult.penalty + portResult.penalty + cloudResult.penalty + emailResult.penalty;
  const asmPenalty = Math.min(rawAsmPenalty, MAX_ASM_PENALTY);

  // Calculate final score
  const totalPenalty = piiPenalty + asmPenalty;
  const score = Math.max(0, Math.round(BASE_SCORE - totalPenalty));
  const riskLevel = calculateRiskLevel(score);

  // Build breakdown
  const breakdown: IGuardScoreBreakdown = {
    pii: piiResult.breakdown,
    vulnerabilities: {
      penalty: Math.round(cveResult.penalty * 10) / 10,
      count: Object.values(cveResult.details).reduce((a, b) => a + b, 0),
      details: cveResult.details,
    },
    exposure: {
      penalty: Math.round((portResult.penalty + cloudResult.penalty) * 10) / 10,
      count: Object.values(portResult.details).reduce((a, b) => a + b, 0) +
             Object.values(cloudResult.details).reduce((a, b) => a + b, 0),
      details: { ...portResult.details, ...cloudResult.details },
    },
    email_security: {
      penalty: Math.round(emailResult.penalty * 10) / 10,
      count: Object.values(emailResult.details).reduce((a, b) => a + b, 0),
      details: emailResult.details,
    },
  };

  // Collect and sort issues by impact
  const allIssues = [
    ...piiResult.issues,
    ...cveResult.issues,
    ...portResult.issues,
    ...cloudResult.issues,
    ...emailResult.issues,
  ];

  // Sort by impact (highest first) and take top 10
  const topIssues = allIssues
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 10);

  return {
    score,
    risk_level: riskLevel,
    pii_penalty: Math.round(piiPenalty * 10) / 10,
    asm_penalty: Math.round(asmPenalty * 10) / 10,
    breakdown,
    top_issues: topIssues,
  };
}

/**
 * Simulate score improvement by removing specific issues
 */
export function simulateScoreImprovement(
  currentResult: IScoreCalculationResult,
  removedIssues: Array<{ type: string; impact: number }>
): { projected_score: number; improvement: number } {
  const totalRemovedImpact = removedIssues.reduce((sum, issue) => sum + issue.impact, 0);
  const projectedScore = Math.min(100, currentResult.score + Math.round(totalRemovedImpact));

  return {
    projected_score: projectedScore,
    improvement: projectedScore - currentResult.score,
  };
}

/**
 * Get risk level color for UI
 */
export function getRiskLevelColor(riskLevel: GuardRiskLevel): string {
  const colors: Record<GuardRiskLevel, string> = {
    critical: '#dc2626',  // red-600
    high: '#ea580c',      // orange-600
    moderate: '#ca8a04',  // yellow-600
    low: '#16a34a',       // green-600
  };
  return colors[riskLevel];
}

/**
 * Get risk level label for display
 */
export function getRiskLevelLabel(riskLevel: GuardRiskLevel): string {
  const labels: Record<GuardRiskLevel, string> = {
    critical: 'Critical Risk',
    high: 'High Risk',
    moderate: 'Moderate Risk',
    low: 'Low Risk',
  };
  return labels[riskLevel];
}
