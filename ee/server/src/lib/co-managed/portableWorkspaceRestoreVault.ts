import { randomUUID } from 'node:crypto';
import { validateCoManagedPortableWorkspaceManifest, type CoManagedPortableWorkspaceManifest } from '../../../../../packages/co-managed/src/portableWorkspaceManifest';
import type { PortableRestoreIdentityMap } from '../../../../../packages/co-managed/src/portableRestoreIdentity';
import type { PortableRecords } from '../../../../../packages/co-managed/src/portableRecordValidation';
import { isCoManagedUuid } from '../../../../../packages/co-managed/src/sharedWorkIdentity';
import { restorePortableCredentialVault, type PortableCredentialVault } from '../credentials/portable';

interface RestoreRecords {
  sourceTenant: string; destinationTenant: string; records: PortableRecords; domains: PortableRestoreIdentityMap[];
}
const fail = (): never => { throw new Error('Invalid portable workspace vault restore'); };
const uuid = (value: unknown): string => isCoManagedUuid(value) ? value.toLowerCase() : fail();
const address = (table: string, column: string) => JSON.stringify([table, column]);
// Native credential association enum, limited to the operational sections this
// format actually carries. Project, contract and quote are not import targets.
const entities: Record<string, readonly [string, string]> = {
  asset: ['assets', 'asset_id'], client: ['clients', 'client_id'], contact: ['contacts', 'contact_name_id'],
  document: ['documents', 'document_id'], project_task: ['project_tasks', 'task_id'], team: ['teams', 'team_id'],
  ticket: ['tickets', 'ticket_id'], user: ['users', 'user_id'],
};
const date = (value: unknown) => { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail(); };

/** Internal preparation after archive authentication and complete record
 * remapping. The caller admits a suspended destination and atomically inserts
 * these rows with its workspace. This performs no database write, activation,
 * login or trust creation; only destination-encrypted values are returned. */
