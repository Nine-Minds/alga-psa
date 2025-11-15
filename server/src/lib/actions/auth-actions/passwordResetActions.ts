'use server'

import { createTenantKnex, runWithTenant } from '../../db';
import { getAdminConnection } from '@shared/db/admin';
import { PasswordResetService } from '../../services/PasswordResetService';
import { sendPasswordResetEmail } from '../../email/sendPasswordResetEmail';
import { getSystemEmailService } from '../../email';
import { TenantEmailService } from '../../services/TenantEmailService';
import { hashPassword } from 'server/src/utils/encryption/encryption';

export interface RequestResetResult {
  success: boolean;
  message: string;
  error?: string;
}

export interface VerifyResetTokenResult {
  success: boolean;
  user?: {
    user_id: string;
    username: string;
    email: string;
    first_name: string;
    last_name?: string;
    user_type: 'internal' | 'client';
  };
  error?: string;
}

export interface CompleteResetResult {
  success: boolean;
  message: string;
  error?: string;
}

/**
 * Request a password reset for an email address
 * This is a public action that doesn't require authentication
 */
export async function requestPasswordReset(
  email: string,
  userType: 'internal' | 'client' = 'internal'
): Promise<RequestResetResult> {
  console.log('[PasswordReset] Starting password reset request for:', email, 'userType:', userType);
  
  try {
    if (!email) {
      console.log('[PasswordReset] Email is required');
      return { success: false, message: 'Email is required', error: 'Email is required' };
    }

    // Normalize email
    const normalizedEmail = email.toLowerCase().trim();
    console.log('[PasswordReset] Normalized email:', normalizedEmail);

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return { success: false, message: 'Invalid email format', error: 'Invalid email format' };
    }

    // Use admin connection to search across all tenants
    // For public password reset, we need to find the tenant from the user's email
    console.log('[PasswordReset] Getting admin connection...');
    const adminKnex = await getAdminConnection();
    
    // Find user across all tenants (this is a special case for password reset)
    console.log('[PasswordReset] Searching for user with email:', normalizedEmail, 'and type:', userType);
    const userInfo = await adminKnex('users')
      .where({
        email: normalizedEmail,
        user_type: userType,
        is_inactive: false
      })
      .select('tenant', 'user_id', 'first_name', 'username')
      .first();
    
    console.log('[PasswordReset] User search result:', userInfo ? 'User found' : 'User not found');
    if (userInfo) {
      console.log('[PasswordReset] User details - tenant:', userInfo.tenant, 'user_id:', userInfo.user_id);
    }
    
    // Clean up admin connection
    await adminKnex.destroy();

    // Always return success for security (don't reveal if email exists)
    if (!userInfo) {
      console.log('[PasswordReset] No user found, returning success for security');
      return { 
        success: true, 
        message: 'If an account exists with this email, you will receive a password reset link shortly.' 
      };
    }

    // Now run the reset token creation in the user's tenant context
    console.log('[PasswordReset] Running with tenant context:', userInfo.tenant);
    const result = await runWithTenant(userInfo.tenant, async () => {
      const { knex: tenantKnex, tenant } = await createTenantKnex();

      if (!tenant) {
        console.error('[PasswordReset] Tenant context is missing!');
        throw new Error('Tenant context is required');
      }
      console.log('[PasswordReset] Tenant context established:', tenant);

      // Ensure at least one email provider path is configured before proceeding
      console.log('[PasswordReset] Checking tenant email service configuration...');
      const tenantEmailService = TenantEmailService.getInstance(tenant);
      let emailConfigured = await tenantEmailService.isConfigured();
      console.log('[PasswordReset] Tenant email configured:', emailConfigured);
      
      if (!emailConfigured) {
        console.log('[PasswordReset] Falling back to system email configuration check');
        const systemEmailService = await getSystemEmailService();
        emailConfigured = await systemEmailService.isConfigured();
        console.log('[PasswordReset] System email configured:', emailConfigured);
        if (!emailConfigured) {
          console.error('[PasswordReset] Neither tenant nor system email service is configured!');
          // Still return success for security
          return { 
            success: true, 
            message: 'If an account exists with this email, you will receive a password reset link shortly.' 
          };
        }
      }

      // Use a transaction to ensure atomicity
      const resetResult = await tenantKnex.transaction(async (trx) => {
        // Create reset token within transaction
        console.log('[PasswordReset] Creating reset token...');
        const tokenResult = await PasswordResetService.createResetTokenWithTransaction(
          normalizedEmail,
          userType,  // No conversion needed - use 'internal' directly
          trx,
          tenant
        );
        console.log('[PasswordReset] Token creation result:', tokenResult);

        if (!tokenResult.success || tokenResult.token === 'dummy') {
          // Either rate limited or user doesn't exist
          // Still return success for security
          console.log('[PasswordReset] Token creation failed or dummy token, skipping email');
          return { 
            success: true, 
            message: 'If an account exists with this email, you will receive a password reset link shortly.',
            skipEmail: true
          };
        }

        // Get the tenant's default client for email branding
        const tenantDefaultClient = await trx('tenant_companies')
          .join('clients', function() {
            this.on('clients.client_id', '=', 'tenant_companies.client_id')
                .andOn('clients.tenant', '=', 'tenant_companies.tenant');
          })
          .where({ 
            'tenant_companies.tenant': tenant,
            'tenant_companies.is_default': true 
          })
          .select('clients.*')
          .first();
        
        const clientName = tenantDefaultClient?.client_name || 'Our Platform';
        
        // Get support email from default location if available
        let supportEmail = 'support@example.com';
        if (tenantDefaultClient) {
          const defaultLocation = await trx('client_locations')
            .where({ 
              tenant, 
              client_id: tenantDefaultClient.client_id,
              is_default: true,
              is_active: true
            })
            .first();
          
          if (defaultLocation?.email) {
            supportEmail = defaultLocation.email;
          }
        }

        // Generate password reset URL
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || (process.env.HOST ? `https://${process.env.HOST}` : '');
        const resetUrl = `${baseUrl}/auth/reset-password?token=${encodeURIComponent(tokenResult.token || '')}`;

        // Calculate expiration time for display
        const expirationTime = '1 hour';

        // Send password reset email - if this fails, transaction will rollback
        console.log('[PasswordReset] Sending email to:', normalizedEmail);
        console.log('[PasswordReset] Reset URL:', resetUrl);
        console.log('[PasswordReset] Client name:', clientName);
        console.log('[PasswordReset] Support email:', supportEmail);
        
        await sendPasswordResetEmail({
          email: normalizedEmail,
          userName: userInfo.first_name || userInfo.username || normalizedEmail,
          resetLink: resetUrl,
          expirationTime: expirationTime,
          tenant: tenant,
          supportEmail: supportEmail,
          clientName: clientName
        });
        
        console.log('[PasswordReset] Email sent successfully');

        return {
          success: true,
          message: 'If an account exists with this email, you will receive a password reset link shortly.'
        };
      }).catch((error) => {
        console.error('[PasswordReset] Transaction failed:', error);
        console.error('[PasswordReset] Error stack:', error.stack);
        // Still return success for security
        return {
          success: true,
          message: 'If an account exists with this email, you will receive a password reset link shortly.'
        };
      });

      return resetResult;
    });

    return result;

  } catch (error) {
    console.error('[PasswordReset] Error requesting password reset:', error);
    console.error('[PasswordReset] Error stack:', error instanceof Error ? error.stack : 'No stack trace available');
    // Always return success for security (don't reveal errors)
    return { 
      success: true, 
      message: 'If an account exists with this email, you will receive a password reset link shortly.' 
    };
  }
}

