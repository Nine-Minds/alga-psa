import { createHash } from 'node:crypto';
import { isCoManagedUuid } from './sharedWorkIdentity';
import { validateCoManagedPortableWorkspaceRecords, type CoManagedPortableRecordSections } from './portableWorkspaceGraph';

type ObjectValue = Record<string, any>;
export interface CoManagedPortableWorkspaceContext { packageId: string; sourceTenant: string; capturedAt: string }
export interface CoManagedPortableBlobDescriptor { id: string; size: number; sha256: string }
export interface CoManagedPortableWorkspaceManifest extends Record<string, unknown> {
  kind: 'alga-portable-workspace'; version: 1; context: CoManagedPortableWorkspaceContext;
  sections: Record<keyof CoManagedPortableRecordSections, ObjectValue>;
  conversationFiles: ObjectValue; supplementalFiles: ObjectValue; remoteMeetingFiles: ObjectValue;
  credentialVault: ObjectValue; blobs: CoManagedPortableBlobDescriptor[];
}
const fail = (): never => { throw new Error('Invalid portable workspace manifest'); };
const object = (value: unknown): ObjectValue => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail();
  return value as ObjectValue;
};
function keys(value: unknown, names: readonly string[]) {
  const row = object(value);
  if (Object.keys(row).length !== names.length || names.some(name => !Object.hasOwn(row, name))) fail();
  return row;
}
function rows(value: unknown): ObjectValue[] {
  if (!Array.isArray(value) || value.length > 100_000) fail();
  return value.map(object);
}
const same = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const common = ['kind', 'version', 'packageId', 'sourceTenant', 'sha256'];
const sectionFields: Record<keyof CoManagedPortableRecordSections, string[]> = {
  core: ['capturedAt', 'records', 'references', 'restorePolicy'],
  work: ['capturedAt', 'records', 'references', 'restorePolicy'],
  documents: ['records', 'references', 'fileBindings', 'blobs'],
  assets: ['capturedAt', 'records', 'references', 'polymorphicReferences', 'typeReferences', 'restorePolicy'],
  operational: ['capturedAt', 'records', 'references', 'polymorphicReferences', 'restorePolicy'],
  workflows: ['capturedAt', 'records', 'references', 'referenceValueTypes', 'conditionalReferences', 'dependencies', 'systemForms', 'restorePolicy'],
  engagement: ['capturedAt', 'records', 'references', 'additionalReferences', 'restorePolicy'],
};
function component(input: unknown, kind: string, fields: string[], context: CoManagedPortableWorkspaceContext) {
  const value = keys(input, [...common, ...fields]);
  if (value.kind !== `alga-workspace-${kind}` || value.version !== 1 || !same(value.packageId, context.packageId) ||
      !same(value.sourceTenant, context.sourceTenant) || fields.includes('capturedAt') && value.capturedAt !== context.capturedAt) fail();
  const { sha256, ...payload } = value;
  if (sha256 !== hash(payload)) fail();
  return value;
}
function descriptor(input: unknown, named = false): CoManagedPortableBlobDescriptor {
  const value = keys(input, named ? ['id', 'size', 'sha256', 'name', 'mimeType'] : ['id', 'size', 'sha256']);
  const [kind, id, extra] = typeof value.id === 'string' ? value.id.split(':') : [];
  if (extra !== undefined || !['file', 'document', 'attachment', 'meeting_artifact'].includes(kind) || !isCoManagedUuid(id) ||
      !Number.isSafeInteger(value.size) || value.size < 0 || value.size > 64 * 1024 ** 3 || !/^[a-f0-9]{64}$/.test(value.sha256)) fail();
  if (named && (typeof value.name !== 'string' || typeof value.mimeType !== 'string')) fail();
  return { id: value.id, size: value.size, sha256: value.sha256 };
}

/** Called only after container authentication on import. Component checksums
 * detect accidental mixing; they are not signatures or authorization. All
 * reference and restore policy declarations remain informational: import uses
 * trusted application catalogs, never instructions supplied by an archive. */
