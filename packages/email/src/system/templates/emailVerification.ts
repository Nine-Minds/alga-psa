'use server'

import { getSystemEmailService } from '../SystemEmailService';
import { EmailVerificationData } from '../types';
import logger from '@alga-psa/core/logger';

interface SendVerificationEmailParams {
  email: string;
  token: string;
  registrationId: string;
  clientName?: string;
}

/**
 * Send email verification using SystemEmailService
 * This is a system-level email that doesn't require tenant context
 */
export async function sendVerificationEmail({ 
  email, 
  token, 
  registrationId,
  clientName
}: SendVerificationEmailParams): Promise<boolean> {
  try {
    // Get the base URL from environment variable or default to localhost
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const verificationUrl = `${baseUrl}/auth/verify?token=${token}&registrationId=${registrationId}`;

    const emailData: EmailVerificationData = {
      email,
      verificationUrl,
      clientName,
      expirationTime: '24 hours'
    };

    const systemEmailService = await getSystemEmailService();
    const result = await systemEmailService.sendEmailVerification(emailData);

    if (!result.success) {
      logger.error('Failed to send verification email:', result.error);
    }

    return result.success;
  } catch (error) {
    logger.error('Error sending verification email:', error);
    return false;
  }
}