import { describe, expect, it, vi } from 'vitest';

const { deleteTenantSecret } = vi.hoisted(() => ({ deleteTenantSecret: vi.fn() }));

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({ deleteTenantSecret })),
}));

import knexFactory, { type Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import { createPersistentFleetStore } from '../../../lib/integrations/unifi/credentials/credentialStore';
import { removeCredential } from '../../../lib/integrations/unifi/credentials/credentialService';

const TENANT = '00000000-0000-0000-0000-0000000000aa';
const INTEGRATION_ID = '00000000-0000-0000-0000-0000000000bb';
const CREDENTIAL_ID = '00000000-0000-0000-0000-0000000000cc';

/**
 * A real pg-dialect knex whose driver is replaced by a recorder, so the test
 * sees the exact SQL and bindings the store sends to Postgres/Citus.
 */
function recordingKnex(responseRows: Record<string, unknown[]> = {}): { knex: Knex; queries: Array<{ sql: string; bindings: unknown[] }> } {
  const knex = knexFactory({ client: 'pg' });
  const queries: Array<{ sql: string; bindings: unknown[] }> = [];
  const client = knex.client as any;
  client.acquireConnection = async () => ({});
  client.releaseConnection = async () => undefined;
  client._query = async (_connection: unknown, obj: any) => {
    queries.push({ sql: obj.sql, bindings: obj.bindings ?? [] });
    const table = /^select\b.*?\bfrom "([^"]+)"/i.exec(obj.sql)?.[1];
    const rows = table && table in responseRows
      ? responseRows[table]
      : table === 'rmm_integrations' ? [{ integration_id: INTEGRATION_ID }] : [];
    obj.response = { rows, rowCount: rows.length, command: obj.method === 'insert' ? 'INSERT' : 'SELECT' };
    return obj;
  };
  return { knex, queries };
}

describe('UniFi persistent fleet store: console route upsert', () => {
  it('binds timestamps instead of calling now() in DO UPDATE SET (Citus requires IMMUTABLE there)', async () => {
    const { knex, queries } = recordingKnex();
    const store = createPersistentFleetStore(TENANT, { knex });
    const before = Date.now();

    await store.saveRoute({
      hostId: 'host-1',
      credentialId: CREDENTIAL_ID,
      consoleName: 'HQ console',
      state: 'routed',
      lastError: null,
    });

    const upsert = queries.find((q) => /insert into "unifi_console_routes"/.test(q.sql));
    expect(upsert, 'saveRoute should upsert the console route').toBeDefined();
    const [, doUpdate] = upsert!.sql.split(/on conflict/i);
    expect(doUpdate).toMatch(/do update set/i);
    expect(doUpdate).not.toMatch(/\bnow\(\)|current_timestamp/i);
    expect(doUpdate).toMatch(/"last_verified_at" = \$\d+/);

    const stamps = upsert!.bindings.filter((b): b is string => typeof b === 'string' && !Number.isNaN(Date.parse(b)) && /T\d\d:/.test(b));
    expect(stamps.length).toBeGreaterThan(0);
    for (const stamp of stamps) expect(Date.parse(stamp)).toBeGreaterThanOrEqual(before - 1);

    await knex.destroy();
  });
});

function credentialRemovalKnex(hostId: string, scope: string) {
  return recordingKnex({
    unifi_credentials: [{
      credential_id: CREDENTIAL_ID, integration_id: INTEGRATION_ID, label: 'Fabric',
      mode: 'site_manager', status: 'active', created_at: new Date(),
    }],
    unifi_console_routes: [{
      host_id: hostId, credential_id: CREDENTIAL_ID, console_name: 'Branch', state: 'routed',
      first_seen_at: new Date(), last_verified_at: new Date(),
    }],
    rmm_organization_mappings: [{
      external_organization_id: scope, external_organization_name: 'Branch / Default',
    }],
  });
}

describe('UniFi credential removal confirmation', () => {
  it.each([
    { description: 'a composite host', hostId: 'console-1:123456', scope: 'console-1:123456:site-1', malformed: false },
    { description: 'a legacy host', hostId: 'console-1', scope: 'console-1:site-1', malformed: false },
    { description: 'a legacy host with a missing site', hostId: 'console-1', scope: 'console-1:', malformed: true },
    { description: 'a previously matched malformed scope', hostId: 'console-1', scope: 'console-1:legacy:', malformed: true },
    { description: 'a composite host with a missing site', hostId: 'console-1:123456', scope: 'console-1:123456:', malformed: true },
  ])('requires confirmation for mapped sites on $description before deleting anything', async ({ hostId, scope, malformed }) => {
    vi.mocked(logger.warn).mockClear();
    deleteTenantSecret.mockClear();
    const { knex, queries } = credentialRemovalKnex(hostId, scope);
    try {
      await expect(removeCredential(knex, TENANT, {
        integrationId: INTEGRATION_ID, credentialId: CREDENTIAL_ID,
      })).resolves.toEqual({
        removed: false, requiresConfirmation: true, affectedSites: ['Branch / Default'],
      });
      expect(queries.every((query) => query.sql.startsWith('select'))).toBe(true);
      expect(deleteTenantSecret).not.toHaveBeenCalled();
      if (malformed) {
        expect(logger.warn).toHaveBeenCalledWith(
          '[UniFi] Malformed mapped-site scope during credential removal',
          { credentialId: CREDENTIAL_ID }
        );
      } else {
        expect(logger.warn).not.toHaveBeenCalled();
      }
    } finally {
      await knex.destroy();
    }
  });

  it('does not confuse a composite host with its shorter prefix', async () => {
    deleteTenantSecret.mockClear();
    const { knex } = credentialRemovalKnex('console-1', 'console-1:123456:site-1');
    try {
      await expect(removeCredential(knex, TENANT, {
        integrationId: INTEGRATION_ID, credentialId: CREDENTIAL_ID,
      })).resolves.toEqual({ removed: true, affectedSites: [] });
      expect(deleteTenantSecret).toHaveBeenCalledTimes(2);
    } finally {
      await knex.destroy();
    }
  });

  it('removes a credential after confirmation for a malformed legacy mapping', async () => {
    deleteTenantSecret.mockClear();
    const { knex, queries } = credentialRemovalKnex('console-1', 'console-1:');
    try {
      await expect(removeCredential(knex, TENANT, {
        integrationId: INTEGRATION_ID, credentialId: CREDENTIAL_ID, confirm: true,
      })).resolves.toEqual({ removed: true, affectedSites: ['Branch / Default'] });
      expect(queries.filter((query) => query.sql.startsWith('delete'))).toHaveLength(2);
      expect(deleteTenantSecret).toHaveBeenCalledTimes(2);
    } finally {
      await knex.destroy();
    }
  });
});
