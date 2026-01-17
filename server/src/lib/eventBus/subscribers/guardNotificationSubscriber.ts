/**
 * Guard Notification Subscriber
 *
 * Handles Alga Guard events and sends email/internal notifications for:
 * - High severity PII findings (F165)
 * - Critical security score threshold breaches (F166)
 */

import { getEventBus } from '../index';
import { EventType } from '@shared/workflow/streams/eventBusSchema';
import type {
  GuardPiiHighSeverityFoundEvent,
  GuardAsmCriticalCveFoundEvent,
  GuardScoreCriticalThresholdEvent,
} from '../events';
import { sendEventEmail, SendEmailParams } from '../../notifications/sendEventEmail';
import logger from '@shared/core/logger';
import { createTenantKnex } from '../../db';
import { getEmailEventChannel } from '../../notifications/emailChannel';
import { StaticTemplateProcessor, EmailTemplateContent } from '../../email/tenant/templateProcessors';

// Event handler references for unsubscribe
let piiHighSeverityHandler: ((event: GuardPiiHighSeverityFoundEvent) => Promise<void>) | null = null;
let asmCriticalCveHandler: ((event: GuardAsmCriticalCveFoundEvent) => Promise<void>) | null = null;
let scoreCriticalHandler: ((event: GuardScoreCriticalThresholdEvent) => Promise<void>) | null = null;

// ============================================================================
// EMAIL TEMPLATE DEFINITIONS
// ============================================================================

/**
 * Email template for guard-pii-alert (F167)
 */
const PII_ALERT_TEMPLATE = {
  subject: 'Security Alert: High Severity PII Found - {{companyName}}',
  html: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #dc2626;">Security Alert: High Severity PII Detected</h2>

      <p>A security scan has detected high-severity personally identifiable information (PII) in your managed environment.</p>

      <div style="background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 16px; margin: 16px 0;">
        <h3 style="margin: 0 0 8px 0; color: #991b1b;">Finding Details</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 4px 0; color: #666;">Company:</td>
            <td style="padding: 4px 0; font-weight: bold;">{{companyName}}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #666;">PII Type:</td>
            <td style="padding: 4px 0; font-weight: bold;">{{piiType}}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #666;">Severity:</td>
            <td style="padding: 4px 0; font-weight: bold; color: #dc2626; text-transform: uppercase;">{{severity}}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #666;">Matches Found:</td>
            <td style="padding: 4px 0; font-weight: bold;">{{count}}</td>
          </tr>
        </table>
      </div>

      <p>We recommend immediate review and remediation of these findings to protect sensitive data and maintain compliance.</p>

      <p style="margin-top: 24px;">
        <a href="{{dashboardUrl}}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">View in Security Dashboard</a>
      </p>

      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
      <p style="color: #666; font-size: 12px;">This is an automated security notification from Alga Guard.</p>
    </div>
  `,
};

/**
 * Email template for guard-score-critical (F168)
 */
const SCORE_CRITICAL_TEMPLATE = {
  subject: 'Critical Security Alert: Score Below Threshold - {{companyName}}',
  html: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #dc2626;">Critical Security Alert: Score Threshold Breached</h2>

      <p>The security score for a managed client has fallen into the <strong>critical</strong> risk category.</p>

      <div style="background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 16px; margin: 16px 0;">
        <h3 style="margin: 0 0 8px 0; color: #991b1b;">Security Score Details</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 4px 0; color: #666;">Company:</td>
            <td style="padding: 4px 0; font-weight: bold;">{{companyName}}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #666;">Current Score:</td>
            <td style="padding: 4px 0; font-weight: bold; color: #dc2626; font-size: 24px;">{{score}}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #666;">Risk Level:</td>
            <td style="padding: 4px 0; font-weight: bold; color: #dc2626; text-transform: uppercase;">CRITICAL</td>
          </tr>
          {{#if previousScore}}
          <tr>
            <td style="padding: 4px 0; color: #666;">Previous Score:</td>
            <td style="padding: 4px 0;">{{previousScore}} ({{previousRiskLevel}})</td>
          </tr>
          {{/if}}
        </table>
      </div>

      {{#if topIssues}}
      <h3 style="margin-top: 24px;">Top Contributing Issues</h3>
      <ul>
        {{#each topIssues}}
        <li><strong>{{type}}</strong>: {{count}} findings ({{penalty}} penalty points)</li>
        {{/each}}
      </ul>
      {{/if}}

      <p>Immediate action is recommended to address the security vulnerabilities contributing to this score.</p>

      <p style="margin-top: 24px;">
        <a href="{{dashboardUrl}}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">View Security Dashboard</a>
      </p>

      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
      <p style="color: #666; font-size: 12px;">This is an automated security notification from Alga Guard.</p>
    </div>
  `,
};

