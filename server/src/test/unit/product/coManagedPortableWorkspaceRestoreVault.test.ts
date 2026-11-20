import { beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
const { getSecret } = vi.hoisted(() => ({ getSecret: vi.fn() }));
vi.mock('@alga-psa/core/secrets', () => ({ getSecret }));
vi.mock('@alga-psa/core/logger', () => ({ default: { error: vi.fn() } }));
import { encryptCredentialValues, decryptCredentialValue, resetCredentialAesKeyCache } from '../../../../../ee/server/src/lib/credentials/encryption';
import { sealPortableCredentialVault, type PortableCredentialVault } from '../../../../../ee/server/src/lib/credentials/portable';
import { prepareCoManagedPortableWorkspaceVault as prepare } from '../../../../../ee/server/src/lib/co-managed/portableWorkspaceRestoreVault';
import { fixtureManifest, prepare as prepareRecords, id, SOURCE, TARGET, ADMIN } from './portableRestoreFixtures';

const context = { packageId: id(3), sourceTenant: SOURCE, capturedAt: '2026-01-01T00:00:00.000Z' }, destinationTenant = TARGET;
const passphrase = 'customer held recovery phrase';
const secret = { password: 'saved customer password', otpSecret: 'JBSWY3DPEHPK3PXP' };
let vault: PortableCredentialVault, stored: Awaited<ReturnType<typeof encryptCredentialValues>>;
const environment = { ...process.env };
// Restore keys in place. Assigning a fresh object to process.env swaps the
// object out from under every module that captured the original reference —
// `import { env } from 'node:process'` keeps pointing at the old one — so later
// files in the shared fork write to one object and read from another. That is
// how this file used to leave the chat completions route reading a stale
// EDITION and answering 404.
function restoreEnvironment() {
  for (const key of Object.keys(process.env)) {
    if (!(key in environment)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(environment)) {
    if (process.env[key] !== value) process.env[key] = value;
  }
}
function localOnly() { for (const key of ['VAULT_ADDR', 'VAULT_TOKEN', 'ALGA_VAULT_ADDR', 'ALGA_VAULT_TOKEN']) delete process.env[key]; }
beforeAll(async () => {
  localOnly(); getSecret.mockResolvedValue('source key discarded after export'); resetCredentialAesKeyCache();
  stored = await encryptCredentialValues(secret);
  vault = await sealPortableCredentialVault(context, [{ credentialId: id(50), ...stored }], passphrase);
  restoreEnvironment(); resetCredentialAesKeyCache();
});
beforeEach(() => { localOnly(); getSecret.mockReset().mockResolvedValue('new destination vault key'); resetCredentialAesKeyCache(); });
afterEach(() => { restoreEnvironment(); resetCredentialAesKeyCache(); vi.unstubAllGlobals(); });


async function fixture(withVault = true, extraAssociations: [string, string][] = []) {
  const credentialVault = withVault ? { vault: structuredClone(vault), credentials: [{ credential_id: id(50), client_id: id(20), name: 'Firewall', username: 'admin', url: null,
    description: 'Customer owned', is_restricted: true, created_by: ADMIN, created_at: context.capturedAt, updated_at: context.capturedAt }],
  grants: [{ credential_id: id(50), subject_type: 'user', subject_id: ADMIN, created_by: ADMIN, created_at: context.capturedAt }],
  associations: [['tenant', SOURCE], ['user', ADMIN], ['client', id(20)], ['ticket', id(32)], ...extraAssociations]
    .map(([entity_type, entity_id]) => ({ credential_id: id(50), entity_type, entity_id, created_at: context.capturedAt })) } : null;
  const { manifest } = await fixtureManifest(() => {}, [], credentialVault);
  return { manifest, restoreRecords: prepareRecords(manifest), passphrase };
}

it('re-wraps native credentials under the destination key and remaps supported associations and ACLs', async () => {
  const f = await fixture(); let n = 2000;
  await expect(decryptCredentialValue(stored.passwordCiphertext, stored.scheme)).rejects.toThrow();
  const result = await prepare(f as never, { allocateUuid: () => id(n++) });
  const credential = result.credentials[0] as Record<string, any>;
  expect(credential).toMatchObject({ tenant: destinationTenant, name: 'Firewall', is_restricted: true, encryption_scheme: 'aes-256-gcm:v1',
    client_id: f.restoreRecords.records.clients[0].client_id, created_by: f.restoreRecords.records.users[0].user_id });
  await expect(decryptCredentialValue(credential.password_ciphertext, credential.encryption_scheme)).resolves.toBe(secret.password);
  await expect(decryptCredentialValue(credential.otp_secret_ciphertext, credential.encryption_scheme)).resolves.toBe(secret.otpSecret);
  expect(result.credential_access_grants.map(row => row.subject_id)).toEqual([f.restoreRecords.records.users[0].user_id]);
  expect(result.credential_associations.map(row => row.entity_type).sort()).toEqual(['client', 'tenant', 'ticket', 'user']);
  expect(result.credential_associations.find(row => row.entity_type === 'tenant')).toMatchObject({ entity_id: destinationTenant });
  expect(result.droppedAssociations).toBe(0);
  const text = JSON.stringify(result);
  for (const leaked of [secret.password, secret.otpSecret, passphrase, stored.passwordCiphertext!]) expect(text).not.toContain(leaked);
});

it('fails closed on a wrong passphrase and never echoes it', async () => {
  const f = await fixture();
  const wrong = 'a different long passphrase';
  const error = await prepare({ ...f, passphrase: wrong } as never).then(() => undefined, caught => caught as Error);
  expect(error).toBeInstanceOf(Error);
  expect(error?.name).not.toBe('DataCloneError');
  expect(String(error?.message)).not.toContain(wrong);
});

it('treats an archive without a vault as a recorded exclusion, not an error', async () => {
  const f = await fixture(false);
  const result = await prepare(f as never);
  expect(result).toMatchObject({ credentials: [], credential_access_grants: [], credential_associations: [], droppedAssociations: 0 });
});

it('rejects an association to a record the archive does not contain', async () => {
  const f = await fixture(true, [['asset', id(99)]]);
  await expect(prepare(f as never)).rejects.toThrow('Invalid portable workspace vault restore');
});
