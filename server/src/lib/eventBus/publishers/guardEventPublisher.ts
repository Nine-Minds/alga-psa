/**
 * Guard Event Publisher
 *
 * Utility functions for publishing Alga Guard events to the event bus.
 * Used by job handlers to emit events for PII scans, ASM scans, and security score updates.
 */

import logger from '@shared/core/logger';
import { publishEvent } from './index';
import type {
  GuardPiiScanStartedEvent,
  GuardPiiScanCompletedEvent,
  GuardPiiHighSeverityFoundEvent,
  GuardAsmScanStartedEvent,
  GuardAsmScanCompletedEvent,
  GuardAsmCriticalCveFoundEvent,
  GuardScoreUpdatedEvent,
  GuardScoreCriticalThresholdEvent,
} from '../events';

// ============================================================================
// GUARD EVENTS CONSTANT
// ============================================================================

/**
 * All Guard event type constants
 */
export const GUARD_EVENTS = {
  PII_SCAN_STARTED: 'GUARD_PII_SCAN_STARTED',
  PII_SCAN_COMPLETED: 'GUARD_PII_SCAN_COMPLETED',
  PII_HIGH_SEVERITY_FOUND: 'GUARD_PII_HIGH_SEVERITY_FOUND',
  ASM_SCAN_STARTED: 'GUARD_ASM_SCAN_STARTED',
  ASM_SCAN_COMPLETED: 'GUARD_ASM_SCAN_COMPLETED',
  ASM_CRITICAL_CVE_FOUND: 'GUARD_ASM_CRITICAL_CVE_FOUND',
  SCORE_UPDATED: 'GUARD_SCORE_UPDATED',
  SCORE_CRITICAL_THRESHOLD: 'GUARD_SCORE_CRITICAL_THRESHOLD',
} as const;

export type GuardEventType = typeof GUARD_EVENTS[keyof typeof GUARD_EVENTS];

// ============================================================================
// PII SCAN EVENT PUBLISHERS
// ============================================================================

export interface PublishPiiScanStartedParams {
  tenantId: string;
  jobId: string;
  profileId: string;
  profileName?: string;
  companyId?: string;
  companyName?: string;
}

/**
 * Publish PII scan started event
 */
export async function publishPiiScanStarted(
  params: PublishPiiScanStartedParams
): Promise<void> {
  try {
    await publishEvent({
      eventType: GUARD_EVENTS.PII_SCAN_STARTED,
      payload: {
        tenantId: params.tenantId,
        jobId: params.jobId,
        profileId: params.profileId,
        profileName: params.profileName,
        companyId: params.companyId,
        companyName: params.companyName,
      },
    } as Omit<GuardPiiScanStartedEvent, 'id' | 'timestamp'>);

    logger.debug('Published GUARD_PII_SCAN_STARTED event', {
      tenantId: params.tenantId,
      jobId: params.jobId,
    });
  } catch (error) {
    logger.error('Failed to publish GUARD_PII_SCAN_STARTED event', {
      error,
      params,
    });
  }
}

export interface PublishPiiScanCompletedParams {
  tenantId: string;
  jobId: string;
  profileId: string;
  profileName?: string;
  companyId?: string;
  companyName?: string;
  totalFilesScanned: number;
  totalMatches: number;
  highSeverityCount?: number;
  duration?: number;
}

/**
 * Publish PII scan completed event
 */
export async function publishPiiScanCompleted(
  params: PublishPiiScanCompletedParams
): Promise<void> {
  try {
    await publishEvent({
      eventType: GUARD_EVENTS.PII_SCAN_COMPLETED,
      payload: {
        tenantId: params.tenantId,
        jobId: params.jobId,
        profileId: params.profileId,
        profileName: params.profileName,
        companyId: params.companyId,
        companyName: params.companyName,
        totalFilesScanned: params.totalFilesScanned,
        totalMatches: params.totalMatches,
        highSeverityCount: params.highSeverityCount,
        duration: params.duration,
      },
    } as Omit<GuardPiiScanCompletedEvent, 'id' | 'timestamp'>);

    logger.debug('Published GUARD_PII_SCAN_COMPLETED event', {
      tenantId: params.tenantId,
      jobId: params.jobId,
      totalMatches: params.totalMatches,
    });
  } catch (error) {
    logger.error('Failed to publish GUARD_PII_SCAN_COMPLETED event', {
      error,
      params,
    });
  }
}

