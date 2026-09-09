import { beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
const { getSecret } = vi.hoisted(() => ({ getSecret: vi.fn() }));
vi.mock('@alga-psa/core/secrets', () => ({ getSecret }));
vi.mock('@alga-psa/core/logger', () => ({ default: { error: vi.fn() } }));
import { encryptCredentialValues, decryptCredentialValue, resetCredentialAesKeyCache } from '../../../../../ee/server/src/lib/credentials/encryption';
import { sealPortableCredentialVault, type PortableCredentialVault } from '../../../../../ee/server/src/lib/credentials/portable';
import { prepareCoManagedPortableWorkspaceVault as prepare } from '../../../../../ee/server/src/lib/co-managed/portableWorkspaceRestoreVault';
import { CO_MANAGED_PORTABLE_RESTORE_SECTIONS, prepareCoManagedPortableWorkspaceRecords } from '../../../../../packages/co-managed/src/portableWorkspaceRestoreRecords';
import { buildCoManagedPortableWorkspaceManifest } from '../../../../../packages/co-managed/src/portableWorkspaceManifest';
import { createHash } from 'node:crypto';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const context = { packageId: id(1), sourceTenant: id(2), capturedAt: '2026-09-08T12:00:00.000Z' }, destinationTenant = id(3);
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

function fixture() {
  const sections = Object.fromEntries(Object.entries(CO_MANAGED_PORTABLE_RESTORE_SECTIONS).map(([name, tables]) =>
    [name, Object.fromEntries(Object.keys(tables).map(table => [table, []]))])) as Record<string, Record<string, Record<string, any>[]>>;
  const add = (table: string, values: Record<string, unknown>) => {
    const name = Object.keys(CO_MANAGED_PORTABLE_RESTORE_SECTIONS).find(name => Object.hasOwn(CO_MANAGED_PORTABLE_RESTORE_SECTIONS[name as keyof typeof CO_MANAGED_PORTABLE_RESTORE_SECTIONS], table))!;
    const columns = (CO_MANAGED_PORTABLE_RESTORE_SECTIONS[name as keyof typeof CO_MANAGED_PORTABLE_RESTORE_SECTIONS] as Record<string, readonly string[]>)[table];
    sections[name][table].push({ ...Object.fromEntries(columns.map(column => [column, null])), ...values });
  };
  add('tenants', { client_name: 'Customer' }); add('users', { user_id: id(10) }); add('teams', { team_id: id(11) });
  add('clients', { client_id: id(12) }); add('tickets', { ticket_id: id(13), client_id: id(12) });
  add('documents', { document_id: id(14) }); add('contacts', { contact_name_id: id(15), client_id: id(12) });
  add('assets', { asset_id: id(16), client_id: id(12), asset_type: 'workstation' });
  add('projects', { project_id: id(17), client_id: id(12) }); add('project_phases', { phase_id: id(18), project_id: id(17) });
  add('project_tasks', { task_id: id(19), phase_id: id(18) });
  let n = 1000;
  const restoreRecords = prepareCoManagedPortableWorkspaceRecords({ sourceTenant: context.sourceTenant, destinationTenant, sections: sections as any,
    destinationCatalogMappings: { standard_statuses: {}, shared_document_types: {}, system_interaction_types: {}, standard_service_types: {} } }, { allocateUuid: () => id(n++) });
  const sign = (name: string, values: Record<string, any>) => {
    const payload = { kind: `alga-workspace-${name}`, version: 1, packageId: context.packageId, sourceTenant: context.sourceTenant, ...values };
    return { ...payload, sha256: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
  };
  const extras: Record<string, Record<string, unknown>> = {
    assets: { polymorphicReferences: [], typeReferences: [] }, operational: { polymorphicReferences: [] }, engagement: { additionalReferences: [] },
    workflows: { referenceValueTypes: {}, conditionalReferences: [], dependencies: [], systemForms: [] },
  };
  // Informational references/policies never drive the trusted restore catalogs.
  const components = Object.fromEntries(Object.entries(sections).map(([name, records]) => [name, sign(name, name === 'documents'
    ? { records, references: [], fileBindings: [], blobs: [] }
    : { capturedAt: context.capturedAt, records, references: [], restorePolicy: {}, ...extras[name] })]));
  const credentialVault = { vault: structuredClone(vault), credentials: [{ credential_id: id(50), client_id: id(12), name: 'Firewall', username: 'admin', url: null,
    description: 'Customer owned', is_restricted: true, created_by: id(10), created_at: context.capturedAt, updated_at: context.capturedAt }],
  grants: ['user', 'team'].map((subject_type, i) => ({ credential_id: id(50), subject_type, subject_id: id(10 + i), created_by: id(10), created_at: context.capturedAt })),
  associations: [['tenant', context.sourceTenant], ['user', id(10)], ['team', id(11)], ['client', id(12)], ['ticket', id(13)], ['document', id(14)],
    ['contact', id(15)], ['asset', id(16)], ['project_task', id(19)]].map(([entity_type, entity_id]) => ({ credential_id: id(50), entity_type, entity_id, created_at: context.capturedAt })) };
  const manifest = buildCoManagedPortableWorkspaceManifest({ context, sections: components as any, credentialVault, files: [],
    conversationFiles: sign('conversation-files', { restorePolicy: {}, attachments: [] }),
    supplementalFiles: sign('supplemental-files', { restorePolicy: {}, fileBindings: [], blobs: [] }),
    remoteMeetingFiles: sign('remote-meeting-files', { restorePolicy: {}, fileBindings: [], blobs: [] }) });
  return { manifest, restoreRecords, passphrase };
}

it('restores native usable credentials with a new key and remaps every supported association and user/team ACL', async () => {
  const f = fixture(), original = structuredClone(f); let n = 2000;
  await expect(decryptCredentialValue(stored.passwordCiphertext, stored.scheme)).rejects.toThrow();
  const result = await prepare(f, { allocateUuid: () => id(n++) });
  expect(f).toEqual(original);
  expect(result.credentials[0]).toMatchObject({ tenant: destinationTenant, credential_id: id(2000), client_id: f.restoreRecords.records.clients[0].client_id,
    created_by: f.restoreRecords.records.users[0].user_id, name: 'Firewall', is_restricted: true, encryption_scheme: 'aes-256-gcm:v1' });
  const credential = result.credentials[0];
  await expect(decryptCredentialValue(credential.password_ciphertext, credential.encryption_scheme)).resolves.toBe(secret.password);
  await expect(decryptCredentialValue(credential.otp_secret_ciphertext, credential.encryption_scheme)).resolves.toBe(secret.otpSecret);
  expect(result.credential_access_grants.map(row => row.subject_id)).toEqual([f.restoreRecords.records.users[0].user_id, f.restoreRecords.records.teams[0].team_id]);
  expect(result.credential_associations[0]).toMatchObject({ entity_type: 'tenant', entity_id: destinationTenant, credential_id: id(2000), credential_ref: null });
  expect(result.credential_associations.at(-1)).toMatchObject({ entity_type: 'project_task', entity_id: f.restoreRecords.records.project_tasks[0].task_id });
  expect(new Set(result.allocatedIds).size).toBe(12);
  expect(JSON.stringify(result)).not.toContain(secret.password); expect(JSON.stringify(result)).not.toContain(secret.otpSecret);
  expect(JSON.stringify(result)).not.toContain(passphrase); expect(JSON.stringify(result)).not.toContain(stored.passwordCiphertext!);
});

it('rejects source foreign references, unsupported associations and destination map splices before encryption', async () => {
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  process.env.ALGA_VAULT_ADDR = 'https://not-called.example.test'; process.env.ALGA_VAULT_TOKEN = 'test';
  const a = fixture(); a.manifest.credentialVault.credentials[0].created_by = id(999); await expect(prepare(a)).rejects.toThrow();
  const b = fixture(); b.manifest.credentialVault.associations[0].entity_id = id(999); await expect(prepare(b)).rejects.toThrow();
  for (const entity_type of ['project', 'contract', 'quote']) {
    const f = fixture(); f.manifest.credentialVault.associations[0] = { ...f.manifest.credentialVault.associations[0], entity_type, entity_id: id(17) };
    await expect(prepare(f)).rejects.toThrow();
  }
  const c = fixture(); c.restoreRecords.domains.find(domain => domain.table === 'users')!.mappings[0].destination = id(999);
  await expect(prepare(c)).rejects.toThrow();
  const d = fixture(); d.restoreRecords.sourceTenant = id(999); await expect(prepare(d)).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('reserves source, destination, file-adapter and newly allocated identities and rejects native null owners', async () => {
  for (const collision of [context.sourceTenant, destinationTenant, id(50), id(10), id(1000), id(8000)]) {
    await expect(prepare(fixture(), { allocateUuid: () => collision, reservedUuids: [id(8000)] })).rejects.toThrow();
  }
  await expect(prepare(fixture(), { allocateUuid: () => id(2000) })).rejects.toThrow();
  const f = fixture(); f.manifest.credentialVault.credentials[0].client_id = null; await expect(prepare(f)).rejects.toThrow();
  const g = fixture(); g.manifest.credentialVault.grants[0].created_by = null; await expect(prepare(g)).rejects.toThrow();
  const h = fixture(), documents = h.manifest.sections.documents;
  documents.records.documents[0].file_id = id(88);
  const blob = { id: `file:${id(88)}`, size: 0, sha256: createHash('sha256').update('').digest('hex') };
  h.manifest.blobs.push(blob); documents.blobs.push({ ...blob, name: 'Empty document', mimeType: 'text/plain' });
  documents.fileBindings.push({ documentId: id(14), field: 'file_id', blobId: blob.id });
  const { sha256: _, ...payload } = documents; documents.sha256 = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  await expect(prepare(h, { allocateUuid: () => id(88) })).rejects.toThrow();
});

it('preserves native client ownership restrictions for credentials attached to tickets', async () => {
  const f = fixture();
  f.manifest.sections.core.records.clients.push({ ...f.manifest.sections.core.records.clients[0], client_id: id(99) });
  f.manifest.sections.work.records.tickets[0].client_id = id(99);
  for (const section of ['core', 'work']) {
    const { sha256: _, ...payload } = f.manifest.sections[section as 'core' | 'work'];
    f.manifest.sections[section as 'core' | 'work'].sha256 = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }
  await expect(prepare(f)).rejects.toThrow('Invalid portable workspace vault restore');
});

it('authenticates exact envelope membership and passphrase before invoking the configured destination provider', async () => {
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  process.env.ALGA_VAULT_ADDR = 'https://not-called.example.test'; process.env.ALGA_VAULT_TOKEN = 'test';
  const f = fixture(); f.passphrase = 'incorrect customer recovery phrase'; await expect(prepare(f)).rejects.toThrow('cannot be unlocked');
  const g = fixture(); g.manifest.credentialVault.credentials = []; g.manifest.credentialVault.grants = []; g.manifest.credentialVault.associations = [];
  await expect(prepare(g)).rejects.toThrow('cannot be unlocked');
  expect(fetchMock).not.toHaveBeenCalled();
});

it('uses configured destination Transit ciphertext and captures caller metadata before asynchronous encryption', async () => {
  const f = fixture(), fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ data: { ciphertext: 'vault:v1:destination-value' } }) }));
  vi.stubGlobal('fetch', fetchMock); process.env.ALGA_VAULT_ADDR = 'https://destination.example.test'; process.env.ALGA_VAULT_TOKEN = 'test';
  const pending = prepare(f); f.manifest.credentialVault.credentials[0].name = 'Late mutation'; f.restoreRecords.destinationTenant = id(999);
  const result = await pending;
  expect(result.credentials[0]).toMatchObject({ tenant: destinationTenant, name: 'Firewall', encryption_scheme: 'vault-transit:v1', password_ciphertext: 'vault:v1:destination-value' });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
