'use server'

import { getSystemEmailService, TenantEmailService } from './index';
import { DatabaseTemplateProcessor } from './templateProcessors';
import { getConnection, runWithTenant } from '@alga-psa/db';
import { getUserInfoForEmail, resolveEmailLocale } from './emailLocaleResolver';
import logger from '@alga-psa/core/logger';

interface SendPasswordResetEmailParams {
  email: string;
  userName: string;
  resetLink: string;
  expirationTime: string;
  tenant: string;
  supportEmail: string;
  clientName: string;
}

export async function sendPasswordResetEmail({
  email,
  userName,
  resetLink,
  expirationTime,
  tenant,
  supportEmail,
  clientName
}: SendPasswordResetEmailParams): Promise<boolean> {
  logger.info('[sendPasswordResetEmail] Starting email send', { email, tenant });

  try {
    return await runWithTenant(tenant, async () => {
      logger.info('[sendPasswordResetEmail] Getting connection for tenant:', tenant);
      const knex = await getConnection(tenant);

      // Resolve recipient locale for language-aware email
      const recipientInfo = await getUserInfoForEmail(tenant, email) || { email };

      // Internal users always get English (MSP portal doesn't support i18n)
      // Client portal users use preference hierarchy
      const recipientLocale = recipientInfo.userType === 'internal'
        ? 'en'
        : await resolveEmailLocale(tenant, recipientInfo);

      logger.info('[sendPasswordResetEmail] Resolved locale for password reset email:', {
        locale: recipientLocale,
        email,
        userId: recipientInfo.userId,
        userType: recipientInfo.userType
      });

      // Prepare template data
      const templateData = {
        userName,
        email,
        resetLink,
        expirationTime,
        supportEmail,
        clientName,
        currentYear: new Date().getFullYear()
      };

      // Create database template processor to get the template from tenant DB
      logger.info('[sendPasswordResetEmail] Creating template processor for password-reset template');
      const templateProcessor = new DatabaseTemplateProcessor(knex, 'password-reset');

      const emailParams = {
        to: email,
        templateProcessor,
        templateData,
        locale: recipientLocale, // Pass resolved locale
        tenantId: tenant,
        userId: recipientInfo.userId,
        replyTo: supportEmail // Support email as reply-to
      };

      const tenantEmailService = TenantEmailService.getInstance(tenant);

      logger.info('[sendPasswordResetEmail] Attempting to send via TenantEmailService');
      const tenantResult = await tenantEmailService.sendEmail(emailParams);

      if (tenantResult.success) {
        logger.info('[sendPasswordResetEmail] Email sent successfully via tenant service', {
          tenant,
          providerId: tenantResult.providerId,
          providerType: tenantResult.providerType
        });
        return true;
      }

      // Retain the tenant attempt's provider details and sanitized error before
      // considering the system fallback, so an actionable SMTP initialization
      // or send error is never masked by a later generic fallback message.
      logger.warn('[sendPasswordResetEmail] Tenant email send failed', {
        tenant,
        providerId: tenantResult.providerId ?? null,
        providerType: tenantResult.providerType ?? null,
        error: tenantResult.error || 'unknown_error'
      });

      // The tenant service may already have attempted the system provider (e.g.
      // Enterprise fallback when no tenant provider is enabled). Retrying it
      // through SystemEmailService would hit the same provider a second time.
      if (tenantResult.providerId === 'system-email-provider') {
        throw new Error(
          tenantResult.error || 'Failed to send password reset email via system email provider'
        );
      }

      // Preserve the existing system fallback. SystemEmailProviderFactory
      // (and therefore EMAIL_ENABLE) decides whether a system provider exists.
      logger.warn('[sendPasswordResetEmail] Falling back to SystemEmailService');
      const systemEmailService = await getSystemEmailService();
      const fallbackResult = await systemEmailService.sendEmail(emailParams);

      if (fallbackResult.success) {
        logger.info('[sendPasswordResetEmail] Email sent successfully via system fallback', {
          tenant,
          providerId: fallbackResult.providerId,
          providerType: fallbackResult.providerType
        });
        return true;
      }

      logger.error('[sendPasswordResetEmail] System email send failed', {
        tenant,
        providerId: fallbackResult.providerId ?? null,
        providerType: fallbackResult.providerType ?? null,
        error: fallbackResult.error || 'unknown_error'
      });

      // Both attempts failed: retain both causes so the tenant provider error
      // is not replaced by the generic system "disabled" message.
      throw new Error(
        `Failed to send password reset email: tenant attempt failed (${tenantResult.error || 'unknown_error'}), system fallback failed (${fallbackResult.error || 'unknown_error'})`
      );
    });
  } catch (error) {
    logger.error('[sendPasswordResetEmail] Error sending password reset email:', error);
    // Re-throw the error so recoverPassword can log its stable
    // password_recovery_send_failed event; the token and reset URL are never
    // included in the diagnostic.
    throw error;
  }
}
