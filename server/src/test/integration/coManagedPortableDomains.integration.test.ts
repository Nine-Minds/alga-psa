/** Runner for the CM L7b3 portable-domain case files, against one throwaway co-managed world. */
import { afterAll, beforeAll, describe, vi } from 'vitest';
import type { Knex } from 'knex';
import { configureL3cDbEnv, connectL3cDb, cleanupL3cTenants, registerCoManagedCapability, seedPortableWorld, type PortableWorld }
  from './helpers/coManagedPortableExportFixture';
import { defineDocumentCases } from './coManagedPortableDocuments.cases';
import { defineManifestCases } from './coManagedPortableManifest.cases';
import { defineOperationalCases } from './coManagedPortableOperational.cases';
import { defineRemoteMeetingCases } from './coManagedPortableRemoteMeeting.cases';
import { defineEngagementCases } from './coManagedPortableEngagement.cases';
import { defineSupplementalFileCases } from './coManagedPortableSupplementalFiles.cases';
import { defineProvisioningCases } from './coManagedPortableProvisioning.cases';

// Object storage is the one stand-in: staging reads bytes through the provider, which is replaced by an in-memory map.
vi.mock('@alga-psa/storage/StorageProviderFactory', async () => {
  const { fakeStorageProvider } = await import('./helpers/coManagedPortableExportFixture');
  return { StorageProviderFactory: { createProvider: async () => fakeStorageProvider } };
});

let db: Knex, world: PortableWorld;
const state = () => ({ db, world });

describe('CM L7b3 portable export domains', () => {
  beforeAll(async () => {
    configureL3cDbEnv();
    registerCoManagedCapability();
    db = await connectL3cDb();
    world = await seedPortableWorld(db);
  }, 120_000);
  afterAll(async () => {
    if (world) await cleanupL3cTenants(world.tenants);
    await db?.destroy();
  }, 120_000);
  defineOperationalCases(state);
  defineRemoteMeetingCases(state);
  defineEngagementCases(state);
  defineSupplementalFileCases(state);
  defineDocumentCases(state);
  defineManifestCases(state);
  defineProvisioningCases(state);
});
