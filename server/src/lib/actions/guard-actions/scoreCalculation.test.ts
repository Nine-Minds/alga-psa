import { describe, it, expect } from 'vitest';
import {
  calculateRiskLevel,
  calculatePiiPenalty,
  calculateCvePenalty,
  calculatePortPenalty,
  calculateCloudStoragePenalty,
  calculateEmailSecurityPenalty,
  calculateSecurityScore,
  simulateScoreImprovement,
  getRiskLevelColor,
  getRiskLevelLabel,
} from './scoreCalculation';
import type { IScoreCalculationInput, IScoreCalculationResult } from '../../../interfaces/guard/score.interfaces';

describe('Security Score Calculation - calculateRiskLevel', () => {
  it('should return critical for scores 0-39', () => {
    expect(calculateRiskLevel(0)).toBe('critical');
    expect(calculateRiskLevel(20)).toBe('critical');
    expect(calculateRiskLevel(39)).toBe('critical');
  });

  it('should return high for scores 40-59', () => {
    expect(calculateRiskLevel(40)).toBe('high');
    expect(calculateRiskLevel(50)).toBe('high');
    expect(calculateRiskLevel(59)).toBe('high');
  });

  it('should return moderate for scores 60-79', () => {
    expect(calculateRiskLevel(60)).toBe('moderate');
    expect(calculateRiskLevel(70)).toBe('moderate');
    expect(calculateRiskLevel(79)).toBe('moderate');
  });

  it('should return low for scores 80-100', () => {
    expect(calculateRiskLevel(80)).toBe('low');
    expect(calculateRiskLevel(90)).toBe('low');
    expect(calculateRiskLevel(100)).toBe('low');
  });
});

describe('Security Score Calculation - calculatePiiPenalty', () => {
  it('should calculate penalty for SSN with weight 10', () => {
    const result = calculatePiiPenalty([{ pii_type: 'ssn', count: 1 }]);
    expect(result.penalty).toBe(10);
    expect(result.breakdown.count).toBe(1);
  });

  it('should calculate penalty for credit card with weight 10', () => {
    const result = calculatePiiPenalty([{ pii_type: 'credit_card', count: 1 }]);
    expect(result.penalty).toBe(10);
  });

  it('should calculate penalty for bank account with weight 8', () => {
    const result = calculatePiiPenalty([{ pii_type: 'bank_account', count: 1 }]);
    expect(result.penalty).toBe(8);
  });

  it('should calculate penalty for DOB with weight 5', () => {
    const result = calculatePiiPenalty([{ pii_type: 'dob', count: 1 }]);
    expect(result.penalty).toBe(5);
  });

  it('should calculate penalty for email with weight 1', () => {
    const result = calculatePiiPenalty([{ pii_type: 'email', count: 1 }]);
    expect(result.penalty).toBe(1);
  });

  it('should apply decay factor for multiple instances', () => {
    // First instance: 10, Second: 10 * 0.8 = 8, Third: 10 * 0.64 = 6.4
    const result = calculatePiiPenalty([{ pii_type: 'ssn', count: 3 }]);
    expect(result.penalty).toBeCloseTo(24.4, 1);
  });

  it('should cap penalty at maximum of 50', () => {
    const result = calculatePiiPenalty([
      { pii_type: 'ssn', count: 10 },
      { pii_type: 'credit_card', count: 10 },
    ]);
    expect(result.penalty).toBe(50);
  });

  it('should combine penalties from multiple PII types', () => {
    const result = calculatePiiPenalty([
      { pii_type: 'ssn', count: 1 },
      { pii_type: 'email', count: 1 },
    ]);
    expect(result.penalty).toBe(11);
  });

  it('should generate issues for each PII type', () => {
    const result = calculatePiiPenalty([
      { pii_type: 'ssn', count: 2 },
      { pii_type: 'email', count: 5 },
    ]);
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0].type).toBe('pii');
  });

  it('should return zero penalty for empty input', () => {
    const result = calculatePiiPenalty([]);
    expect(result.penalty).toBe(0);
    expect(result.breakdown.count).toBe(0);
  });
});

