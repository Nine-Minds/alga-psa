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
  try {
    return await runWithTenant(tenant, async () => {
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
      const templateProcessor = new DatabaseTemplateProcessor(knex, 'password-reset');

      // Use SystemEmailService for better deliverability
      const systemEmailService = await getSystemEmailService();
      const result = await systemEmailService.sendEmail({
        to: email,
        templateProcessor,
        templateData,
        replyTo: supportEmail // Support email as reply-to
      });

      if (!result.success) {
        logger.error('Failed to send password reset email:', result.error);
        // Throw error to trigger transaction rollback
        throw new Error(result.error || 'Failed to send password reset email');
      }

      return result.success;
    });
  } catch (error) {
    logger.error('Error sending password reset email:', error);
    // Re-throw the error to ensure transaction rollback
    throw error;
  }
}