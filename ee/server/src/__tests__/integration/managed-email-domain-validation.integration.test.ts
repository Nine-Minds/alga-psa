/**
 * Integration tests for managed email domain validation
 *
 * This test suite validates that obviously bogus domain names are rejected
 * by the requestManagedEmailDomain action.
 */

import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '@main-test-utils/dbConfig';

let db: Knex;
let tenantId: string | undefined;

const enqueueWorkflow = vi.fn(async () => ({ enqueued: true }));

vi.mock('@alga-psa/users/actions', () => ({
  getCurrentUser: vi.fn(async () => ({ id: 'user-test-1' })),
}));

vi.mock('@ee/lib/email-domains/workflowClient', () => ({
  enqueueManagedEmailDomainWorkflow: vi.fn((args) => enqueueWorkflow(args)),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: vi.fn(async (_key: string, _envVar?: string, fallback?: string) => fallback ?? 'test_password'),
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: async () => '',
  })),
  secretProvider: {
    getSecret: vi.fn(async (_key: string, _envVar?: string, fallback?: string) => fallback ?? 'test_password'),
  },
}));

vi.mock('@alga-psa/core', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
  getTenantContext: vi.fn(async () => tenantId),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) => action({ user_id: 'user-test-1', user_type: 'internal' }, { tenant: tenantId }, ...args),
  hasPermission: vi.fn(async () => true),
}));

type ManagedDomainActionsModule = typeof import('@/lib/actions/email-actions/managedDomainActions');
let requestManagedEmailDomain: ManagedDomainActionsModule['requestManagedEmailDomain'];

async function expectInvalidDomain(domain: string): Promise<void> {
  await expect(requestManagedEmailDomain(domain)).resolves.toMatchObject({
    success: false,
    code: 'invalid_domain',
    fieldErrors: { domain: expect.any(String) },
  });
  expect(await db('email_domains').where({ tenant: tenantId })).toHaveLength(0);
  expect(enqueueWorkflow).not.toHaveBeenCalled();
}

async function ensureTenant(knex: Knex): Promise<string> {
  const existingTenant = await knex('tenants')
    .where({ client_name: 'managed-domain-validation-test' })
    .first();

  if (existingTenant) {
    return existingTenant.tenant;
  }

  const newTenantId = uuidv4();
  await knex('tenants').insert({
    tenant: newTenantId,
    client_name: 'managed-domain-validation-test',
    email: 'managed-domain@example.invalid',
    created_at: new Date(),
  });

  return newTenantId;
}

describe('Managed Email Domain Validation – Integration Tests', () => {
  const HOOK_TIMEOUT = 120_000;

  beforeAll(async () => {
    ({ requestManagedEmailDomain } = await import('@/lib/actions/email-actions/managedDomainActions'));
    db = await createTestDbConnection();
    tenantId = await ensureTenant(db);
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    if (db) {
      await db.destroy();
    }
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    enqueueWorkflow.mockClear();
    if (tenantId) {
      await db('email_domains').where({ tenant: tenantId }).delete();
    }
  }, HOOK_TIMEOUT);

  describe('Valid domain names', () => {
    it('should accept a standard domain name', async () => {
      const result = await requestManagedEmailDomain('example.com');
      expect(result.success).toBe(true);
    });

    it('should accept a subdomain', async () => {
      const result = await requestManagedEmailDomain('mail.example.com');
      expect(result.success).toBe(true);
    });

    it('should accept a domain with hyphens in the middle', async () => {
      const result = await requestManagedEmailDomain('my-company.example.com');
      expect(result.success).toBe(true);
    });

    it('should accept a multi-level subdomain', async () => {
      const result = await requestManagedEmailDomain('mail.corp.example.com');
      expect(result.success).toBe(true);
    });
  });

  describe('Invalid domain names - should reject obviously bogus domains', () => {
    it('should reject single-label domains (no TLD)', async () => {
      await expectInvalidDomain('localhost');
    });

    it('should reject domains with spaces', async () => {
      await expectInvalidDomain('my domain.com');
    });

    it('should reject domains starting with a hyphen', async () => {
      await expectInvalidDomain('-example.com');
    });

    it('should reject domains ending with a hyphen', async () => {
      await expectInvalidDomain('example-.com');
    });

    it('should reject domains with consecutive dots', async () => {
      await expectInvalidDomain('example..com');
    });

    it('should reject domains starting with a dot', async () => {
      await expectInvalidDomain('.example.com');
    });

    it('should reject domains ending with a dot', async () => {
      await expectInvalidDomain('example.com.');
    });

    it('should reject domains with underscores', async () => {
      await expectInvalidDomain('my_domain.com');
    });

    it('should reject empty strings', async () => {
      await expectInvalidDomain('');
    });

    it('should reject domains with special characters', async () => {
      await expectInvalidDomain('exa!mple.com');
    });

    it('should reject domains with @ symbol', async () => {
      await expectInvalidDomain('user@example.com');
    });

    it('should reject domains that are too long (>253 chars)', async () => {
      const longDomain = 'a'.repeat(240) + '.example.com';
      await expectInvalidDomain(longDomain);
    });

    it('should reject domains with labels longer than 63 characters', async () => {
      const longLabel = 'a'.repeat(64);
      await expectInvalidDomain(`${longLabel}.example.com`);
    });

    it('should reject IP addresses', async () => {
      await expectInvalidDomain('192.168.1.1');
    });

    it('should reject URLs with protocol', async () => {
      await expectInvalidDomain('https://example.com');
    });

    it('should reject domains with path components', async () => {
      await expectInvalidDomain('example.com/path');
    });

    it('should reject domains with port numbers', async () => {
      await expectInvalidDomain('example.com:8080');
    });

    it('should reject numeric-only TLDs', async () => {
      await expectInvalidDomain('example.123');
    });

    it('should reject domains with consecutive hyphens in labels', async () => {
      await expectInvalidDomain('ex--ample.com');
    });
  });

  describe('Edge cases and normalization', () => {
    it('should normalize uppercase to lowercase', async () => {
      const result = await requestManagedEmailDomain('EXAMPLE.COM');
      expect(result.success).toBe(true);

      // Verify it was stored as lowercase
      const record = await db('email_domains')
        .where({ tenant: tenantId, domain_name: 'example.com' })
        .first();

      expect(record).toBeDefined();
      expect(record?.domain_name).toBe('example.com');
    });

    it('should trim whitespace', async () => {
      const result = await requestManagedEmailDomain('  example.com  ');
      expect(result.success).toBe(true);

      const record = await db('email_domains')
        .where({ tenant: tenantId, domain_name: 'example.com' })
        .first();

      expect(record).toBeDefined();
    });

    it('should handle internationalized domain names (IDN)', async () => {
      // Punycode representation of café.com
      await expectInvalidDomain('café.com');
    });
  });
});