export async function prepareCoManagedPortableWorkspaceVault(input: {
  manifest: CoManagedPortableWorkspaceManifest; restoreRecords: RestoreRecords; passphrase: string;
}, options: { allocateUuid?: () => string; reservedUuids?: readonly string[] } = {}) {
  // Capture every caller-owned value before KDF/provider awaits or allocation.
  const manifest = validateCoManagedPortableWorkspaceManifest(structuredClone(input.manifest));
  const prepared = structuredClone(input.restoreRecords), passphrase = input.passphrase;
  const sourceTenant = uuid(prepared.sourceTenant), tenant = uuid(prepared.destinationTenant);
  if (sourceTenant !== uuid(manifest.context.sourceTenant) || sourceTenant === tenant) fail();
  const source = Object.assign({}, ...Object.values(manifest.sections).map(section => section.records)) as PortableRecords;
  const reserved = new Set<string>([sourceTenant, tenant, uuid(manifest.context.packageId), ...(options.reservedUuids ?? []).map(uuid)]);
  const maps = new Map<string, Map<string, string>>();
  for (const domain of prepared.domains) {
    const key = address(domain.table, domain.column);
    if (maps.has(key)) fail();
    const mapping = new Map<string, string>(), destinations = new Set<string>();
    if (domain.valueType !== 'uuid') continue;
    for (const pair of domain.mappings) {
      const from = uuid(pair.source), to = uuid(pair.destination);
      if (mapping.has(from) || destinations.has(to)) fail();
      mapping.set(from, to); destinations.add(to); reserved.add(from); reserved.add(to);
    }
    maps.set(key, mapping);
  }
  // Qualified historical actors are not destination logins, but their original
  // UUIDs must also never be reused for new credential identities.
  for (const table of ['collaboration_actor_references', 'handoff_history']) for (const row of source[table]) {
    reserved.add(uuid(row.actor_tenant)); if (row.actor_user_id !== null) reserved.add(uuid(row.actor_user_id));
  }
  for (const blob of manifest.blobs) reserved.add(uuid(blob.id.split(':')[1]));
  for (const attachment of manifest.conversationFiles.attachments) {
    reserved.add(uuid(attachment.actorTenant)); reserved.add(uuid(attachment.actorUserId));
  }
  const indexes = new Map<string, Map<string, Record<string, unknown>>>();
  const row = (records: PortableRecords, scope: string, table: string, column: string, value: unknown) => {
    const key = JSON.stringify([scope, table, column]);
    if (!indexes.has(key)) {
      if (!Array.isArray(records[table])) fail();
      indexes.set(key, new Map(records[table].map(item => [uuid(item[column]), item])));
    }
    return indexes.get(key)!.get(uuid(value)) ?? fail();
  };
  const remap = (table: string, column: string, value: unknown) => {
    row(source, 'source', table, column, value);
    const target = maps.get(address(table, column))?.get(uuid(value)) ?? fail();
    row(prepared.records, 'destination', table, column, target);
    if (target === uuid(value) || target === sourceTenant || target === tenant) fail();
    return target;
  };
  const data = manifest.credentialVault;
  for (const credential of data.credentials) reserved.add(uuid(credential.credential_id));
  const allocatedIds: string[] = [], allocate = options.allocateUuid ?? randomUUID;
  const next = () => {
    const value = uuid(allocate()); if (reserved.has(value)) fail();
    reserved.add(value); allocatedIds.push(value); return value;
  };
  const credentialIds = new Map<string, string>();
  const credentials = data.credentials.map((credential: Record<string, any>) => {
    if (typeof credential.name !== 'string' || ['username', 'url', 'description'].some(field => credential[field] !== null && typeof credential[field] !== 'string')) fail();
    date(credential.created_at); date(credential.updated_at);
    const credential_id = next(); credentialIds.set(uuid(credential.credential_id), credential_id);
    return { ...credential, tenant, credential_id, client_id: remap('clients', 'client_id', credential.client_id),
      created_by: remap('users', 'user_id', credential.created_by) };
  });
  const credentialId = (value: unknown) => credentialIds.get(uuid(value)) ?? fail();
  const credential_access_grants = data.grants.map((grant: Record<string, any>) => {
    date(grant.created_at);
    if (!['user', 'team'].includes(grant.subject_type)) fail();
    return { ...grant, tenant, grant_id: next(), credential_id: credentialId(grant.credential_id),
      subject_id: grant.subject_type === 'user' ? remap('users', 'user_id', grant.subject_id) : remap('teams', 'team_id', grant.subject_id),
      created_by: remap('users', 'user_id', grant.created_by) };
  });
  const credential_associations = data.associations.map((association: Record<string, any>) => {
    date(association.created_at);
    let entity_id: string;
    if (association.entity_type === 'tenant') {
      if (uuid(association.entity_id) !== sourceTenant) fail(); entity_id = tenant;
    } else {
      const target = entities[association.entity_type]; if (!target) fail();
      entity_id = remap(...target, association.entity_id);
      // Preserve the same native owning-client invariant as association writes.
      if (['ticket', 'asset', 'contact', 'project_task'].includes(association.entity_type)) {
        let entity = row(source, 'source', ...target, association.entity_id);
        if (association.entity_type === 'project_task') {
          const phase = row(source, 'source', 'project_phases', 'phase_id', entity.phase_id);
          entity = row(source, 'source', 'projects', 'project_id', phase.project_id);
        }
        const credential = data.credentials.find((item: Record<string, any>) => uuid(item.credential_id) === uuid(association.credential_id));
        if (entity.client_id !== null && uuid(entity.client_id) !== uuid(credential.client_id)) fail();
      }
    }
    return { ...association, tenant, association_id: next(), credential_id: credentialId(association.credential_id), credential_ref: null, entity_id };
  });
  const encrypted = await restorePortableCredentialVault(data.vault as PortableCredentialVault, manifest.context,
    data.credentials.map((credential: Record<string, any>) => credential.credential_id), passphrase);
  const encryptedById = new Map(encrypted.map(value => [uuid(value.credentialId), value]));
  const nativeCredentials = credentials.map((credential: Record<string, any>, index: number) => {
    const secret = encryptedById.get(uuid(data.credentials[index].credential_id)) ?? fail();
    return { ...credential, password_ciphertext: secret.passwordCiphertext, otp_secret_ciphertext: secret.otpSecretCiphertext, encryption_scheme: secret.scheme };
  });
  const domains: PortableRestoreIdentityMap[] = [{ table: 'credentials', column: 'credential_id', valueType: 'uuid',
    mappings: [...credentialIds].map(([source, destination]) => ({ source, destination })) }];
  return { tenant, credentials: nativeCredentials, credential_access_grants, credential_associations, domains, allocatedIds,
    restorePolicy: { sponsorship: 'none', destinationActivation: 'manual', encryption: 'destination_vault' } as const };
}
