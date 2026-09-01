'use server'

import { createTenantKnex, runWithTenant, tenantDb } from '@alga-psa/db';
import { PasswordResetService } from '@alga-psa/auth';
import { hashPassword } from '@alga-psa/core/encryption';

import { recoverPassword } from '../useRegister';

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
 *
 * @deprecated Use `recoverPassword(email, portal)` directly. This adapter maps
 * the legacy `internal|client` userType to the canonical `msp|client` portal
 * parameter and delegates to `recoverPassword`, which mints the JWT consumed by
 * the deployed `/auth/password-reset/set-new-password` page and returns the same
 * enumeration-safe success value for every public outcome.
 */
export async function requestPasswordReset(
  email: string,
  userType: 'internal' | 'client' = 'internal'
): Promise<RequestResetResult> {
  const portal = userType === 'client' ? 'client' : 'msp';
  await recoverPassword(email, portal);
  return {
    success: true,
    message: 'If an account exists with this email, you will receive a password reset link shortly.'
  };
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
      const { knex, tenant } = await createTenantKnex(tenantFromToken);

      if (!tenant) {
        return { success: false, message: 'System error', error: 'Tenant context is required' } as CompleteResetResult;
      }

      try {
        // Hash the new password
        const hashedPassword = await hashPassword(newPassword);

        // Update user's password
        await tenantDb(knex, tenant).table('users')
          .where({ 
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
          const UserPreferences = await import('@alga-psa/db').then(m => m.UserPreferences);
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
          await tenantDb(knex, tenant).table('audit_logs').insert({
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