/**
 * Email template for guard-asm-cve-critical
 */
const ASM_CVE_CRITICAL_TEMPLATE = {
  subject: 'Critical Vulnerability Alert: {{cveId}} - {{companyName}}',
  html: `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #dc2626;">Critical Vulnerability Detected</h2>

      <p>An attack surface scan has detected a critical vulnerability affecting your managed client.</p>

      <div style="background-color: #fef2f2; border-left: 4px solid #dc2626; padding: 16px; margin: 16px 0;">
        <h3 style="margin: 0 0 8px 0; color: #991b1b;">Vulnerability Details</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 4px 0; color: #666;">Company:</td>
            <td style="padding: 4px 0; font-weight: bold;">{{companyName}}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #666;">Domain:</td>
            <td style="padding: 4px 0; font-weight: bold;">{{domainName}}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #666;">CVE ID:</td>
            <td style="padding: 4px 0; font-weight: bold;">{{cveId}}</td>
          </tr>
          {{#if cvssScore}}
          <tr>
            <td style="padding: 4px 0; color: #666;">CVSS Score:</td>
            <td style="padding: 4px 0; font-weight: bold; color: #dc2626;">{{cvssScore}}</td>
          </tr>
          {{/if}}
          <tr>
            <td style="padding: 4px 0; color: #666;">Severity:</td>
            <td style="padding: 4px 0; font-weight: bold; color: #dc2626; text-transform: uppercase;">{{severity}}</td>
          </tr>
          {{#if affectedAsset}}
          <tr>
            <td style="padding: 4px 0; color: #666;">Affected Asset:</td>
            <td style="padding: 4px 0; font-weight: bold;">{{affectedAsset}}</td>
          </tr>
          {{/if}}
        </table>
      </div>

      {{#if description}}
      <h3>Description</h3>
      <p>{{description}}</p>
      {{/if}}

      <p>Immediate patching and remediation is recommended for this vulnerability.</p>

      <p style="margin-top: 24px;">
        <a href="{{dashboardUrl}}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px;">View in ASM Dashboard</a>
      </p>

      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
      <p style="color: #666; font-size: 12px;">This is an automated security notification from Alga Guard.</p>
    </div>
  `,
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get the base URL for dashboard links
 */
function getBaseUrl(): string {
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

/**
 * Get security administrators who should receive notifications
 */
async function getSecurityAdminEmails(tenantId: string): Promise<string[]> {
  const { knex: db } = await createTenantKnex();

  // Find users with guard:* permissions (security administrators)
  const admins = await db('users as u')
    .join('user_roles as ur', 'u.user_id', 'ur.user_id')
    .join('roles as r', 'ur.role_id', 'r.role_id')
    .join('role_permissions as rp', 'r.role_id', 'rp.role_id')
    .join('permissions as p', 'rp.permission_id', 'p.permission_id')
    .where('u.tenant', tenantId)
    .where('p.resource', 'like', 'guard:%')
    .whereNotNull('u.email')
    .select('u.email')
    .distinct();

  const emails = admins.map((a: { email: string }) => a.email).filter(Boolean);

  // If no specific guard admins, fall back to tenant admins
  if (emails.length === 0) {
    const tenantAdmins = await db('users as u')
      .join('user_roles as ur', 'u.user_id', 'ur.user_id')
      .join('roles as r', 'ur.role_id', 'r.role_id')
      .where('u.tenant', tenantId)
      .where('r.role_name', 'in', ['tenant_admin', 'msp_admin'])
      .whereNotNull('u.email')
      .select('u.email')
      .distinct();

    return tenantAdmins.map((a: { email: string }) => a.email).filter(Boolean);
  }

  return emails;
}

/**
 * Process a static template with data
 */
async function processTemplate(
  template: { subject: string; html: string },
  data: Record<string, unknown>
): Promise<EmailTemplateContent> {
  const processor = new StaticTemplateProcessor(
    template.subject,
    template.html
  );
  return processor.process({ templateData: data });
}

// ============================================================================
// EVENT HANDLERS
// ============================================================================

/**
 * Handle PII high severity found event (F165)
 */
async function handlePiiHighSeverityFound(
  event: GuardPiiHighSeverityFoundEvent
): Promise<void> {
  const { payload } = event;
  const {
    tenantId,
    jobId,
    profileId,
    profileName,
    companyId,
    companyName,
    piiType,
    count,
    severity,
  } = payload;

  logger.info('[GuardNotificationSubscriber] Processing PII high severity event', {
    tenantId,
    jobId,
    piiType,
    severity,
  });

  try {
    const recipients = await getSecurityAdminEmails(tenantId);

    if (recipients.length === 0) {
      logger.warn('[GuardNotificationSubscriber] No recipients found for PII alert', {
        tenantId,
      });
      return;
    }

    const dashboardUrl = `${getBaseUrl()}/msp/guard/pii/jobs/${jobId}`;

    const templateData = {
      companyName: companyName || 'Unknown Company',
      profileName: profileName || 'Unknown Profile',
      piiType,
      count,
      severity,
      dashboardUrl,
    };

    const content = await processTemplate(PII_ALERT_TEMPLATE, templateData);

    // Send to each recipient
    for (const email of recipients) {
      try {
        await sendEventEmail({
          tenantId,
          to: email,
          subject: content.subject,
          template: 'guard-pii-alert',
          context: templateData,
        });

        logger.debug('[GuardNotificationSubscriber] Sent PII alert email', {
          tenantId,
          to: email,
          piiType,
        });
      } catch (emailError) {
        logger.error('[GuardNotificationSubscriber] Failed to send PII alert email', {
          tenantId,
          to: email,
          error: emailError,
        });
      }
    }
  } catch (error) {
    logger.error('[GuardNotificationSubscriber] Error handling PII high severity event', {
      tenantId,
      error,
    });
  }
}

/**
 * Handle ASM critical CVE found event
 */
async function handleAsmCriticalCveFound(
  event: GuardAsmCriticalCveFoundEvent
): Promise<void> {
  const { payload } = event;
  const {
    tenantId,
    jobId,
    domainId,
    domainName,
    companyId,
    companyName,
    cveId,
    cvssScore,
    severity,
    affectedAsset,
    description,
  } = payload;

  logger.info('[GuardNotificationSubscriber] Processing ASM critical CVE event', {
    tenantId,
    jobId,
    cveId,
    severity,
  });

  try {
    const recipients = await getSecurityAdminEmails(tenantId);

    if (recipients.length === 0) {
      logger.warn('[GuardNotificationSubscriber] No recipients found for CVE alert', {
        tenantId,
      });
      return;
    }

    const dashboardUrl = `${getBaseUrl()}/msp/guard/asm/jobs/${jobId}`;

    const templateData = {
      companyName: companyName || 'Unknown Company',
      domainName: domainName || 'Unknown Domain',
      cveId,
      cvssScore,
      severity,
      affectedAsset,
      description,
      dashboardUrl,
    };

    const content = await processTemplate(ASM_CVE_CRITICAL_TEMPLATE, templateData);

    for (const email of recipients) {
      try {
        await sendEventEmail({
          tenantId,
          to: email,
          subject: content.subject,
          template: 'guard-asm-cve-critical',
          context: templateData,
        });

        logger.debug('[GuardNotificationSubscriber] Sent CVE alert email', {
          tenantId,
          to: email,
          cveId,
        });
      } catch (emailError) {
        logger.error('[GuardNotificationSubscriber] Failed to send CVE alert email', {
          tenantId,
          to: email,
          error: emailError,
        });
      }
    }
  } catch (error) {
    logger.error('[GuardNotificationSubscriber] Error handling ASM critical CVE event', {
      tenantId,
      error,
    });
  }
}

/**
 * Handle security score critical threshold event (F166)
 */
async function handleScoreCriticalThreshold(
  event: GuardScoreCriticalThresholdEvent
): Promise<void> {
  const { payload } = event;
  const {
    tenantId,
    companyId,
    companyName,
    score,
    previousScore,
    previousRiskLevel,
    topIssues,
  } = payload;

  logger.info('[GuardNotificationSubscriber] Processing score critical threshold event', {
    tenantId,
    companyId,
    score,
  });

  try {
    const recipients = await getSecurityAdminEmails(tenantId);

    if (recipients.length === 0) {
      logger.warn('[GuardNotificationSubscriber] No recipients found for score alert', {
        tenantId,
      });
      return;
    }

    const dashboardUrl = `${getBaseUrl()}/msp/guard/scores/${companyId}`;

    const templateData = {
      companyName: companyName || 'Unknown Company',
      companyId,
      score,
      previousScore,
      previousRiskLevel,
      topIssues,
      dashboardUrl,
    };

    const content = await processTemplate(SCORE_CRITICAL_TEMPLATE, templateData);

    for (const email of recipients) {
      try {
        await sendEventEmail({
          tenantId,
          to: email,
          subject: content.subject,
          template: 'guard-score-critical',
          context: templateData,
        });

        logger.debug('[GuardNotificationSubscriber] Sent score critical alert email', {
          tenantId,
          to: email,
          score,
        });
      } catch (emailError) {
        logger.error('[GuardNotificationSubscriber] Failed to send score critical email', {
          tenantId,
          to: email,
          error: emailError,
        });
      }
    }
  } catch (error) {
    logger.error('[GuardNotificationSubscriber] Error handling score critical threshold event', {
      tenantId,
      error,
    });
  }
}

// ============================================================================
// SUBSCRIBER REGISTRATION
// ============================================================================

/**
 * Register Guard notification subscriber
 */
export async function registerGuardNotificationSubscriber(): Promise<void> {
  const eventBus = getEventBus();
  const channel = getEmailEventChannel();

  // Create handler wrappers
  piiHighSeverityHandler = async (event: GuardPiiHighSeverityFoundEvent) => {
    await handlePiiHighSeverityFound(event);
  };

  asmCriticalCveHandler = async (event: GuardAsmCriticalCveFoundEvent) => {
    await handleAsmCriticalCveFound(event);
  };

  scoreCriticalHandler = async (event: GuardScoreCriticalThresholdEvent) => {
    await handleScoreCriticalThreshold(event);
  };

  // Subscribe to Guard events on the email channel
  await eventBus.subscribe(
    'GUARD_PII_HIGH_SEVERITY_FOUND' as EventType,
    piiHighSeverityHandler as any,
    { channel }
  );

  await eventBus.subscribe(
    'GUARD_ASM_CRITICAL_CVE_FOUND' as EventType,
    asmCriticalCveHandler as any,
    { channel }
  );

  await eventBus.subscribe(
    'GUARD_SCORE_CRITICAL_THRESHOLD' as EventType,
    scoreCriticalHandler as any,
    { channel }
  );

  logger.info('[GuardNotificationSubscriber] Registered Guard notification subscriber', {
    channel,
    events: [
      'GUARD_PII_HIGH_SEVERITY_FOUND',
      'GUARD_ASM_CRITICAL_CVE_FOUND',
      'GUARD_SCORE_CRITICAL_THRESHOLD',
    ],
  });
}

/**
 * Unregister Guard notification subscriber
 */
export async function unregisterGuardNotificationSubscriber(): Promise<void> {
  const eventBus = getEventBus();
  const channel = getEmailEventChannel();

  if (piiHighSeverityHandler) {
    await eventBus.unsubscribe(
      'GUARD_PII_HIGH_SEVERITY_FOUND' as EventType,
      piiHighSeverityHandler as any,
      { channel }
    );
    piiHighSeverityHandler = null;
  }

  if (asmCriticalCveHandler) {
    await eventBus.unsubscribe(
      'GUARD_ASM_CRITICAL_CVE_FOUND' as EventType,
      asmCriticalCveHandler as any,
      { channel }
    );
    asmCriticalCveHandler = null;
  }

  if (scoreCriticalHandler) {
    await eventBus.unsubscribe(
      'GUARD_SCORE_CRITICAL_THRESHOLD' as EventType,
      scoreCriticalHandler as any,
      { channel }
    );
    scoreCriticalHandler = null;
  }

  logger.info('[GuardNotificationSubscriber] Unregistered Guard notification subscriber');
}