describe('Security Score Calculation - calculateCvePenalty', () => {
  it('should calculate critical CVE penalty with weight 15', () => {
    const result = calculateCvePenalty([{ severity: 'critical', count: 1 }]);
    expect(result.penalty).toBe(15);
  });

  it('should calculate high CVE penalty with weight 10', () => {
    const result = calculateCvePenalty([{ severity: 'high', count: 1 }]);
    expect(result.penalty).toBe(10);
  });

  it('should calculate medium CVE penalty with weight 5', () => {
    const result = calculateCvePenalty([{ severity: 'medium', count: 1 }]);
    expect(result.penalty).toBe(5);
  });

  it('should calculate low CVE penalty with weight 2', () => {
    const result = calculateCvePenalty([{ severity: 'low', count: 1 }]);
    expect(result.penalty).toBe(2);
  });

  it('should multiply penalty by count', () => {
    const result = calculateCvePenalty([{ severity: 'critical', count: 3 }]);
    expect(result.penalty).toBe(45);
  });

  it('should combine penalties from multiple severities', () => {
    const result = calculateCvePenalty([
      { severity: 'critical', count: 1 },
      { severity: 'high', count: 2 },
    ]);
    expect(result.penalty).toBe(35); // 15 + 20
  });

  it('should handle case-insensitive severity', () => {
    const result = calculateCvePenalty([{ severity: 'CRITICAL', count: 1 }]);
    expect(result.penalty).toBe(15);
  });
});

describe('Security Score Calculation - calculatePortPenalty', () => {
  it('should calculate RDP (3389) penalty with weight 12', () => {
    const result = calculatePortPenalty([{ port: 3389, count: 1 }]);
    expect(result.penalty).toBe(12);
  });

  it('should calculate Telnet (23) penalty with weight 12', () => {
    const result = calculatePortPenalty([{ port: 23, count: 1 }]);
    expect(result.penalty).toBe(12);
  });

  it('should calculate FTP (21) penalty with weight 8', () => {
    const result = calculatePortPenalty([{ port: 21, count: 1 }]);
    expect(result.penalty).toBe(8);
  });

  it('should calculate SMB (445) penalty with weight 8', () => {
    const result = calculatePortPenalty([{ port: 445, count: 1 }]);
    expect(result.penalty).toBe(8);
  });

  it('should calculate SSH (22) penalty with weight 5', () => {
    const result = calculatePortPenalty([{ port: 22, count: 1 }]);
    expect(result.penalty).toBe(5);
  });

  it('should calculate HTTP (80) with zero penalty', () => {
    const result = calculatePortPenalty([{ port: 80, count: 1 }]);
    expect(result.penalty).toBe(0);
  });

  it('should calculate HTTPS (443) with zero penalty', () => {
    const result = calculatePortPenalty([{ port: 443, count: 1 }]);
    expect(result.penalty).toBe(0);
  });

  it('should assign default penalty to unknown high-risk ports', () => {
    const result = calculatePortPenalty([{ port: 5900, count: 1 }]); // VNC
    expect(result.penalty).toBe(5);
  });

  it('should multiply penalty by count', () => {
    const result = calculatePortPenalty([{ port: 3389, count: 3 }]);
    expect(result.penalty).toBe(36);
  });
});

describe('Security Score Calculation - calculateCloudStoragePenalty', () => {
  it('should calculate AWS S3 public bucket penalty with weight 10', () => {
    const result = calculateCloudStoragePenalty([{ provider: 'aws_s3', is_public: true }]);
    expect(result.penalty).toBe(10);
  });

  it('should calculate Azure Blob public bucket penalty with weight 10', () => {
    const result = calculateCloudStoragePenalty([{ provider: 'azure_blob', is_public: true }]);
    expect(result.penalty).toBe(10);
  });

  it('should calculate GCP Storage public bucket penalty with weight 10', () => {
    const result = calculateCloudStoragePenalty([{ provider: 'gcp_storage', is_public: true }]);
    expect(result.penalty).toBe(10);
  });

  it('should not penalize private buckets', () => {
    const result = calculateCloudStoragePenalty([{ provider: 'aws_s3', is_public: false }]);
    expect(result.penalty).toBe(0);
  });

  it('should combine penalties for multiple public buckets', () => {
    const result = calculateCloudStoragePenalty([
      { provider: 'aws_s3', is_public: true },
      { provider: 'azure_blob', is_public: true },
    ]);
    expect(result.penalty).toBe(20);
  });
});