export function validateCoManagedPortableWorkspaceManifest(input: unknown,
  expectedContext?: Pick<CoManagedPortableWorkspaceContext, 'packageId' | 'sourceTenant'>,
  files?: readonly CoManagedPortableBlobDescriptor[]): CoManagedPortableWorkspaceManifest {
  const manifest = keys(input, ['kind', 'version', 'context', 'sections', 'conversationFiles', 'supplementalFiles', 'remoteMeetingFiles', 'credentialVault', 'blobs']);
  const context = keys(manifest.context, ['packageId', 'sourceTenant', 'capturedAt']) as CoManagedPortableWorkspaceContext;
  if (manifest.kind !== 'alga-portable-workspace' || manifest.version !== 1 || !isCoManagedUuid(context.packageId) || !isCoManagedUuid(context.sourceTenant) ||
      typeof context.capturedAt !== 'string' || !Number.isFinite(Date.parse(context.capturedAt)) ||
      expectedContext && (!same(context.packageId, expectedContext.packageId) || !same(context.sourceTenant, expectedContext.sourceTenant))) fail();
  keys(manifest.sections, Object.keys(sectionFields));
  const sections = {} as CoManagedPortableRecordSections;
  for (const name of Object.keys(sectionFields) as (keyof CoManagedPortableRecordSections)[]) {
    sections[name] = component(manifest.sections[name], name, sectionFields[name], context).records;
  }
  const { records } = validateCoManagedPortableWorkspaceRecords(sections, { sourceTenant: context.sourceTenant });
  const conversation = component(manifest.conversationFiles, 'conversation-files', ['restorePolicy', 'attachments'], context);
  const supplemental = component(manifest.supplementalFiles, 'supplemental-files', ['restorePolicy', 'fileBindings', 'blobs'], context);
  const remote = component(manifest.remoteMeetingFiles, 'remote-meeting-files', ['restorePolicy', 'fileBindings', 'blobs'], context);
  const documents = manifest.sections.documents;
  const registry = new Map<string, CoManagedPortableBlobDescriptor>(), used = new Set<string>();
  const add = (blob: CoManagedPortableBlobDescriptor) => {
    const key = blob.id.toLowerCase(); if (registry.has(key)) fail(); registry.set(key, blob);
  };
  for (const group of [documents, supplemental, remote]) for (const blob of rows(group.blobs)) add(descriptor(blob, true));
  const indexes = new Map<string, Map<string, ObjectValue>>();
  const find = (table: string, column: string, id: unknown) => {
    if (!isCoManagedUuid(id)) fail();
    const key = `${table}:${column}`;
    if (!indexes.has(key)) indexes.set(key, new Map(records[table].map(row => [String(row[column]).toLowerCase(), row])));
    return indexes.get(key)!.get(id.toLowerCase()) ?? fail();
  };
  const use = (id: unknown) => {
    if (typeof id !== 'string' || !registry.has(id.toLowerCase())) fail(); used.add(id.toLowerCase());
  };
  const bindings = new Set<string>();
  for (const binding of rows(documents.fileBindings)) {
    keys(binding, ['documentId', 'field', 'blobId']);
    const doc = find('documents', 'document_id', binding.documentId);
    if (!['file_id', 'thumbnail_file_id', 'preview_file_id'].includes(binding.field)) fail();
    const key = `${String(doc.document_id).toLowerCase()}:${binding.field}`;
    if (bindings.has(key)) fail(); bindings.add(key);
    const expected = doc[binding.field] ? `file:${doc[binding.field]}` : binding.field === 'file_id' ? `document:${doc.document_id}` : null;
    if (!same(binding.blobId, expected)) fail(); use(binding.blobId);
  }
  for (const doc of records.documents) for (const field of ['file_id', 'thumbnail_file_id', 'preview_file_id']) {
    if (doc[field] !== null && !bindings.has(`${String(doc.document_id).toLowerCase()}:${field}`)) fail();
  }
  const artifactBindings = new Set<string>();
  for (const [group, field, prefix] of [[supplemental, 'file_id', 'file'], [remote, 'content', 'meeting_artifact']] as const) {
    for (const binding of rows(group.fileBindings)) {
      keys(binding, ['table', 'recordId', 'field', 'blobId']);
      if (binding.table !== 'online_meeting_artifacts' || binding.field !== field) fail();
      const artifact = find('online_meeting_artifacts', 'artifact_id', binding.recordId), key = String(artifact.artifact_id).toLowerCase();
      if (artifactBindings.has(key) || (field === 'file_id' ? !isCoManagedUuid(artifact.file_id) : artifact.file_id !== null)) fail();
      if (!same(binding.blobId, `${prefix}:${field === 'file_id' ? artifact.file_id : artifact.artifact_id}`)) fail();
      artifactBindings.add(key); use(binding.blobId);
    }
  }
  const documentsWithBlocks = new Set(records.document_block_content.filter(row => row.block_data !== null).map(row => String(row.document_id).toLowerCase()));
  for (const artifact of records.online_meeting_artifacts) {
    if (artifactBindings.has(String(artifact.artifact_id).toLowerCase())) continue;
    if (artifact.file_id !== null || !artifact.document_id) fail();
    const doc = find('documents', 'document_id', artifact.document_id);
    const hasBlocks = documentsWithBlocks.has(String(doc.document_id).toLowerCase());
    if (!doc.file_id && !(artifact.artifact_type === 'transcript' && hasBlocks)) fail();
  }
  for (const attachment of rows(conversation.attachments)) {
    keys(attachment, ['attachmentId', 'blobId', 'ticketId', 'threadId', 'commentId', 'audience', 'fileName', 'mimeType', 'size', 'sha256',
      'createdAt', 'actorTenant', 'actorUserId', 'actorReferenceId', 'actorDisplayName', 'actorOrganizationName']);
    if (!isCoManagedUuid(attachment.attachmentId) || !same(attachment.blobId, `attachment:${attachment.attachmentId}`)) fail();
    add(descriptor({ id: attachment.blobId, size: attachment.size, sha256: attachment.sha256, name: attachment.fileName, mimeType: attachment.mimeType }, true));
    const comment = find('comments', 'comment_id', attachment.commentId), thread = find('comment_threads', 'thread_id', attachment.threadId);
    const root = find('comments', 'comment_id', thread.root_comment_id);
    // Match the canonical SQL audience facet, including inconsistent legacy flags.
    const audience = [thread, root, comment].every(row => row.is_internal === false) &&
      (thread.collaboration_audience === null || thread.collaboration_audience === 'requester') ? 'requester' :
      [thread, root, comment].every(row => row.is_internal === true) && thread.collaboration_audience === 'shared_it' ? 'shared_it' : 'organization_private';
    if (!same(comment.ticket_id, attachment.ticketId) || !same(thread.ticket_id, attachment.ticketId) || !same(comment.thread_id, attachment.threadId) ||
        comment.publish_state !== 'published' || root.publish_state !== 'published' || comment.deleted_at !== null ||
        attachment.audience !== audience || attachment.actorReferenceId !== comment.actor_reference_id ||
        attachment.actorDisplayName !== comment.actor_display_name || attachment.actorOrganizationName !== comment.actor_organization_name) fail();
    if (!isCoManagedUuid(attachment.actorTenant) || !isCoManagedUuid(attachment.actorUserId)) fail();
    if (attachment.actorReferenceId !== null) find('collaboration_actor_references', 'actor_reference_id', attachment.actorReferenceId);
    use(attachment.blobId);
  }
  const declared = new Map<string, CoManagedPortableBlobDescriptor>();
  for (const row of rows(manifest.blobs)) {
    const blob = descriptor(row), key = blob.id.toLowerCase();
    if (declared.has(key)) fail(); declared.set(key, blob);
  }
  const equalBlobs = (actual: Map<string, CoManagedPortableBlobDescriptor>) => {
    if (actual.size !== registry.size) fail();
    for (const [key, blob] of registry) {
      const other = actual.get(key); if (!other || other.size !== blob.size || other.sha256 !== blob.sha256) fail();
    }
  };
  equalBlobs(declared);
  if (used.size !== registry.size) fail();
  if (files) {
    const actual = new Map<string, CoManagedPortableBlobDescriptor>();
    for (const file of files) {
      const blob = descriptor({ id: file.id, size: file.size, sha256: file.sha256 }), key = blob.id.toLowerCase();
      if (actual.has(key)) fail(); actual.set(key, blob);
    }
    equalBlobs(actual);
  }
  validateVault(manifest.credentialVault, context, find);
  return manifest as CoManagedPortableWorkspaceManifest;
}

