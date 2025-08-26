'use server'

import { getSystemEmailService } from './index';
import { DatabaseTemplateProcessor } from '../services/email/templateProcessors';
import { getConnection } from '../db/db';
import { runWithTenant } from '../db/index';
import logger from '@alga-psa/shared/core/logger.js';

interface SendPasswordResetEmailParams {
  email: string;
  userName: string;
  resetLink: string;
  expirationTime: string;
  tenant: string;
  supportEmail: string;
  companyName: string;
}

export async function sendPasswordResetEmail({ 
  email, 
  userName,
  resetLink,
  expirationTime,
  tenant,
  supportEmail,
  companyName
}: SendPasswordResetEmailParams): Promise<boolean> {
  logger.info('[sendPasswordResetEmail] Starting email send for:', email);
  logger.info('[sendPasswordResetEmail] Tenant:', tenant);
  
  try {
    return await runWithTenant(tenant, async () => {
      logger.info('[sendPasswordResetEmail] Getting connection for tenant:', tenant);
      const knex = await getConnection(tenant);
      
      // Prepare template data
      const templateData = {
        userName,
        email,
        resetLink,
        expirationTime,
        supportEmail,
        companyName,
        currentYear: new Date().getFullYear()
      };

      // Create database template processor to get the template from tenant DB
      logger.info('[sendPasswordResetEmail] Creating template processor for password-reset template');
      const templateProcessor = new DatabaseTemplateProcessor(knex, 'password-reset');

      // Use SystemEmailService for better deliverability
      logger.info('[sendPasswordResetEmail] Getting system email service...');
      const systemEmailService = await getSystemEmailService();
      
      logger.info('[sendPasswordResetEmail] Sending email via SystemEmailService');
      const result = await systemEmailService.sendEmail({
        to: email,
        templateProcessor,
        templateData,
        replyTo: supportEmail // Support email as reply-to
      });
      
      logger.info('[sendPasswordResetEmail] Email send result:', result);

      if (!result.success) {
        logger.error('[sendPasswordResetEmail] Failed to send password reset email:', result.error);
        // Throw error to trigger transaction rollback
        throw new Error(result.error || 'Failed to send password reset email');
      }

      logger.info('[sendPasswordResetEmail] Email sent successfully');
      return result.success;
    });
  } catch (error) {
    logger.error('[sendPasswordResetEmail] Error sending password reset email:', error);
    logger.error('[sendPasswordResetEmail] Error stack:', (error as any).stack);
    // Re-throw the error to ensure transaction rollback
    throw error;
  }
}