describe('Security Score Calculation - calculateEmailSecurityPenalty', () => {
  it('should calculate missing SPF penalty with weight 3', () => {
    const result = calculateEmailSecurityPenalty([
      { spf_valid: false, dkim_valid: true, dmarc_policy: 'reject' },
    ]);
    expect(result.penalty).toBe(3);
  });

  it('should calculate missing DKIM penalty with weight 2', () => {
    const result = calculateEmailSecurityPenalty([
      { spf_valid: true, dkim_valid: false, dmarc_policy: 'reject' },
    ]);
    expect(result.penalty).toBe(2);
  });

  it('should calculate missing DMARC penalty with weight 3', () => {
    const result = calculateEmailSecurityPenalty([
      { spf_valid: true, dkim_valid: true, dmarc_policy: null },
    ]);
    expect(result.penalty).toBe(3);
  });

  it('should penalize DMARC policy of "none"', () => {
    const result = calculateEmailSecurityPenalty([
      { spf_valid: true, dkim_valid: true, dmarc_policy: 'none' },
    ]);
    expect(result.penalty).toBe(3);
  });

  it('should combine all email security penalties', () => {
    const result = calculateEmailSecurityPenalty([
      { spf_valid: false, dkim_valid: false, dmarc_policy: null },
    ]);
    expect(result.penalty).toBe(8); // 3 + 2 + 3
  });

  it('should return zero penalty for fully configured email security', () => {
    const result = calculateEmailSecurityPenalty([
      { spf_valid: true, dkim_valid: true, dmarc_policy: 'reject' },
    ]);
    expect(result.penalty).toBe(0);
  });
});

