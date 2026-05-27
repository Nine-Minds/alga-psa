import fs from 'node:fs';
import path from 'node:path';

import { sanitizeUserForResponse } from '../../../../../packages/users/src/services/userResponseSanitizer';
import { afterEach, describe, expect, it, vi } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function expectNoSensitiveUserFields(value: unknown): void {
  const serialized = JSON.stringify(value);

  expect(serialized).not.toContain('hashed_password');
  expect(serialized).not.toContain('password');
  expect(serialized).not.toContain('two_factor_secret');
}

describe('UserService API response sensitive field contract', () => {
  afterEach(() => {
    vi.doUnmock('server/src/lib/api/middleware/apiAuthMiddleware');
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
    expect(result).not.toHaveProperty('unexpected_new_secret');
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
    expect(sanitizerSource).toContain('for (const field of USER_RESPONSE_FIELD_NAMES)');
    expect(source).toContain('{ ...sanitizeUserForResponse(user), roles: [] }');
  });

  it('does not load sensitive fields into API auth user context', () => {
    const source = readRepoFile('packages/users/src/actions/user-actions/findUserByIdForApi.ts');
    const oldMiddlewareSource = readRepoFile('server/src/lib/api/middleware/apiMiddleware.ts');

    expect(source).toContain('export const API_USER_CONTEXT_COLUMNS = USER_RESPONSE_FIELD_NAMES');
    expect(source).toContain('.select(API_USER_CONTEXT_COLUMNS)');
    expect(source).not.toContain('.select(\'*\')');
    expect(source).not.toContain('hashed_password');
    expect(source).not.toContain('two_factor_secret');
    expect(oldMiddlewareSource).toContain("import { findUserByIdForApi } from '@alga-psa/users/actions'");
    expect(oldMiddlewareSource).not.toContain("from '@alga-psa/user-composition/actions'");
    expect(oldMiddlewareSource).not.toContain('user?: any');
  });

  it('test-auth route source returns only non-sensitive context identifiers', () => {
    const source = readRepoFile('server/src/app/api/v1/test-auth/route.ts');

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
});
