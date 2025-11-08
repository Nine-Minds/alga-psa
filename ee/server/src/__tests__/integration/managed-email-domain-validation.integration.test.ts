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

vi.mock('@/lib/actions/user-actions/userActions', () => ({
  getCurrentUser: vi.fn(async () => ({ id: 'user-test-1' })),
}));

vi.mock('@/lib/email-domains/workflowClient', () => ({
  enqueueManagedEmailDomainWorkflow: vi.fn((args) => enqueueWorkflow(args)),
}));

vi.mock('@alga-psa/shared/core/secretProvider', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: async () => '',
  })),
  secretProvider: {
    getSecret: vi.fn(async (_key: string, _envVar?: string, fallback?: string) => fallback ?? 'test_password'),
  },
}));

vi.mock('@alga-psa/shared/core', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@alga-psa/shared/core/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: db, tenant: tenantId })),
}));

type ManagedDomainActionsModule = typeof import('@/lib/actions/email-actions/managedDomainActions');
let requestManagedEmailDomain: ManagedDomainActionsModule['requestManagedEmailDomain'];

async function runMigrationsAndSeeds(knex: Knex): Promise<void> {
  await knex.migrate.latest({
    directory: './server/migrations',
  });
}

async function ensureTenant(knex: Knex): Promise<string> {
  const existingTenant = await knex('tenants')
    .where({ company_name: 'managed-domain-validation-test' })
    .first();

  if (existingTenant) {
    return existingTenant.tenant;
  }

  const newTenantId = uuidv4();
  await knex('tenants').insert({
    tenant: newTenantId,
    company_name: 'managed-domain-validation-test',
    created_at: new Date(),
  });

  return newTenantId;
}

describe('Managed Email Domain Validation – Integration Tests', () => {
  const HOOK_TIMEOUT = 120_000;

  beforeAll(async () => {
    ({ requestManagedEmailDomain } = await import('@/lib/actions/email-actions/managedDomainActions'));
    db = await createTestDbConnection();
    await runMigrationsAndSeeds(db);
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
      await db('email_domains').where({ tenant_id: tenantId }).delete();
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
      await expect(async () => {
        await requestManagedEmailDomain('localhost');
      }).rejects.toThrow(/invalid domain/i);
    });

    it('should reject domains with spaces', async () => {
      await expect(async () => {
        await requestManagedEmailDomain('my domain.com');
      }).rejects.toThrow(/invalid domain/i);
    });

    it('should reject domains starting with a hyphen', async () => {
      await expect(async () => {
        await requestManagedEmailDomain('-example.com');
      }).rejects.toThrow(/invalid domain/i);
    });

    it('should reject domains ending with a hyphen', async () => {
      await expect(async () => {
        await requestManagedEmailDomain('example-.com');
      }).rejects.toThrow(/invalid domain/i);
    });

    it('should reject domains with consecutive dots', async () => {
      await expect(async () => {
        await requestManagedEmailDomain('example..com');
      }).rejects.toThrow(/invalid domain/i);
    });

    it('should reject domains starting with a dot', async () => {
      await expect(async () => {
        await requestManagedEmailDomain('.example.com');
      }).rejects.toThrow(/invalid domain/i);
    });

    it('should reject domains ending with a dot', async () => {
      await expect(async () => {
        await requestManagedEmailDomain('example.com.');
      }).rejects.toThrow(/invalid domain/i);
    });

    it('should reject domains with underscores', async () => {
      await expect(async () => {
        await requestManagedEmailDomain('my_domain.com');
      }).rejects.toThrow(/invalid domain/i);
    });

    it('should reject empty strings', async () => {
      await expect(async () => {
        await requestManagedEmailDomain('');
      }).rejects.toThrow(/invalid domain/i);
    });

    it('should reject domains with special characters', async () => {
      await expect(async () => {
        await requestManagedEmailDomain('exa!mple.com');
      }).rejects.toThrow(/invalid domain/i);
    });

    it('should reject domains with @ symbol', async () => {
      await expect(async () => {
        await requestManagedEmailDomain('user@example.com');
      }).rejects.toThrow(/invalid domain/i);
    });

    it('should reject domains that are too long (>253 chars)', async () => {
      const longDomain = 'a'.repeat(240) + '.example.com';
      await expect(async () => {
        await requestManagedEmailDomain(longDomain);
      }).rejects.toThrow(/invalid domain/i);
    });

    it('should reject domains with labels longer than 63 characters', async () => {
      const longLabel = 'a'.repeat(64);
      await expect(async () => {
        await requestManagedEmailDomain(`${longLabel}.example.com`);
      }).rejects.toThrow(/invalid domain/i);
    });

    it('should reject IP addresses', async () => {
      await expect(async () => {
        await requestManagedEmailDomain('192.168.1.1');
      }).rejects.toThrow(/invalid domain/i);
    });

    it('should reject URLs with protocol', async () => {
      await expect(async () => {
        await requestManagedEmailDomain('https://example.com');
      }).rejects.toThrow(/invalid domain/i);
    });

    it('should reject domains with path components', async () => {
      await expect(async () => {
        await requestManagedEmailDomain('example.com/path');
      }).rejects.toThrow(/invalid domain/i);
    });

    it('should reject domains with port numbers', async () => {
      await expect(async () => {
        await requestManagedEmailDomain('example.com:8080');
      }).rejects.toThrow(/invalid domain/i);
    });

    it('should reject numeric-only TLDs', async () => {
      await expect(async () => {
        await requestManagedEmailDomain('example.123');
      }).rejects.toThrow(/invalid domain/i);
    });

    it('should reject domains with consecutive hyphens in labels', async () => {
      await expect(async () => {
        await requestManagedEmailDomain('ex--ample.com');
      }).rejects.toThrow(/invalid domain/i);
    });
  });

  describe('Edge cases and normalization', () => {
    it('should normalize uppercase to lowercase', async () => {
      const result = await requestManagedEmailDomain('EXAMPLE.COM');
      expect(result.success).toBe(true);

      // Verify it was stored as lowercase
      const record = await db('email_domains')
        .where({ tenant_id: tenantId, domain_name: 'example.com' })
        .first();

      expect(record).toBeDefined();
      expect(record?.domain_name).toBe('example.com');
    });

    it('should trim whitespace', async () => {
      const result = await requestManagedEmailDomain('  example.com  ');
      expect(result.success).toBe(true);

      const record = await db('email_domains')
        .where({ tenant_id: tenantId, domain_name: 'example.com' })
        .first();

      expect(record).toBeDefined();
    });

    it('should handle internationalized domain names (IDN)', async () => {
      // Punycode representation of café.com
      await expect(async () => {
        await requestManagedEmailDomain('café.com');
      }).rejects.toThrow(/invalid domain/i);
    });
  });
});
