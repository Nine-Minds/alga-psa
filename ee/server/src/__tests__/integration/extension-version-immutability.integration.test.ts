import { describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import {
  createExtensionVersion,
  createExtensionIfMissing,
  DUPLICATE_EXTENSION_VERSION_CODE,
  isDuplicateExtensionVersionError,
  setRegistryV2Repository,
  upsertVersionFromManifest,
} from '@ee/lib/extensions/registry-v2';

type ExtensionRow = {
  id: string;
  name: string;
  publisher?: string;
  createdAt: Date;
};

type VersionRow = {
  id: string;
  extensionId: string;
  version: string;
  contentHash: string;
  runtime: string;
  uiEntry?: string;
  endpoints: Array<{ method: string; path: string; handler: string }>;
  capabilities: string[];
  createdAt: Date;
};

type BundleRow = {
  versionId: string;
  contentHash: string;
  createdAt: Date;
};

function manifest(version: string) {
  return {
    name: 'immutability-test-ext',
    publisher: 'vitest',
    version,
    runtime: 'node@1',
    api: { endpoints: [] },
  };
}

function upsertForTest(version: string, contentHash: string) {
  return upsertVersionFromManifest({
    manifest: manifest(version),
    contentHash,
    parsed: {
      endpoints: [],
      runtime: 'node@1',
      capabilities: [],
    },
    signature: {
      required: false,
      verified: false,
    },
  });
}

function createInMemoryRepo() {
  const extensions: ExtensionRow[] = [];
  const versions: VersionRow[] = [];
  const bundles: BundleRow[] = [];

  const repo = {
    extensions: {
      async findByNamePublisher(name: string, publisher?: string) {
        return extensions.find((row) => row.name === name && row.publisher === publisher) ?? null;
      },
      async create(input: { name: string; publisher?: string }) {
        const row: ExtensionRow = {
          id: uuidv4(),
          name: input.name,
          publisher: input.publisher,
          createdAt: new Date(),
        };
        extensions.push(row);
        return row;
      },
    },
    versions: {
      async create(input: Omit<VersionRow, 'id' | 'createdAt'>) {
        const existing = versions.find((row) => row.extensionId === input.extensionId && row.version === input.version);
        if (existing) {
          const err = Object.assign(new Error('duplicate key value violates unique constraint'), {
            code: '23505',
            detail: `Key (registry_id, version)=(${input.extensionId}, ${input.version}) already exists.`,
            constraint: 'extension_version_registry_id_version_unique',
          });
          throw err;
        }

        const row: VersionRow = {
          id: uuidv4(),
          extensionId: input.extensionId,
          version: input.version,
          contentHash: input.contentHash,
          runtime: input.runtime,
          uiEntry: input.uiEntry,
          endpoints: input.endpoints,
          capabilities: input.capabilities,
          createdAt: new Date(),
        };
        versions.push(row);
        bundles.push({ versionId: row.id, contentHash: `sha256:${input.contentHash}`, createdAt: new Date() });
        return row;
      },
      async findByHash(contentHash: string) {
        const foundBundle = bundles.find((bundle) => bundle.contentHash === `sha256:${contentHash}`);
        if (!foundBundle) return null;
        return versions.find((row) => row.id === foundBundle.versionId) ?? null;
      },
      async findLatestForExtension(extensionId: string) {
        const found = versions
          .filter((row) => row.extensionId === extensionId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
        return found ?? null;
      },
      async findByExtensionAndVersion(extensionId: string, version: string) {
        return versions.find((row) => row.extensionId === extensionId && row.version === version) ?? null;
      },
      async listVersionStringsForExtension(extensionId: string) {
        return versions.filter((row) => row.extensionId === extensionId).map((row) => row.version);
      },
    },
  };

  return { repo, versions, bundles };
}

describe('Extension version immutability', () => {
  it('T024: finalize/upsert succeeds for a brand-new version value', async () => {
    const { repo } = createInMemoryRepo();
    setRegistryV2Repository(repo as any);

    const result = await upsertForTest('1.0.0', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

    expect(result.extension.id).toBeTruthy();
    expect(result.version.id).toBeTruthy();
    expect(result.version.version).toBe('1.0.0');
  });

  it('T003: rejects duplicate version when incoming content hash is identical', async () => {
    const { repo } = createInMemoryRepo();
    setRegistryV2Repository(repo as any);

    await upsertForTest('1.0.0', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

    await expect(
      upsertForTest('1.0.0', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    ).rejects.toMatchObject({
      status: 409,
      code: DUPLICATE_EXTENSION_VERSION_CODE,
    });
  });

  it('T004: rejects duplicate version when incoming content hash differs', async () => {
    const { repo } = createInMemoryRepo();
    setRegistryV2Repository(repo as any);

    await upsertForTest('1.0.0', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

    await expect(
      upsertForTest('1.0.0', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
    ).rejects.toMatchObject({
      status: 409,
      code: DUPLICATE_EXTENSION_VERSION_CODE,
    });
  });

  it('T005: duplicate version attempts do not create additional extension_bundle rows', async () => {
    const { repo, bundles } = createInMemoryRepo();
    setRegistryV2Repository(repo as any);

    const created = await upsertForTest('1.0.0', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const before = bundles.filter((row) => row.versionId === created.version.id).length;
    expect(before).toBe(1);

    await expect(
      upsertForTest('1.0.0', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
    ).rejects.toMatchObject({ code: DUPLICATE_EXTENSION_VERSION_CODE });

    const after = bundles.filter((row) => row.versionId === created.version.id).length;
    expect(after).toBe(1);
  });

  it('T006: concurrent finalize-style requests map losing request to duplicate-version conflict', async () => {
    const extension = { id: uuidv4(), name: 'race-test-ext', publisher: 'vitest', createdAt: new Date() };
    let created = false;

    setRegistryV2Repository({
      extensions: {
        findByNamePublisher: async () => extension,
        create: async () => extension,
      },
      versions: {
        findByHash: async () => null,
        findLatestForExtension: async () => null,
        listVersionStringsForExtension: async () => [],
        findByExtensionAndVersion: async () => null,
        create: async (input: any) => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          if (created) {
            const err = Object.assign(new Error('duplicate key value violates unique constraint'), {
              code: '23505',
              detail: `Key (registry_id, version)=(${input.extensionId}, ${input.version}) already exists.`,
              constraint: 'extension_version_registry_id_version_unique',
            });
            throw err;
          }
          created = true;
          return {
            id: uuidv4(),
            extensionId: input.extensionId,
            version: input.version,
            contentHash: input.contentHash,
            runtime: input.runtime,
            endpoints: input.endpoints,
            capabilities: input.capabilities,
            createdAt: new Date(),
          };
        },
      },
    } as any);

    const publishA = upsertForTest('2.0.0', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const publishB = upsertForTest('2.0.0', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');

    const results = await Promise.allSettled([publishA, publishB]);
    const fulfilled = results.filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(isDuplicateExtensionVersionError(rejected[0].reason)).toBe(true);
    expect(rejected[0].reason.status).toBe(409);
    expect(rejected[0].reason.code).toBe(DUPLICATE_EXTENSION_VERSION_CODE);
  });

  it('T007: unique-violation for (registry_id, version) is normalized to duplicate-version code/message', async () => {
    const uniqueErr = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      detail: 'Key (registry_id, version)=(abc, 1.0.0) already exists.',
      constraint: 'extension_version_registry_id_version_unique',
    });

    setRegistryV2Repository({
      extensions: {
        findByNamePublisher: async () => null,
        create: async () => ({ id: uuidv4(), name: 'fake', publisher: 'fake', createdAt: new Date() }),
      },
      versions: {
        findByExtensionAndVersion: async () => null,
        findByHash: async () => null,
        findLatestForExtension: async () => null,
        listVersionStringsForExtension: async () => [],
        create: async () => {
          throw uniqueErr;
        },
      },
    } as any);

    await expect(
      createExtensionVersion({
        extensionId: uuidv4(),
        version: '1.0.0',
        contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        runtime: 'node@1',
        endpoints: [],
        capabilities: [],
      })
    ).rejects.toMatchObject({
      status: 409,
      code: DUPLICATE_EXTENSION_VERSION_CODE,
      message: 'Version "1.0.0" already exists for this extension. Publish a new version and try again.',
    });
  });

  it('T023: strict immutability leaves historical multi-bundle legacy data untouched', async () => {
    const { repo, bundles } = createInMemoryRepo();
    setRegistryV2Repository(repo as any);

    const created = await upsertForTest('1.0.0', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    bundles.push({
      versionId: created.version.id,
      contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      createdAt: new Date(),
    });

    const before = bundles
      .filter((row) => row.versionId === created.version.id)
      .map((row) => row.contentHash)
      .sort();
    expect(before).toHaveLength(2);

    await expect(
      upsertForTest('1.0.0', 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc')
    ).rejects.toMatchObject({ code: DUPLICATE_EXTENSION_VERSION_CODE });

    const after = bundles
      .filter((row) => row.versionId === created.version.id)
      .map((row) => row.contentHash)
      .sort();

    expect(after).toEqual(before);
  });

  it('T001/T002: duplicate finalize-style errors expose stable code + friendly message with version value', async () => {
    const { repo } = createInMemoryRepo();
    setRegistryV2Repository(repo as any);

    await upsertForTest('7.7.7', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

    await expect(
      upsertForTest('7.7.7', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
    ).rejects.toMatchObject({
      status: 409,
      code: DUPLICATE_EXTENSION_VERSION_CODE,
      message: 'Version "7.7.7" already exists for this extension. Publish a new version and try again.',
    });
  });
});
