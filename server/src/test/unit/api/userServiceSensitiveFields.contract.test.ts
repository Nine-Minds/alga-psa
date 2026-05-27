import fs from 'node:fs';
import path from 'node:path';

import { sanitizeUserForResponse } from '../../../../../packages/users/src/services/userResponseSanitizer';
import { redactSensitiveFields } from '@/lib/api/utils/redactSensitiveFields';
import { afterEach, describe, expect, it, vi } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function expectNoSensitiveUserFields(value: unknown): void {
  const serialized = JSON.stringify(value);

  for (const key of [
    'hashed_password',
    'password',
    'two_factor_secret',
    'mfa_secret',
    'totp_secret',
    'recovery_codes',
    'backup_codes',
    'password_reset_token',
    'reset_token',
    'verification_token',
    'api_key',
    'api_key_hash'
  ]) {
    expect(serialized).not.toContain(key);
  }
}

describe('UserService API response sensitive field contract', () => {
  afterEach(() => {
    vi.doUnmock('server/src/lib/api/middleware/apiAuthMiddleware');
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('sanitizes raw user rows before response enhancement adds related data', () => {
    const result = sanitizeUserForResponse({
      user_id: 'user-1',
      username: 'test-user',
      email: 'test@example.com',
      hashed_password: 'hash',
      password: 'legacy-password',
      two_factor_secret: 'totp-secret',
      recovery_codes: ['one-time-code'],
      password_reset_token: 'reset-token',
      two_factor_enabled: true,
      tenant: 'tenant-1',
      unexpected_new_secret: 'should-not-pass-through'
    });

    expect(result).toEqual({
      user_id: 'user-1',
      username: 'test-user',
      email: 'test@example.com',
      two_factor_enabled: true,
      tenant: 'tenant-1'
    });
    expect(result).not.toHaveProperty('hashed_password');
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('two_factor_secret');
    expect(result).not.toHaveProperty('recovery_codes');
    expect(result).not.toHaveProperty('password_reset_token');
    expect(result).not.toHaveProperty('unexpected_new_secret');
  });

  it('redacts sensitive keys recursively before API error logging or response details', () => {
    const result = redactSensitiveFields({
      details: {
        password: 'plaintext',
        nested: [{ two_factor_secret: 'totp-secret' }],
        safe: 'visible'
      }
    });

    expect(result).toEqual({
      details: {
        password: '[REDACTED]',
        nested: [{ two_factor_secret: '[REDACTED]' }],
        safe: 'visible'
      }
    });
    expect(JSON.stringify(result)).not.toContain('plaintext');
    expect(JSON.stringify(result)).not.toContain('totp-secret');
  });

  it('projects only allowlisted columns for enhanced user responses', () => {
    const source = readRepoFile('packages/users/src/services/UserService.ts');
    const sanitizerSource = readRepoFile('packages/users/src/services/userResponseSanitizer.ts');

    expect(sanitizerSource).toContain('export const USER_RESPONSE_FIELD_NAMES = [');
    expect(sanitizerSource).toContain('export const USER_RESPONSE_COLUMNS = USER_RESPONSE_FIELD_NAMES.map');
    expect(source).not.toContain(".select('users.*')");
    expect(source).not.toContain(".returning('*')");
    expect(sanitizerSource).toContain("'hashed_password'");
    expect(sanitizerSource).toContain("'password'");
    expect(sanitizerSource).toContain("'two_factor_secret'");
    expect(sanitizerSource).toContain("'password_reset_token'");
    expect(sanitizerSource).toContain("'api_key_hash'");
    expect(sanitizerSource).toContain('for (const field of USER_RESPONSE_FIELD_NAMES)');
    expect(source).toContain('{ ...sanitizeUserForResponse(user), roles: [] }');
  });

  it('server user actions return safe user DTOs and update passwords by tenant-scoped user identity', () => {
    const source = readRepoFile('packages/users/src/actions/user-actions/userActions.ts');

    expect(source).toContain('type SafeApiUser');
    expect(source).toContain('.returning(USER_RESPONSE_FIELD_NAMES)');
    expect(source).not.toContain(".returning('*')");
    expect(source).not.toContain('User.getUserWithRoles(trx, userId)');
    expect(source).toContain('User.updatePassword(currentUser.user_id, currentUser.tenant, hashedPassword)');
    expect(source).toContain('User.updatePassword(targetUser.user_id, targetUser.tenant, hashedPassword)');
  });

  it('does not load sensitive fields into API auth user context', () => {
    const source = readRepoFile('packages/users/src/actions/user-actions/findUserByIdForApi.ts');
    const oldMiddlewareSource = readRepoFile('server/src/lib/api/middleware/apiMiddleware.ts');

    expect(source).toContain('export const API_USER_CONTEXT_COLUMNS = USER_RESPONSE_FIELD_NAMES');
    expect(source).toContain('.select(API_USER_CONTEXT_COLUMNS)');
    expect(source).not.toContain('.select(\'*\')');
    expect(source).not.toContain('hashed_password');
    expect(source).not.toContain('two_factor_secret');
    expect(oldMiddlewareSource).toContain('export async function buildAuthenticatedApiContext');
    expect(oldMiddlewareSource).toContain("import { findUserByIdForApi } from '@alga-psa/users/actions'");
    expect(oldMiddlewareSource).not.toContain("from '@alga-psa/user-composition/actions'");
    expect(oldMiddlewareSource).not.toContain('user?: any');
  });

  it('test-auth route source returns only non-sensitive context identifiers', () => {
    const source = readRepoFile('server/src/app/api/v1/test-auth/route.ts');

    expect(source).toContain('isTestAuthEndpointEnabled');
    expect(source).toContain('userId: req.context?.userId');
    expect(source).toContain('tenant: req.context?.tenant');
    expect(source).toContain('apiKeyId: req.context?.apiKeyId');
    expect(source).not.toContain('context: req.context');
    expect(source).not.toContain('console.log');
  });

  it('test-auth route runtime response excludes sensitive context fields recursively', async () => {
    vi.doMock('server/src/lib/api/middleware/apiAuthMiddleware', () => ({
      withApiKeyAuth: vi.fn(async (handler: any) => async (request: Request) => {
        const authedRequest = Object.assign(request, {
          context: {
            userId: 'user-1',
            tenant: 'tenant-1',
            apiKeyId: 'api-key-1',
            user: {
              user_id: 'user-1',
              email: 'user@example.com',
              hashed_password: 'hash',
              password: 'plaintext',
              two_factor_secret: 'totp-secret'
            }
          }
        });

        return handler(authedRequest);
      })
    }));

    const { GET } = await import('@/app/api/v1/test-auth/route');
    const response = await GET(new Request('https://example.test/api/v1/test-auth') as any);
    const body = await response.json();

    expect(body).toEqual({
      message: 'Authentication successful',
      context: {
        userId: 'user-1',
        tenant: 'tenant-1',
        apiKeyId: 'api-key-1'
      }
    });
    expectNoSensitiveUserFields(body);
  });

  it('test-auth route is disabled in production unless explicitly enabled', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ENABLE_API_TEST_AUTH', '');

    const { GET } = await import('@/app/api/v1/test-auth/route');
    const response = await GET(new Request('https://example.test/api/v1/test-auth') as any);

    expect(response.status).toBe(404);
  });
});