describe('Security Score Calculation - calculateSecurityScore', () => {
  it('should return 100 for perfect security posture', () => {
    const input: IScoreCalculationInput = {
      tenant: 'test-tenant',
      company_id: 'company-1',
      pii_results: [],
      asm_results: {
        cves: [],
        open_ports: [],
        cloud_storage: [],
        email_security: [],
      },
    };
    const result = calculateSecurityScore(input);
    expect(result.score).toBe(100);
    expect(result.risk_level).toBe('low');
    expect(result.pii_penalty).toBe(0);
    expect(result.asm_penalty).toBe(0);
  });

  it('should calculate combined score from PII and ASM findings', () => {
    const input: IScoreCalculationInput = {
      tenant: 'test-tenant',
      company_id: 'company-1',
      pii_results: [
        { pii_type: 'ssn', count: 1 }, // 10 points
      ],
      asm_results: {
        cves: [{ severity: 'high', count: 1 }], // 10 points
        open_ports: [],
        cloud_storage: [],
        email_security: [],
      },
    };
    const result = calculateSecurityScore(input);
    expect(result.score).toBe(80); // 100 - 10 - 10
    expect(result.risk_level).toBe('low');
  });

  it('should cap ASM penalty at 50', () => {
    const input: IScoreCalculationInput = {
      tenant: 'test-tenant',
      company_id: 'company-1',
      pii_results: [],
      asm_results: {
        cves: [{ severity: 'critical', count: 10 }], // 150 points raw
        open_ports: [],
        cloud_storage: [],
        email_security: [],
      },
    };
    const result = calculateSecurityScore(input);
    expect(result.asm_penalty).toBe(50);
    expect(result.score).toBe(50); // 100 - 50
  });

  it('should cap PII penalty at 50', () => {
    const input: IScoreCalculationInput = {
      tenant: 'test-tenant',
      company_id: 'company-1',
      pii_results: [
        { pii_type: 'ssn', count: 20 },
        { pii_type: 'credit_card', count: 20 },
      ],
      asm_results: {
        cves: [],
        open_ports: [],
        cloud_storage: [],
        email_security: [],
      },
    };
    const result = calculateSecurityScore(input);
    expect(result.pii_penalty).toBe(50);
    expect(result.score).toBe(50);
  });

  it('should never return score below 0', () => {
    const input: IScoreCalculationInput = {
      tenant: 'test-tenant',
      company_id: 'company-1',
      pii_results: [
        { pii_type: 'ssn', count: 100 },
      ],
      asm_results: {
        cves: [{ severity: 'critical', count: 100 }],
        open_ports: [],
        cloud_storage: [],
        email_security: [],
      },
    };
    const result = calculateSecurityScore(input);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('should return critical risk level for very low scores', () => {
    const input: IScoreCalculationInput = {
      tenant: 'test-tenant',
      company_id: 'company-1',
      pii_results: [
        { pii_type: 'ssn', count: 10 },
      ],
      asm_results: {
        cves: [{ severity: 'critical', count: 5 }],
        open_ports: [{ port: 3389, count: 5 }],
        cloud_storage: [{ provider: 'aws_s3', is_public: true }],
        email_security: [],
      },
    };
    const result = calculateSecurityScore(input);
    expect(result.risk_level).toBe('critical');
  });

  it('should populate breakdown by category', () => {
    const input: IScoreCalculationInput = {
      tenant: 'test-tenant',
      company_id: 'company-1',
      pii_results: [{ pii_type: 'ssn', count: 1 }],
      asm_results: {
        cves: [{ severity: 'high', count: 1 }],
        open_ports: [{ port: 22, count: 1 }],
        cloud_storage: [],
        email_security: [{ spf_valid: false, dkim_valid: true, dmarc_policy: 'reject' }],
      },
    };
    const result = calculateSecurityScore(input);
    expect(result.breakdown.pii.penalty).toBe(10);
    expect(result.breakdown.vulnerabilities.penalty).toBe(10);
    expect(result.breakdown.exposure.penalty).toBe(5);
    expect(result.breakdown.email_security.penalty).toBe(3);
  });

  it('should return top 10 issues sorted by impact', () => {
    const input: IScoreCalculationInput = {
      tenant: 'test-tenant',
      company_id: 'company-1',
      pii_results: [
        { pii_type: 'ssn', count: 1 },
        { pii_type: 'credit_card', count: 1 },
        { pii_type: 'email', count: 5 },
      ],
      asm_results: {
        cves: [
          { severity: 'critical', count: 1 },
          { severity: 'high', count: 2 },
        ],
        open_ports: [
          { port: 3389, count: 1 },
          { port: 22, count: 2 },
        ],
        cloud_storage: [{ provider: 'aws_s3', is_public: true }],
        email_security: [{ spf_valid: false, dkim_valid: false, dmarc_policy: null }],
      },
    };
    const result = calculateSecurityScore(input);
    expect(result.top_issues.length).toBeLessThanOrEqual(10);
    // Should be sorted by impact (highest first)
    for (let i = 1; i < result.top_issues.length; i++) {
      expect(result.top_issues[i].impact).toBeLessThanOrEqual(result.top_issues[i - 1].impact);
    }
  });
});

describe('Security Score Calculation - simulateScoreImprovement', () => {
  it('should calculate projected score after removing issues', () => {
    const currentResult: IScoreCalculationResult = {
      score: 70,
      risk_level: 'moderate',
      pii_penalty: 20,
      asm_penalty: 10,
      breakdown: {} as any,
      top_issues: [],
    };

    const result = simulateScoreImprovement(currentResult, [
      { type: 'pii', impact: 10 },
      { type: 'cve', impact: 5 },
    ]);

    expect(result.projected_score).toBe(85);
    expect(result.improvement).toBe(15);
  });

  it('should cap projected score at 100', () => {
    const currentResult: IScoreCalculationResult = {
      score: 95,
      risk_level: 'low',
      pii_penalty: 5,
      asm_penalty: 0,
      breakdown: {} as any,
      top_issues: [],
    };

    const result = simulateScoreImprovement(currentResult, [
      { type: 'pii', impact: 10 },
    ]);

    expect(result.projected_score).toBe(100);
    expect(result.improvement).toBe(5);
  });
});

describe('Security Score Calculation - UI helpers', () => {
  it('should return correct colors for risk levels', () => {
    expect(getRiskLevelColor('critical')).toBe('#dc2626');
    expect(getRiskLevelColor('high')).toBe('#ea580c');
    expect(getRiskLevelColor('moderate')).toBe('#ca8a04');
    expect(getRiskLevelColor('low')).toBe('#16a34a');
  });

  it('should return correct labels for risk levels', () => {
    expect(getRiskLevelLabel('critical')).toBe('Critical Risk');
    expect(getRiskLevelLabel('high')).toBe('High Risk');
    expect(getRiskLevelLabel('moderate')).toBe('Moderate Risk');
    expect(getRiskLevelLabel('low')).toBe('Low Risk');
  });
});
