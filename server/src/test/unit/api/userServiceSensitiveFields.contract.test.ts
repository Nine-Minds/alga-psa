import fs from 'node:fs';
import path from 'node:path';

import { sanitizeUserForResponse } from '../../../../../packages/users/src/services/userResponseSanitizer';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('UserService API response sensitive field contract', () => {
  it('sanitizes raw user rows before response enhancement adds related data', () => {
    const result = sanitizeUserForResponse({
      user_id: 'user-1',
      username: 'test-user',
      email: 'test@example.com',
      hashed_password: 'hash',
      password: 'legacy-password',
      two_factor_secret: 'totp-secret',
      two_factor_enabled: true,
      tenant: 'tenant-1'
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
  });

  it('strips credential and MFA secrets from enhanced user responses', () => {
    const source = readRepoFile('packages/users/src/services/UserService.ts');
    const sanitizerSource = readRepoFile('packages/users/src/services/userResponseSanitizer.ts');

    expect(sanitizerSource).toContain('export const USER_RESPONSE_COLUMNS = [');
    expect(source).not.toContain(".select('users.*')");
    expect(sanitizerSource).toContain('export const SENSITIVE_USER_FIELDS = [');
    expect(sanitizerSource).toContain("'hashed_password'");
    expect(sanitizerSource).toContain("'password'");
    expect(sanitizerSource).toContain("'two_factor_secret'");
    expect(sanitizerSource).toContain('delete sanitized[field]');
    expect(source).toContain('{ ...sanitizeUserForResponse(user), roles: [] }');
  });

  it('does not load sensitive fields into API auth user context', () => {
    const source = readRepoFile('packages/users/src/actions/user-actions/findUserByIdForApi.ts');

    expect(source).toContain('const API_USER_CONTEXT_COLUMNS = [');
    expect(source).toContain('.select(API_USER_CONTEXT_COLUMNS)');
    expect(source).not.toContain('.select(\'*\')');
    expect(source).not.toContain('hashed_password');
    expect(source).not.toContain('two_factor_secret');
  });

  it('test-auth route returns only non-sensitive context identifiers', () => {
    const source = readRepoFile('server/src/app/api/v1/test-auth/route.ts');

    expect(source).toContain('userId: req.context?.userId');
    expect(source).toContain('tenant: req.context?.tenant');
    expect(source).toContain('apiKeyId: req.context?.apiKeyId');
    expect(source).not.toContain('context: req.context');
    expect(source).not.toContain('console.log');
  });
});
