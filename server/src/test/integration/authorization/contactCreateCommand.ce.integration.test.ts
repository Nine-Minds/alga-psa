/**
 * T010 (alga-2026-0003442, S1, F001): edition boundary of the contact create command. In a community build with
 * no built-in rule resolver registered, a plain tenant creates a contact through `createContactAs` with exactly
 * one tenant authorization probe, and nothing under `ee/` is loaded to do it. Real DB and real kernel; only RBAC
 * is stood in for. Probes are counted on the wire (the probe is the one statement selecting `publishedAssignments`).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../../test-utils/testDataFactory';

vi.mock('@alga-psa/authorization/rbac', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/authorization/rbac')>()),
  hasPermission: vi.fn(async () => true),
}));
vi.mock('@alga-psa/event-bus/publishers', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

import { createContactAs } from '@alga-psa/shared/models/contactCreateCommand';
import { hasRegisteredBuiltinRuleResolvers } from '@alga-psa/authorization/kernel/builtinRuleResolvers';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

describe('T010: contact create command in a community build', () => {
  let db: Knex;
  let tenant: string;
  let actorId = '';
  const mark = uuidv4().slice(0, 8);

  beforeAll(async () => {
    db = await createTestDbConnection();
    tenant = await createTenant(db, `Contact create CE ${mark}`);
    actorId = await createUser(db, tenant, { user_type: 'internal', first_name: 'Cee', last_name: 'Edition' });
  }, 900_000);

  afterAll(async () => {
    if (!db) return;
    await db('contacts').where({ tenant }).del().catch(() => undefined);
    await db.destroy();
  }, 120_000);

  it('creates for a plain tenant with a single tenant probe and no resolver registered', async () => {
    // The CE state under test: nothing registered a built-in resolver.
    expect(hasRegisteredBuiltinRuleResolvers()).toBe(false);

    const statements: string[] = [];
    const email = `ce-${mark}@example.com`;
    const created = await db.transaction(async (trx) => {
      trx.on('query', (q: { sql: string }) => statements.push(q.sql));
      return createContactAs(trx, {
        tenant,
        actor: { user_id: actorId, user_type: 'internal', tenant } as any,
        input: { full_name: `Ce ${mark}`, email },
      });
    });

    expect(created.email).toBe(email);
    expect(Number((await db('contacts').where({ tenant, email }).count('* as n').first() as any).n)).toBe(1);
    const probes = statements.filter((sql) => sql.includes('"publishedAssignments"'));
    expect(probes).toHaveLength(1);
  });

  it('imports nothing from ee/, directly or through any workspace module it reaches', () => {
    const root = path.resolve(__dirname, '../../../../..');
    const resolveSpecifier = (from: string, spec: string): string | null => {
      const candidates: string[] = [];
      if (spec.startsWith('.')) candidates.push(path.resolve(path.dirname(from), spec));
      const pkg = spec.match(/^@alga-psa\/([^/]+)\/?(.*)$/);
      if (pkg) {
        const [, name, rest] = pkg;
        const base = name === 'shared' ? path.join(root, 'shared') : path.join(root, 'packages', name, 'src');
        candidates.push(path.join(base, rest || 'index'));
      }
      for (const c of candidates) {
        for (const ext of ['.ts', '.tsx', '/index.ts', '']) {
          if (existsSync(c + ext) && /\.(ts|tsx)$/.test(c + ext)) return c + ext;
        }
      }
      return null;
    };

    const seen = new Set<string>();
    const offenders: string[] = [];
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(file, 'utf8');
      for (const m of source.matchAll(/(?:from\s+|import\s*\(\s*|require\(\s*)['"]([^'"]+)['"]/g)) {
        const spec = m[1];
        if (/(^|\/)ee\//.test(spec) || spec.startsWith('@ee') || spec.startsWith('@enterprise')) offenders.push(`${path.relative(root, file)} -> ${spec}`);
        const next = resolveSpecifier(file, spec);
        if (next) walk(next);
      }
    };
    walk(path.join(root, 'shared/models/contactCreateCommand.ts'));

    expect(seen.size).toBeGreaterThan(3); // the walk actually followed imports
    expect(offenders).toEqual([]);
  });
});
