import { NextRequest, NextResponse } from 'next/server';
import { 
  checkAuthVerificationLimit, 
  formatRateLimitError,
  logSecurityEvent 
} from '@/lib/security/rateLimiting';
import { observability, observabilityLogger, observabilityMetrics } from '@/lib/observability';
import { verifyPassword } from '@/utils/encryption/encryption';
import { withAdminTransaction } from '@alga-psa/db';
import { withNmStoreApiKey } from '@ee/lib/middleware/withNmStoreApiKey';

// Interface definitions
interface AuthVerifyRequest {
  email: string;
  password: string;
}

interface AuthVerifyResponse {
  success: boolean;
  tenant?: {
    id: string;
    name: string;
    email: string;
    adminEmail: string;
    status: 'active' | 'suspended' | 'cancelled';
  };
  user?: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
  };
  error?: string;
}

// Helper function to verify tenant credentials
async function verifyTenantCredentials(email: string, password: string) {
  return await observability.timeOperation(
    'auth.verify_credentials',
    async () => {
      try {
        // Use admin connection since we don't have tenant context yet
        return await withAdminTransaction(async (trx) => {
          // Query for user by email across all tenants
          const user = await trx('users')
            .where('email', email)
            .where('is_active', true)
            .first();
          
          if (!user) {
            observabilityLogger.info('Auth failed - user not found', { email });
            return { success: false, error: 'Invalid credentials', reason: 'user_not_found' };
          }
          
          // Verify password using PBKDF2 (NOT bcrypt)
          const isValidPassword = await verifyPassword(password, user.hashed_password);
          
          if (!isValidPassword) {
            observabilityLogger.info('Auth failed - invalid password', { email });
            return { success: false, error: 'Invalid credentials', reason: 'invalid_password' };
          }
          
          // Get tenant information using the same transaction
          const tenant = await trx('tenants')
            .where('id', user.tenant_id)
            .where('status', 'active')
            .first();
          
          if (!tenant) {
            observabilityLogger.info('Auth failed - tenant not active', { 
              email, 
              tenantId: user.tenant_id 
            });
            return { success: false, error: 'Account not active', reason: 'tenant_inactive' };
          }
          
          // Log successful authentication
          await logSecurityEvent(tenant.id, 'auth_success', {
            userId: user.id,
            email: user.email,
            tenantId: tenant.id
          });
          
          return {
            success: true,
            tenantId: tenant.id,
            userId: user.id,
            tenant: {
              id: tenant.id,
              name: tenant.client_name,
              email: tenant.email,
              adminEmail: tenant.admin_email,
              status: tenant.status
            },
            user: {
              id: user.id,
              email: user.email,
              firstName: user.first_name,
              lastName: user.last_name,
              role: user.role
            }
          };
        });
      } catch (error) {
        observabilityLogger.error('Database error during auth', error);
        return { success: false, error: 'Authentication failed', reason: 'database_error' };
      }
    },
    {
      type: 'database',
      table: 'users',
    }
  );
}

export const POST = withNmStoreApiKey(async (req: NextRequest) => {
  const startTime = Date.now();
  const clientIp = req.headers.get('x-forwarded-for') || req.ip || 'unknown';
  
  // Use observability.timeOperation for automatic tracing, metrics, and logging
  return await observability.timeOperation(
    'auth.verify',
    async () => {
      // Parse request body
      let body: AuthVerifyRequest;
      try {
        body = await req.json();
      } catch (error) {
        return NextResponse.json(
          { success: false, error: 'Invalid request body' },
          { status: 400 }
        );
      }
      
      const { email, password } = body;
      
      if (!email || !password) {
        return NextResponse.json(
          { success: false, error: 'Email and password are required' },
          { status: 400 }
        );
      }
      
      // Apply rate limiting
      const rateLimit = await checkAuthVerificationLimit(clientIp);
      
      if (!rateLimit.success) {
        const errorMessage = await formatRateLimitError(rateLimit.msBeforeNext);
        
        // Log security event
        await logSecurityEvent('production', 'auth_rate_limited', {
          clientIp,
          email,
          endpoint: '/api/v1/auth/verify'
        });
        
        // Return rate limit response with headers
        return NextResponse.json(
          { success: false, error: errorMessage },
          { 
            status: 429,
            headers: {
              'X-RateLimit-Limit': '5',
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': new Date(Date.now() + (rateLimit.msBeforeNext || 300000)).toISOString(),
              'Retry-After': Math.ceil((rateLimit.msBeforeNext || 300000) / 1000).toString(),
            }
          }
        );
      }
      
      // Log auth attempt with structured logging
      observabilityLogger.info('Auth verification attempt', {
        event_type: 'auth_attempt',
        auth_method: 'credentials',
        auth_source: 'nm-store',
        client_ip: clientIp,
        email: email,
        remaining_attempts: rateLimit.remainingPoints,
      });
      
      // Verify credentials
      const authResult = await verifyTenantCredentials(email, password);
      
      if (authResult.success && authResult.tenant && authResult.user) {
        // Log successful auth
        observabilityLogger.info('Auth verification successful', {
          event_type: 'auth_success',
          tenant_id: authResult.tenantId,
          user_id: authResult.userId,
        });
        
        // Track auth pattern using business metrics
        observabilityMetrics.recordAuthAttempt('credentials', true, Date.now() - startTime, undefined, authResult.tenantId);
        
        const response: AuthVerifyResponse = {
          success: true,
          tenant: authResult.tenant,
          user: authResult.user,
        };
        
        return NextResponse.json(response, { status: 200 });
      } else {
        // Log failed auth
        observabilityLogger.warn('Auth verification failed', {
          event_type: 'auth_failure',
          failure_reason: authResult.reason,
          email: email,
        });
        
        // Track auth pattern
        observabilityMetrics.recordAuthAttempt('credentials', false, Date.now() - startTime, authResult.reason);
        
        // Log security event for failed attempts
        await logSecurityEvent('production', 'auth_failed', {
          clientIp,
          email,
          reason: authResult.reason,
        });
        
        const response: AuthVerifyResponse = {
          success: false,
          error: authResult.error || 'Invalid credentials',
        };
        
        return NextResponse.json(response, { status: 401 });
      }
    },
    {
      type: 'http',
      method: 'POST',
      route: '/api/v1/auth/verify',
      tenantId: undefined, // Will be set if auth succeeds
    }
  );
});
