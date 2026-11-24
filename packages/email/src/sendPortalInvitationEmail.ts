'use server'

import { getSystemEmailService, TenantEmailService } from './index';
import { DatabaseTemplateProcessor, StaticTemplateProcessor } from './templateProcessors';
import { getConnection, runWithTenant } from '@alga-psa/db';
import { getUserInfoForEmail, resolveEmailLocale } from './emailLocaleResolver';
import { SupportedLocale } from './lib/localeConfig';
import logger from '@alga-psa/core/logger';

interface SendPortalInvitationEmailParams {
  email: string;
  contactName: string;
  clientName: string;      // Recipient's own client company
  tenantName?: string;     // MSP sending the invitation
  portalLink: string;
  /** Tenant's invitation validity in whole days; rendered in the language of the template that is sent. */
  validityDays: number;
  tenant: string;
  supportEmail?: string;   // MSP support contact shown to the recipient
  supportPhone?: string;
  fromName?: string;
  recipientUserId?: string;
  clientId?: string;  // Client ID (from contact.company_id) for locale resolution when user doesn't exist yet
}

/**
 * "7 days" / "7 Tage" / "1 day" in the language of the template that carries it.
 * The templates interpolate the rendered string as `{{expirationTime}}`, so a
 * German invitation no longer reads "läuft in 24 hours ab" — and an English
 * template sent to a German recipient (a tenant that keeps an English-only copy)
 * does not read "expire in 14 Tage" either.
 */
function formatValidityDuration(locale: SupportedLocale, validityDays: number): string {
  const days = Number.isFinite(validityDays) ? Math.max(1, Math.round(validityDays)) : 1;
  return new Intl.NumberFormat(locale, { style: 'unit', unit: 'day', unitDisplay: 'long' }).format(days);
}

export async function sendPortalInvitationEmail({
  email,
  contactName,
  clientName,
  tenantName,
  portalLink,
  validityDays,
  tenant,
  supportEmail,
  supportPhone,
  fromName,
  recipientUserId,
  clientId
}: SendPortalInvitationEmailParams): Promise<boolean> {
  try {
    return await runWithTenant(tenant, async () => {
      const knex = await getConnection(tenant);

      // Resolve recipient locale for language-aware email
      let recipientLocale: SupportedLocale;

      // Get recipient information for locale resolution
      // For portal invitations, we need to include clientId for contacts who don't have user accounts yet
      const baseInfo = recipientUserId
        ? { email, userId: recipientUserId }
        : await getUserInfoForEmail(tenant, email) || { email };

      const recipientInfo = {
        ...baseInfo,
        ...(clientId && { clientId }) // Add clientId if provided, ensures it's used even when user doesn't exist yet
      };

      logger.info('[SendPortalInvitationEmail] Recipient info:', recipientInfo);

      // Portal invitations are ALWAYS for client users (contacts), never internal users
      // So we should always do full locale resolution with client/tenant hierarchy
      recipientLocale = await resolveEmailLocale(tenant, recipientInfo);
      logger.info('[SendPortalInvitationEmail] Resolved locale:', {
        locale: recipientLocale,
        email,
        userId: recipientInfo.userId,
        clientId: recipientInfo.clientId
      });

      // Resolve the template once, before the body is rendered: the row that
      // wins the lookup (tenant locale -> tenant en -> system locale -> system
      // en) decides both the wording of the email and the language the validity
      // has to be written in. A tenant with an English-only copy of
      // 'portal-invitation' sends English to a German recipient, and that email
      // must say "14 days", not "14 Tage".
      const template = await new DatabaseTemplateProcessor(knex, 'portal-invitation')
        .resolveTemplate({ tenantId: tenant, locale: recipientLocale });
      logger.info('[SendPortalInvitationEmail] Selected template language:', {
        templateLanguage: template.language,
        recipientLocale
      });

      // Prepare template data. clientLocationEmail/clientLocationPhone are kept
      // as aliases of the support contact so template rows that predate the
      // supportEmail/supportPhone rename still render the right values.
      const resolvedSupportEmail = supportEmail || 'Not provided';
      const resolvedSupportPhone = supportPhone || 'Not provided';
      const templateData = {
        contactName,
        clientName,
        tenantName: tenantName || clientName,
        portalLink,
        expirationTime: formatValidityDuration(template.language, validityDays),
        currentYear: new Date().getFullYear(),
        supportEmail: resolvedSupportEmail,
        supportPhone: resolvedSupportPhone,
        clientLocationEmail: resolvedSupportEmail,
        clientLocationPhone: resolvedSupportPhone
      };

      const tenantEmailService = TenantEmailService.getInstance(tenant);
      // The resolved row is handed to both providers, so the system fallback
      // renders the same body in the same language as the tenant attempt.
      const emailParams = {
        mailClass: 'account' as const,
        to: email,
        templateProcessor: new StaticTemplateProcessor(template.subject, template.html, template.text),
        templateData,
        locale: recipientLocale,
        fromName,
        replyTo: supportEmail // MSP support email as reply-to
      };

      let result = await tenantEmailService.sendEmail({
        ...emailParams,
        tenantId: tenant
      });

      if (!result.success) {
        logger.warn('[SendPortalInvitationEmail] Tenant email provider failed, falling back to system provider', {
          tenant,
          error: result.error || 'unknown_error'
        });
        const systemEmailService = await getSystemEmailService();
        result = await systemEmailService.sendEmail({
          ...emailParams,
          tenantId: tenant
        });
      }

      if (!result.success) {
        logger.error('Failed to send portal invitation email:', result.error);
        // Throw error to trigger transaction rollback
        throw new Error(result.error || 'Failed to send portal invitation email');
      }

      return result.success;
    });
  } catch (error) {
    logger.error('Error sending portal invitation email:', error);
    // Re-throw the error to ensure transaction rollback
    throw error;
  }
}