export interface PublishPiiHighSeverityFoundParams {
  tenantId: string;
  jobId: string;
  profileId: string;
  profileName?: string;
  companyId?: string;
  companyName?: string;
  piiType: string;
  count: number;
  severity: 'high' | 'critical';
  filePath?: string;
}

/**
 * Publish PII high severity found event (triggers email notification)
 */
export async function publishPiiHighSeverityFound(
  params: PublishPiiHighSeverityFoundParams
): Promise<void> {
  try {
    await publishEvent({
      eventType: GUARD_EVENTS.PII_HIGH_SEVERITY_FOUND,
      payload: {
        tenantId: params.tenantId,
        jobId: params.jobId,
        profileId: params.profileId,
        profileName: params.profileName,
        companyId: params.companyId,
        companyName: params.companyName,
        piiType: params.piiType,
        count: params.count,
        severity: params.severity,
        filePath: params.filePath,
      },
    } as Omit<GuardPiiHighSeverityFoundEvent, 'id' | 'timestamp'>);

    logger.info('Published GUARD_PII_HIGH_SEVERITY_FOUND event', {
      tenantId: params.tenantId,
      jobId: params.jobId,
      piiType: params.piiType,
      count: params.count,
      severity: params.severity,
    });
  } catch (error) {
    logger.error('Failed to publish GUARD_PII_HIGH_SEVERITY_FOUND event', {
      error,
      params,
    });
  }
}

// ============================================================================
// ASM SCAN EVENT PUBLISHERS
// ============================================================================

export interface PublishAsmScanStartedParams {
  tenantId: string;
  jobId: string;
  domainId: string;
  domainName?: string;
  companyId?: string;
  companyName?: string;
}

/**
 * Publish ASM scan started event
 */
export async function publishAsmScanStarted(
  params: PublishAsmScanStartedParams
): Promise<void> {
  try {
    await publishEvent({
      eventType: GUARD_EVENTS.ASM_SCAN_STARTED,
      payload: {
        tenantId: params.tenantId,
        jobId: params.jobId,
        domainId: params.domainId,
        domainName: params.domainName,
        companyId: params.companyId,
        companyName: params.companyName,
      },
    } as Omit<GuardAsmScanStartedEvent, 'id' | 'timestamp'>);

    logger.debug('Published GUARD_ASM_SCAN_STARTED event', {
      tenantId: params.tenantId,
      jobId: params.jobId,
    });
  } catch (error) {
    logger.error('Failed to publish GUARD_ASM_SCAN_STARTED event', {
      error,
      params,
    });
  }
}

export interface PublishAsmScanCompletedParams {
  tenantId: string;
  jobId: string;
  domainId: string;
  domainName?: string;
  companyId?: string;
  companyName?: string;
  totalFindings: number;
  criticalCveCount?: number;
  highCveCount?: number;
  openPortsCount?: number;
  duration?: number;
}

/**
 * Publish ASM scan completed event
 */
export async function publishAsmScanCompleted(
  params: PublishAsmScanCompletedParams
): Promise<void> {
  try {
    await publishEvent({
      eventType: GUARD_EVENTS.ASM_SCAN_COMPLETED,
      payload: {
        tenantId: params.tenantId,
        jobId: params.jobId,
        domainId: params.domainId,
        domainName: params.domainName,
        companyId: params.companyId,
        companyName: params.companyName,
        totalFindings: params.totalFindings,
        criticalCveCount: params.criticalCveCount,
        highCveCount: params.highCveCount,
        openPortsCount: params.openPortsCount,
        duration: params.duration,
      },
    } as Omit<GuardAsmScanCompletedEvent, 'id' | 'timestamp'>);

    logger.debug('Published GUARD_ASM_SCAN_COMPLETED event', {
      tenantId: params.tenantId,
      jobId: params.jobId,
      totalFindings: params.totalFindings,
    });
  } catch (error) {
    logger.error('Failed to publish GUARD_ASM_SCAN_COMPLETED event', {
      error,
      params,
    });
  }
}

export interface PublishAsmCriticalCveFoundParams {
  tenantId: string;
  jobId: string;
  domainId: string;
  domainName?: string;
  companyId?: string;
  companyName?: string;
  cveId: string;
  cvssScore?: number;
  severity: 'critical' | 'high';
  affectedAsset?: string;
  description?: string;
}

