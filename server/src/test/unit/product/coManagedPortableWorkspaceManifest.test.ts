import { createHash } from 'node:crypto';
import { beforeAll, expect, it } from 'vitest';
import { buildCoManagedPortableWorkspaceManifest as build, validateCoManagedPortableWorkspaceManifest as validate } from '../../../../../packages/co-managed/src/portableWorkspaceManifest';
import { CO_MANAGED_PORTABLE_RESTORE_SECTIONS } from '../../../../../packages/co-managed/src/portableWorkspaceRestoreRecords';
import { CO_MANAGED_PORTABLE_CORE_REFERENCES } from '../../../../../packages/co-managed/src/portableCoreExport';
import { CO_MANAGED_PORTABLE_WORK_REFERENCES } from '../../../../../packages/co-managed/src/portableWorkExport';
import { CO_MANAGED_PORTABLE_DOCUMENT_REFERENCES } from '../../../../../packages/co-managed/src/portableDocumentExport';
import { CO_MANAGED_PORTABLE_ASSET_REFERENCES } from '../../../../../packages/co-managed/src/portableAssetExport';
import { CO_MANAGED_PORTABLE_OPERATIONAL_REFERENCES, CO_MANAGED_PORTABLE_OPERATIONAL_WORK_REFERENCES } from '../../../../../packages/co-managed/src/portableOperationalExport';
import { CO_MANAGED_PORTABLE_WORKFLOW_REFERENCES, CO_MANAGED_PORTABLE_WORKFLOW_VALUE_TYPES } from '../../../../../packages/co-managed/src/portableWorkflowExport';
import { CO_MANAGED_PORTABLE_ENGAGEMENT_REFERENCES, CO_MANAGED_PORTABLE_ENGAGEMENT_ADDITIONAL_REFERENCES } from '../../../../../packages/co-managed/src/portableEngagementExport';
import { sealPortableCredentialVault, type PortableCredentialVault } from '../../../../../ee/server/src/lib/credentials/portable';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const context = { packageId: id(1), sourceTenant: id(2), capturedAt: '2026-09-08T12:00:00.000Z' };
const checksum = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function sign(value: Record<string, any>) { const { sha256: _, ...payload } = value; return { ...payload, sha256: checksum(payload) }; }
let vault: PortableCredentialVault;
beforeAll(async () => { vault = await sealPortableCredentialVault(context, [], 'test workspace passphrase'); });