/**
 * Verify a password reset token
 * This is a public action that doesn't require authentication
 */
export async function verifyPasswordResetToken(token: string): Promise<VerifyResetTokenResult> {
  try {
    if (!token) {
      return { success: false, error: 'Token is required' };
    }

    const verificationResult = await PasswordResetService.verifyToken(token);
    
    if (!verificationResult.valid) {
      return { success: false, error: verificationResult.error || 'Invalid or expired token' };
    }

    return {
      success: true,
      user: verificationResult.user
    };

  } catch (error) {
    console.error('Error verifying password reset token:', error);
    return { success: false, error: 'Failed to verify token' };
  }
}

/**
 * Complete password reset by setting new password
 * This is a public action that doesn't require authentication
 */
export async function completePasswordReset(
  token: string,
  newPassword: string
): Promise<CompleteResetResult> {
  try {
    if (!token || !newPassword) {
      return { success: false, message: 'Token and password are required', error: 'Missing required fields' };
    }

    // Validate password strength
    if (newPassword.length < 8) {
      return { success: false, message: 'Password must be at least 8 characters long', error: 'Password too short' };
    }

    // Verify token first and derive tenant from it
    const verificationResult = await PasswordResetService.verifyToken(token);
    if (!verificationResult.valid || !verificationResult.user || !verificationResult.tenant) {
      return { success: false, message: 'Invalid or expired reset token', error: 'Invalid token' };
    }

    const tenantFromToken = verificationResult.tenant;
    const user = verificationResult.user;

    // Run the password update in the token's tenant context
    const result = await runWithTenant(tenantFromToken, async () => {
      const { knex, tenant } = await createTenantKnex();

      if (!tenant) {
        return { success: false, message: 'System error', error: 'Tenant context is required' } as CompleteResetResult;
      }

      try {
        // Hash the new password
        const hashedPassword = await hashPassword(newPassword);

        // Update user's password
        await knex('users')
          .where({ 
            tenant,
            user_id: user.user_id 
          })
          .update({ 
            hashed_password: hashedPassword,
            updated_at: knex.raw('now()')
          });

        // Mark token as used
        const tokenMarked = await PasswordResetService.markTokenAsUsed(token);
        if (!tokenMarked) {
          console.warn('Failed to mark reset token as used');
        }

        // Update user preferences to indicate password has been reset
        try {
          const UserPreferences = await import('../../models/userPreferences').then(m => m.default);
          await UserPreferences.upsert(knex, {
            user_id: user.user_id,
            setting_name: 'has_reset_password',
            setting_value: true,
            updated_at: new Date()
          });
          
          // Clear any "must change password" flag
          await UserPreferences.upsert(knex, {
            user_id: user.user_id,
            setting_name: 'must_change_password',
            setting_value: false,
            updated_at: new Date()
          });
        } catch (prefError) {
          console.warn('Failed to update password reset preferences:', prefError);
        }

        // Trigger token cleanup
        await PasswordResetService.cleanupExpiredTokens();

        // Log security event
        try {
          await knex('audit_logs').insert({
            audit_id: knex.raw('gen_random_uuid()'),
            tenant: tenant,
            table_name: 'users',
            operation: 'PASSWORD_RESET',
            record_id: user.user_id,
            changed_data: {},
            details: { 
              operation: 'password_reset_completed',
              user_type: user.user_type
            },
            user_id: user.user_id,
            timestamp: knex.fn.now()
          });
        } catch (auditError) {
          console.warn('Failed to log password reset audit:', auditError);
        }

        return { 
          success: true, 
          message: 'Your password has been successfully reset. You can now sign in with your new password.' 
        } as CompleteResetResult;

      } catch (error) {
        console.error('Error updating password:', error);
        return { 
          success: false, 
          message: 'Failed to reset password', 
          error: 'Failed to update password' 
        } as CompleteResetResult;
      }
    });

    return result;

  } catch (error) {
    console.error('Error completing password reset:', error);
    return { success: false, message: 'Failed to reset password', error: 'System error' };
  }
}

/**
 * Get password reset history for audit purposes
 * Requires authentication and admin permissions
 */
export async function getPasswordResetHistory(userId: string): Promise<any[]> {
  try {
    const history = await PasswordResetService.getResetHistory(userId);
    
    return history.map(token => ({
      token_id: token.token_id,
      email: token.email,
      created_at: token.created_at,
      expires_at: token.expires_at,
      used_at: token.used_at,
      status: token.used_at ? 'used' : (new Date(token.expires_at) < new Date() ? 'expired' : 'pending')
    }));

  } catch (error) {
    console.error('Error fetching password reset history:', error);
    return [];
  }
}