/**
 * Publish ASM critical CVE found event (triggers email notification)
 */
export async function publishAsmCriticalCveFound(
  params: PublishAsmCriticalCveFoundParams
): Promise<void> {
  try {
    await publishEvent({
      eventType: GUARD_EVENTS.ASM_CRITICAL_CVE_FOUND,
      payload: {
        tenantId: params.tenantId,
        jobId: params.jobId,
        domainId: params.domainId,
        domainName: params.domainName,
        companyId: params.companyId,
        companyName: params.companyName,
        cveId: params.cveId,
        cvssScore: params.cvssScore,
        severity: params.severity,
        affectedAsset: params.affectedAsset,
        description: params.description,
      },
    } as Omit<GuardAsmCriticalCveFoundEvent, 'id' | 'timestamp'>);

    logger.info('Published GUARD_ASM_CRITICAL_CVE_FOUND event', {
      tenantId: params.tenantId,
      jobId: params.jobId,
      cveId: params.cveId,
      severity: params.severity,
    });
  } catch (error) {
    logger.error('Failed to publish GUARD_ASM_CRITICAL_CVE_FOUND event', {
      error,
      params,
    });
  }
}

// ============================================================================
// SECURITY SCORE EVENT PUBLISHERS
// ============================================================================

export interface PublishScoreUpdatedParams {
  tenantId: string;
  companyId: string;
  companyName?: string;
  previousScore?: number;
  newScore: number;
  previousRiskLevel?: 'critical' | 'high' | 'moderate' | 'low';
  newRiskLevel: 'critical' | 'high' | 'moderate' | 'low';
  triggeredBy: 'pii_scan' | 'asm_scan' | 'manual' | 'scheduled';
  triggeredJobId?: string;
}

/**
 * Publish security score updated event
 */
export async function publishScoreUpdated(
  params: PublishScoreUpdatedParams
): Promise<void> {
  try {
    await publishEvent({
      eventType: GUARD_EVENTS.SCORE_UPDATED,
      payload: {
        tenantId: params.tenantId,
        companyId: params.companyId,
        companyName: params.companyName,
        previousScore: params.previousScore,
        newScore: params.newScore,
        previousRiskLevel: params.previousRiskLevel,
        newRiskLevel: params.newRiskLevel,
        triggeredBy: params.triggeredBy,
        triggeredJobId: params.triggeredJobId,
      },
    } as Omit<GuardScoreUpdatedEvent, 'id' | 'timestamp'>);

    logger.debug('Published GUARD_SCORE_UPDATED event', {
      tenantId: params.tenantId,
      companyId: params.companyId,
      newScore: params.newScore,
      newRiskLevel: params.newRiskLevel,
    });
  } catch (error) {
    logger.error('Failed to publish GUARD_SCORE_UPDATED event', {
      error,
      params,
    });
  }
}

export interface PublishScoreCriticalThresholdParams {
  tenantId: string;
  companyId: string;
  companyName?: string;
  score: number;
  previousScore?: number;
  previousRiskLevel?: 'critical' | 'high' | 'moderate' | 'low';
  topIssues?: Array<{
    type: string;
    count: number;
    penalty: number;
  }>;
}

/**
 * Publish security score critical threshold event (triggers email notification)
 */
export async function publishScoreCriticalThreshold(
  params: PublishScoreCriticalThresholdParams
): Promise<void> {
  try {
    await publishEvent({
      eventType: GUARD_EVENTS.SCORE_CRITICAL_THRESHOLD,
      payload: {
        tenantId: params.tenantId,
        companyId: params.companyId,
        companyName: params.companyName,
        score: params.score,
        riskLevel: 'critical' as const,
        previousScore: params.previousScore,
        previousRiskLevel: params.previousRiskLevel,
        topIssues: params.topIssues,
      },
    } as Omit<GuardScoreCriticalThresholdEvent, 'id' | 'timestamp'>);

    logger.info('Published GUARD_SCORE_CRITICAL_THRESHOLD event', {
      tenantId: params.tenantId,
      companyId: params.companyId,
      score: params.score,
    });
  } catch (error) {
    logger.error('Failed to publish GUARD_SCORE_CRITICAL_THRESHOLD event', {
      error,
      params,
    });
  }
}