// Exact collector envelopes over the complete catalog, with no database or provider calls.
function fixture() {
  const tables = Object.fromEntries(Object.entries(CO_MANAGED_PORTABLE_RESTORE_SECTIONS).map(([section, columns]) =>
    [section, Object.fromEntries(Object.keys(columns).map(table => [table, []]))])) as Record<string, Record<string, Record<string, any>[]>>;
  const add = (table: string, values: Record<string, unknown>) => {
    const section = Object.keys(CO_MANAGED_PORTABLE_RESTORE_SECTIONS).find(section => Object.hasOwn(CO_MANAGED_PORTABLE_RESTORE_SECTIONS[section as keyof typeof CO_MANAGED_PORTABLE_RESTORE_SECTIONS], table))!;
    const columns = (CO_MANAGED_PORTABLE_RESTORE_SECTIONS[section as keyof typeof CO_MANAGED_PORTABLE_RESTORE_SECTIONS] as Record<string, readonly string[]>)[table];
    const row = Object.assign(Object.fromEntries(columns.map(column => [column, null])), values);
    tables[section][table].push(row); return row;
  };
  add('tenants', { client_name: 'Customer' });
  const component = (name: string, values: Record<string, any>): Record<string, any> => ({ kind: `alga-workspace-${name}`, version: 1,
    packageId: context.packageId, sourceTenant: context.sourceTenant, ...values });
  const ordinary = (name: string, references: unknown, restorePolicy: unknown, more = {}) => component(name,
    { capturedAt: context.capturedAt, records: tables[name], references, ...more, restorePolicy });
  const sections = {
    core: ordinary('core', CO_MANAGED_PORTABLE_CORE_REFERENCES, { authentication: 'reauthorize', sponsorship: 'none' }),
    work: ordinary('work', CO_MANAGED_PORTABLE_WORK_REFERENCES, { sponsorship: 'none', scheduledPublication: 'paused', handoffHistory: 'historical_activity' }),
    documents: component('documents', { records: tables.documents, references: CO_MANAGED_PORTABLE_DOCUMENT_REFERENCES, fileBindings: [], blobs: [] }),
    assets: ordinary('assets', CO_MANAGED_PORTABLE_ASSET_REFERENCES, { sponsorship: 'none', integrations: 'reauthorize', assetFacts: 'historical_snapshot', maintenanceSchedules: 'paused', maintenanceDispatch: 'none', procurement: 'excluded' }, {
      polymorphicReferences: [{ table: 'asset_associations', column: 'entity_id', discriminator: 'entity_type', targets: {
        user: ['users', 'user_id'], team: ['teams', 'team_id'], client: ['clients', 'client_id'], contact: ['contacts', 'contact_name_id'], ticket: ['tickets', 'ticket_id'], project: ['projects', 'project_id'], asset: ['assets', 'asset_id'], document: ['documents', 'document_id'] } }],
      typeReferences: [{ table: 'assets', column: 'asset_type', parent: 'asset_type_registry', parentColumn: 'slug', builtins: ['workstation', 'server', 'network_device', 'printer', 'mobile_device', 'unknown'] }],
    }),
    operational: ordinary('operational', CO_MANAGED_PORTABLE_OPERATIONAL_REFERENCES, { sponsorship: 'none', timeBilling: 'operational', runningTimers: 'none', notificationDispatch: 'paused' }, { polymorphicReferences: CO_MANAGED_PORTABLE_OPERATIONAL_WORK_REFERENCES }),
    workflows: ordinary('workflows', CO_MANAGED_PORTABLE_WORKFLOW_REFERENCES, { sponsorship: 'none', workflowStatus: 'draft', workflowsPaused: true, publishedVersions: 'historical_only', forms: 'draft', validation: 'rerun', secretReferences: 'reauthorize', connections: 'reauthorize', executionState: 'none', embeddedIdentityRemapping: 'review_before_activation', authoredContent: 'encrypted_package_required' }, {
      referenceValueTypes: CO_MANAGED_PORTABLE_WORKFLOW_VALUE_TYPES,
      conditionalReferences: [{ table: 'workflow_task_definitions', column: 'form_id', discriminator: 'form_type', equals: 'tenant', parent: 'workflow_form_definitions', parentColumn: 'form_id', valueType: 'text' }, { table: 'workflow_form_definitions', column: 'created_by', when: 'uuid', parent: 'users', parentColumn: 'user_id', otherwise: 'historical_label' }], dependencies: [], systemForms: [],
    }),
    engagement: ordinary('engagement', CO_MANAGED_PORTABLE_ENGAGEMENT_REFERENCES, { sponsorship: 'none', providerConnections: 'reauthorize', meetings: 'historical_metadata', appointmentDispatch: 'paused', servicePricing: 'unconfigured', remoteArtifactContent: 'requires_separate_capture' }, { additionalReferences: CO_MANAGED_PORTABLE_ENGAGEMENT_ADDITIONAL_REFERENCES }),
  };
  const conversationFiles = component('conversation-files', { restorePolicy: { attachmentStore: 'native_ticket_documents', sponsorship: 'none' }, attachments: [] });
  const supplementalFiles = component('supplemental-files', { fileBindings: [], restorePolicy: { sponsorship: 'none', providerConnections: 'none' }, blobs: [] });
  const remoteMeetingFiles = component('remote-meeting-files', { fileBindings: [], blobs: [], restorePolicy: { sponsorship: 'none', providerConnections: 'none', artifactContent: 'native_file' } });
  const credentialVault = { vault: structuredClone(vault), credentials: [] as Record<string, any>[], grants: [] as Record<string, any>[], associations: [] as Record<string, any>[] };
  const files: { id: string; size: number; sha256: string; path: string }[] = [];
  const blob = (blobId: string) => {
    const descriptor = { id: blobId, size: 4, sha256: createHash('sha256').update('data').digest('hex') };
    files.push({ ...descriptor, path: '/tmp/private-staging-location' });
    return { ...descriptor, name: 'Customer file', mimeType: 'text/plain' };
  };
  const request = () => ({ context: { ...context }, sections: Object.fromEntries(Object.entries(sections).map(([name, data]) => [name, sign(data)])) as any,
    conversationFiles: sign(conversationFiles), supplementalFiles: sign(supplementalFiles), remoteMeetingFiles: sign(remoteMeetingFiles), credentialVault, files });
  return { add, tables, sections, conversationFiles, supplementalFiles, remoteMeetingFiles, credentialVault, files, blob, request };
}

it('assembles every record table and a real empty passphrase vault with stable JSON roundtrip', () => {
  const f = fixture(), manifest = build(f.request());
  expect(Object.values(manifest.sections).flatMap(section => Object.keys(section.records))).toHaveLength(113);
  expect(validate(JSON.parse(JSON.stringify(manifest)), context, [])).toEqual(manifest);
  expect(manifest.blobs).toEqual([]);
});