function validateVault(input: unknown, context: CoManagedPortableWorkspaceContext, find: (table: string, column: string, id: unknown) => ObjectValue) {
  const data = keys(input, ['vault', 'credentials', 'grants', 'associations']);
  const vault = keys(data.vault, ['format', 'packageId', 'sourceTenant', 'salt', 'iv', 'tag', 'ciphertext']);
  if (vault.format !== 'alga-credential-vault:scrypt-aes-256-gcm:v1' || !same(vault.packageId, context.packageId) || !same(vault.sourceTenant, context.sourceTenant)) fail();
  for (const [field, size] of [['salt', 16], ['iv', 12], ['tag', 16], ['ciphertext', null]] as const) {
    if (typeof vault[field] !== 'string' || vault[field].length > 48 * 1024 ** 2) fail();
    const bytes = Buffer.from(vault[field], 'base64');
    if (bytes.toString('base64') !== vault[field] || (size !== null ? bytes.length !== size : !bytes.length || bytes.length > 32 * 1024 ** 2)) fail();
  }
  const ids = new Set<string>();
  for (const row of rows(data.credentials)) {
    keys(row, ['credential_id', 'client_id', 'name', 'username', 'url', 'description', 'is_restricted', 'created_by', 'created_at', 'updated_at']);
    if (!isCoManagedUuid(row.credential_id) || ids.has(row.credential_id.toLowerCase()) || typeof row.is_restricted !== 'boolean') fail();
    ids.add(row.credential_id.toLowerCase());
    if (row.client_id !== null) find('clients', 'client_id', row.client_id);
    if (row.created_by !== null) find('users', 'user_id', row.created_by);
  }
  const seen = new Set<string>();
  const parents: Record<string, [string, string]> = { user: ['users', 'user_id'], team: ['teams', 'team_id'], client: ['clients', 'client_id'],
    contact: ['contacts', 'contact_name_id'], ticket: ['tickets', 'ticket_id'],
    project_task: ['project_tasks', 'task_id'], asset: ['assets', 'asset_id'], document: ['documents', 'document_id'] };
  for (const [table, type, id] of [['grants', 'subject_type', 'subject_id'], ['associations', 'entity_type', 'entity_id']] as const) {
    for (const row of rows(data[table])) {
      keys(row, table === 'grants' ? ['credential_id', type, id, 'created_by', 'created_at'] : ['credential_id', type, id, 'created_at']);
      if (!isCoManagedUuid(row.credential_id) || !ids.has(row.credential_id.toLowerCase()) || table === 'grants' && !['user', 'team'].includes(row[type])) fail();
      if (table === 'associations' && row[type] === 'tenant') {
        if (!same(row[id], context.sourceTenant)) fail();
      } else {
        const parent = parents[row[type]]; if (!parent) fail(); find(...parent, row[id]);
      }
      const key = JSON.stringify([table, row.credential_id.toLowerCase(), row[type], row[id].toLowerCase()]);
      if (seen.has(key)) fail(); seen.add(key);
      if (table === 'grants' && row.created_by !== null) find('users', 'user_id', row.created_by);
    }
  }
}

export function buildCoManagedPortableWorkspaceManifest(input: Pick<CoManagedPortableWorkspaceManifest,
  'context' | 'sections' | 'conversationFiles' | 'supplementalFiles' | 'remoteMeetingFiles' | 'credentialVault'> & { files: readonly CoManagedPortableBlobDescriptor[] }) {
  const { files, ...components } = input;
  const blobs = files.map(({ id, size, sha256 }) => ({ id, size, sha256 }));
  return validateCoManagedPortableWorkspaceManifest({ kind: 'alga-portable-workspace', version: 1, ...components, blobs }, input.context, files);
}
