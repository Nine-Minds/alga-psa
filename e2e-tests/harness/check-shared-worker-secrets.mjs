import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const tenant = 'b574885e-34f2-4960-a1a3-bd6f85fe4890';
const name = 'ci-shared-worker-secret-probe';
const initial = 'ci-synthetic-initial';
const rotated = 'ci-synthetic-rotated';

export async function probeSharedWorkerSecrets({
  phase = process.env.SHARED_WORKER_SECRET_PHASE,
  basePath = '/data/secrets',
  expectedUid = 1000,
  providerModule = '@alga-psa/core/secrets',
} = {}) {
  assert.ok(['write', 'rotate', 'read', 'delete'].includes(phase), 'Expected write, rotate, read, or delete phase');
  assert.equal(process.getuid(), expectedUid, 'Unexpected process UID');
  assert.equal(process.env.SECRET_FS_BASE_PATH, basePath, 'Unexpected secret store configuration');
  const { FileSystemSecretProvider } = await import(providerModule);
  const provider = new FileSystemSecretProvider();
  const privateState = async () => {
    for (const directory of [basePath, path.join(basePath, 'tenants'), path.join(basePath, 'tenants', tenant)]) {
      const metadata = await stat(directory);
      assert.equal(metadata.uid, expectedUid, 'Secret directory has unexpected owner');
      assert.equal(metadata.mode & 0o777, 0o700, 'Secret directory must be private');
    }
    const metadata = await stat(path.join(basePath, 'tenants', tenant, name));
    assert.equal(metadata.uid, expectedUid, 'Secret file has unexpected owner');
    assert.equal(metadata.mode & 0o777, 0o600, 'Secret file must be private');
  };
  const requireValue = async value => {
    // Use a boolean assertion: failures must not print secret contents.
    assert.ok((await provider.getTenantSecret(tenant, name)) === value, 'Shared secret readback did not match this phase');
  };
  if (phase === 'write') {
    await provider.setTenantSecret(tenant, name, initial);
    await requireValue(initial);
    await privateState();
  } else if (phase === 'rotate') {
    await requireValue(initial);
    await privateState();
    await provider.setTenantSecret(tenant, name, rotated);
    await requireValue(rotated);
    await privateState();
  } else if (phase === 'read') {
    await requireValue(rotated);
    await privateState();
  } else {
    await requireValue(rotated);
    await privateState();
    await provider.deleteTenantSecret(tenant, name);
    assert.ok((await provider.getTenantSecret(tenant, name)) === undefined, 'Probe secret still exists after deletion');
  }
}

// Supports both `node script.mjs` and `node --input-type=module < script.mjs`.
if (!process.argv[1] || import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await probeSharedWorkerSecrets();
    console.log('Shared worker secret phase passed');
  } catch {
    console.error('Shared worker secret phase failed');
    process.exitCode = 1;
  }
}