it.each(['core', 'work', 'documents', 'assets', 'operational', 'engagement', 'workflows'])('rejects a %s component from another source or capture', name => {
  const f = fixture(), request = f.request();
  request.sections[name] = sign({ ...request.sections[name], sourceTenant: id(900) });
  expect(() => build(request)).toThrow();
  request.sections[name] = sign({ ...request.sections[name], sourceTenant: context.sourceTenant, packageId: id(901) });
  expect(() => build(request)).toThrow();
  if (name !== 'documents') {
    request.sections[name] = sign({ ...request.sections[name], packageId: context.packageId, capturedAt: '2026-09-09T12:00:00.000Z' });
    expect(() => build(request)).toThrow();
  }
});

it('rejects checksum corruption, unexpected headers, missing tables and dangling references even after checksum replacement', () => {
  const f = fixture(), request = f.request();
  request.sections.core.records.tenants[0].client_name = 'Tampered';
  expect(() => build(request)).toThrow();
  request.sections.core = sign(request.sections.core);
  expect(() => build(request)).not.toThrow();
  request.sections.core = sign({ ...request.sections.core, storage_path: '/private' });
  expect(() => build(request)).toThrow();
  const g = fixture(); delete g.tables.work.tickets;
  expect(() => build(g.request())).toThrow();
  const h = fixture(); h.add('tickets', { ticket_id: id(10), board_id: id(999) });
  expect(() => build(h.request())).toThrow();
});

it('matches native file bindings and exact staged descriptors without serializing staging paths', () => {
  const f = fixture(); f.add('documents', { document_id: id(20), file_id: id(21) });
  f.sections.documents.fileBindings.push({ documentId: id(20), field: 'file_id', blobId: `file:${id(21)}` });
  f.sections.documents.blobs.push(f.blob(`file:${id(21)}`));
  const manifest = build(f.request());
  expect(manifest.blobs).toEqual(f.files.map(({ path: _, ...row }) => row));
  expect(JSON.stringify(manifest)).not.toContain('/tmp/private-staging-location');
  expect(() => validate(manifest, context, [])).toThrow();
  expect(() => validate(manifest, context, [...f.files, { id: `file:${id(99)}`, size: 0, sha256: 'a'.repeat(64) }])).toThrow();
  expect(() => validate(manifest, context, [{ ...f.files[0], size: 5 }])).toThrow();
  expect(() => validate(manifest, context, [{ ...f.files[0], sha256: 'b'.repeat(64) }])).toThrow();
  f.sections.documents.fileBindings[0].blobId = `file:${id(99)}`;
  expect(() => build(f.request())).toThrow();
});

it('allows document and supplemental artifact bindings to share one native blob declaration', () => {
  const f = fixture(); f.add('documents', { document_id: id(20), file_id: id(21) });
  f.add('appointment_requests', { appointment_request_id: id(29) });
  f.add('online_meetings', { meeting_id: id(30), appointment_request_id: id(29) });
  f.add('online_meeting_artifacts', { artifact_id: id(31), meeting_id: id(30), file_id: id(21), artifact_type: 'transcript' });
  f.sections.documents.fileBindings.push({ documentId: id(20), field: 'file_id', blobId: `file:${id(21)}` });
  const descriptor = f.blob(`file:${id(21)}`); f.sections.documents.blobs.push(descriptor);
  f.supplementalFiles.fileBindings.push({ table: 'online_meeting_artifacts', recordId: id(31), field: 'file_id', blobId: descriptor.id });
  expect(build(f.request()).blobs).toHaveLength(1);
  f.supplementalFiles.blobs.push({ ...descriptor });
  expect(() => build(f.request())).toThrow();
});

it('requires every native document file and meeting artifact to be captured and every declared blob to be used', () => {
  const f = fixture(); f.add('documents', { document_id: id(20), thumbnail_file_id: id(21) });
  expect(() => build(f.request())).toThrow();
  const g = fixture(); g.sections.documents.blobs.push(g.blob(`file:${id(99)}`));
  expect(() => build(g.request())).toThrow();
  const h = fixture(); h.add('appointment_requests', { appointment_request_id: id(29) });
  h.add('online_meetings', { meeting_id: id(30), appointment_request_id: id(29) });
  h.add('online_meeting_artifacts', { artifact_id: id(31), meeting_id: id(30), artifact_type: 'recording' });
  expect(() => build(h.request())).toThrow();
  const descriptor = h.blob(`meeting_artifact:${id(31)}`); h.remoteMeetingFiles.blobs.push(descriptor);
  h.remoteMeetingFiles.fileBindings.push({ table: 'online_meeting_artifacts', recordId: id(31), field: 'content', blobId: descriptor.id });
  expect(build(h.request()).blobs).toHaveLength(1);
});

it('accepts native transcript blocks without a remote download and preserves legacy document blob bindings', () => {
  const f = fixture(); f.add('documents', { document_id: id(20) });
  f.add('document_block_content', { content_id: id(21), document_id: id(20), block_data: [{ type: 'paragraph', content: 'Transcript' }] });
  f.add('appointment_requests', { appointment_request_id: id(29) });
  f.add('online_meetings', { meeting_id: id(30), appointment_request_id: id(29) });
  const artifact = f.add('online_meeting_artifacts', { artifact_id: id(31), meeting_id: id(30), document_id: id(20), artifact_type: 'transcript' });
  expect(build(f.request()).blobs).toEqual([]);
  artifact.artifact_type = 'recording'; expect(() => build(f.request())).toThrow();
  const g = fixture(); g.add('documents', { document_id: id(40) });
  const descriptor = g.blob(`document:${id(40)}`); g.sections.documents.blobs.push(descriptor);
  g.sections.documents.fileBindings.push({ documentId: id(40), field: 'file_id', blobId: descriptor.id });
  expect(build(g.request()).blobs[0].id).toBe(descriptor.id);
});

it('binds conversation attachments to canonical published comment, thread and audience while retaining foreign authors', () => {
  const f = fixture(); f.add('tickets', { ticket_id: id(40) });
  f.add('comment_threads', { thread_id: id(41), ticket_id: id(40), root_comment_id: id(42), is_internal: true, collaboration_audience: 'shared_it' });
  const comment = f.add('comments', { comment_id: id(42), ticket_id: id(40), thread_id: id(41), publish_state: 'published', is_internal: true });
  const descriptor = f.blob(`attachment:${id(43)}`);
  const attachment = { attachmentId: id(43), blobId: descriptor.id, ticketId: id(40), threadId: id(41), commentId: id(42), audience: 'shared_it',
    fileName: descriptor.name, mimeType: descriptor.mimeType, size: descriptor.size, sha256: descriptor.sha256, createdAt: context.capturedAt,
    actorTenant: id(800), actorUserId: id(801), actorReferenceId: null, actorDisplayName: null, actorOrganizationName: null };
  f.conversationFiles.attachments.push(attachment);
  expect(build(f.request()).conversationFiles.attachments[0].actorTenant).toBe(id(800));
  attachment.audience = 'requester'; expect(() => build(f.request())).toThrow();
  attachment.audience = 'shared_it'; comment.publish_state = 'scheduled'; expect(() => build(f.request())).toThrow();
  comment.publish_state = 'published'; comment.deleted_at = context.capturedAt; expect(() => build(f.request())).toThrow();
});

it('rejects mismatched vault context and malformed authenticated-envelope framing', () => {
  const f = fixture(); f.credentialVault.vault.packageId = id(999); expect(() => build(f.request())).toThrow();
  const g = fixture(); g.credentialVault.vault.salt = Buffer.alloc(15).toString('base64'); expect(() => build(g.request())).toThrow();
  const h = fixture(); h.credentialVault.vault.ciphertext += '\n'; expect(() => build(h.request())).toThrow();
  const manifest = build(fixture().request()); expect(() => validate(manifest, { ...context, sourceTenant: id(999) })).toThrow();
});

it('requires credential metadata, grants and associations to resolve against included local records', () => {
  const f = fixture(); f.add('users', { user_id: id(50) }); f.add('clients', { client_id: id(51) });
  f.credentialVault.credentials.push({ credential_id: id(52), client_id: id(51), name: 'Firewall', username: 'admin', url: null, description: null,
    is_restricted: true, created_by: id(50), created_at: context.capturedAt, updated_at: context.capturedAt });
  const grant = { credential_id: id(52), subject_type: 'user', subject_id: id(50), created_by: id(50), created_at: context.capturedAt };
  f.credentialVault.grants.push(grant);
  f.credentialVault.associations.push({ credential_id: id(52), entity_type: 'client', entity_id: id(51), created_at: context.capturedAt });
  // Manifest validation is structural; decrypted envelope membership is verified by the vault restore primitive.
  expect(() => build(f.request())).not.toThrow();
  grant.subject_id = id(999); expect(() => build(f.request())).toThrow();
  grant.subject_id = id(50); f.credentialVault.grants.push({ ...grant }); expect(() => build(f.request())).toThrow();
  f.credentialVault.grants.pop(); f.credentialVault.associations[0].credential_id = id(999); expect(() => build(f.request())).toThrow();
});

it('preserves native tenant credential associations only for the source workspace', () => {
  const f = fixture();
  f.credentialVault.credentials.push({ credential_id: id(52), client_id: null, name: 'Workspace secret', username: null, url: null, description: null,
    is_restricted: false, created_by: null, created_at: context.capturedAt, updated_at: context.capturedAt });
  const association = { credential_id: id(52), entity_type: 'tenant', entity_id: context.sourceTenant, created_at: context.capturedAt };
  f.credentialVault.associations.push(association);
  expect(() => build(f.request())).not.toThrow();
  association.entity_id = id(999);
  expect(() => build(f.request())).toThrow();
});
