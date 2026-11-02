import { isCoManagedUuid } from './sharedWorkIdentity';
import type { PortableRecords } from './portableRecordValidation';
import { buildPortableReferenceEdges, normalizePortableRecords, portableDigest, validatePortableEdges,
  type PortableCollectedWorkspace, type PortableGraphEdge } from './portableWorkspaceGraph';
import type { PortableContributorRegistry } from './portableContributorRegistry';

type ObjectValue = Record<string, any>;
export const PORTABLE_MANIFEST_KIND = 'alga-portable-workspace';
export const PORTABLE_MANIFEST_VERSION = 2;

export interface CoManagedPortableWorkspaceContext { packageId: string; sourceTenant: string; capturedAt: string }
export interface CoManagedPortableBlobDescriptor { id: string; size: number; sha256: string }
/** Data deliberately left out of the archive, with the class of reason. A reader never has to guess what is absent. */
export interface PortableExclusion { class: 'msp_private' | 'commercial' | 'secret' | 'deferred_domain' | 'not_provisioned'; name: string; reason: string }
export interface PortableManifestSection {
  id: string; version: number; reason: string; columns: Record<string, string[]>; records: PortableRecords;
  annotations: Record<string, unknown>; sha256: string;
}
export interface CoManagedPortableWorkspaceManifest extends Record<string, unknown> {
  kind: typeof PORTABLE_MANIFEST_KIND; version: typeof PORTABLE_MANIFEST_VERSION; context: CoManagedPortableWorkspaceContext;
  sections: PortableManifestSection[]; references: PortableGraphEdge[]; exclusions: PortableExclusion[];
  /** Absent vault is a recorded exclusion, never an error: records and files do not depend on it. */
  credentialVault: ObjectValue | null; blobs: CoManagedPortableBlobDescriptor[];
}

/** Data the engine never exports, whatever contributors are registered. */
// LEVERAGE: friction manifest-inlines-records — records live inside the 64 MiB-capped manifest; large workspaces need records as framed archive entries.
export const PORTABLE_BASE_EXCLUSIONS: readonly PortableExclusion[] = Object.freeze([
  { class: 'msp_private', name: 'msp_operator_data', reason: 'MSP-private notes, staff identities and internal comments are not customer-owned' },
  { class: 'commercial', name: 'billing_and_contracts', reason: 'Commercial terms and invoicing are not part of the portable workspace' },
  { class: 'secret', name: 'integration_secrets', reason: 'Tokens, API keys and provider secrets are never exported in plaintext' },
]);

const fail: () => never = () => { throw new Error('Invalid portable workspace manifest'); };
const object = (value: unknown): ObjectValue => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail();
  return value as ObjectValue;
};
function keys(value: unknown, names: readonly string[]) {
  const row = object(value);
  if (Object.keys(row).length !== names.length || names.some(name => !Object.hasOwn(row, name))) fail();
  return row;
}
const same = (a: unknown, b: unknown) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const CLASSES = ['msp_private', 'commercial', 'secret', 'deferred_domain', 'not_provisioned'];

function descriptor(input: unknown): CoManagedPortableBlobDescriptor {
  const value = keys(input, ['id', 'size', 'sha256']);
  const [kind, id, extra] = typeof value.id === 'string' ? value.id.split(':') : [];
  if (extra !== undefined || !/^[a-z_]{1,32}$/.test(kind ?? '') || !isCoManagedUuid(id) ||
      !Number.isSafeInteger(value.size) || value.size < 0 || value.size > 64 * 1024 ** 3 || !/^[a-f0-9]{64}$/.test(value.sha256)) fail();
  return { id: value.id, size: value.size, sha256: value.sha256 };
}

/** The sealed credential envelope is validated for shape only; it is opaque ciphertext to the manifest. */
function validateVault(input: unknown, context: CoManagedPortableWorkspaceContext) {
  const data = keys(input, ['vault', 'credentials', 'grants', 'associations']);
  const vault = object(data.vault), kdf = keys(vault.kdf, ['name', 'N', 'r', 'p', 'keyBytes', 'cipher']);
  if (kdf.name !== 'scrypt' || kdf.N !== 131072 || kdf.r !== 8 || kdf.p !== 1 || kdf.keyBytes !== 32 || kdf.cipher !== 'aes-256-gcm') fail();
  if (vault.format !== 'alga-credential-vault:scrypt-aes-256-gcm:v1' || !same(vault.packageId, context.packageId) || !same(vault.sourceTenant, context.sourceTenant)) fail();
  for (const [field, size] of [['salt', 16], ['iv', 12], ['tag', 16], ['ciphertext', null]] as const) {
    if (typeof vault[field] !== 'string' || vault[field].length > 48 * 1024 ** 2) fail();
    const bytes = Buffer.from(vault[field], 'base64');
    if (bytes.toString('base64') !== vault[field] || (size !== null ? bytes.length !== size : !bytes.length || bytes.length > 32 * 1024 ** 2)) fail();
  }
  for (const name of ['credentials', 'grants', 'associations']) if (!Array.isArray(data[name]) || data[name].length > 100_000) fail();
  for (const row of data.credentials) {
    for (const secret of ['password', 'password_ciphertext', 'otp_secret_ciphertext', 'encryption_scheme']) if (Object.hasOwn(object(row), secret)) fail();
  }
}

/**
 * Called after container authentication on import and again before sealing.
 * Digests detect accidental mixing; they are not signatures. When a registry is
 * given, section shape is checked against each contributor's own declaration.
 */
export function validateCoManagedPortableWorkspaceManifest(input: unknown,
  expectedContext?: Pick<CoManagedPortableWorkspaceContext, 'packageId' | 'sourceTenant'>,
  files?: readonly CoManagedPortableBlobDescriptor[], registry?: PortableContributorRegistry): CoManagedPortableWorkspaceManifest {
  const manifest = keys(input, ['kind', 'version', 'context', 'sections', 'references', 'exclusions', 'credentialVault', 'blobs']);
  const context = keys(manifest.context, ['packageId', 'sourceTenant', 'capturedAt']) as CoManagedPortableWorkspaceContext;
  if (manifest.kind !== PORTABLE_MANIFEST_KIND || manifest.version !== PORTABLE_MANIFEST_VERSION || !isCoManagedUuid(context.packageId) ||
      !isCoManagedUuid(context.sourceTenant) || typeof context.capturedAt !== 'string' || !Number.isFinite(Date.parse(context.capturedAt)) ||
      expectedContext && (!same(context.packageId, expectedContext.packageId) || !same(context.sourceTenant, expectedContext.sourceTenant))) fail();
  if (!Array.isArray(manifest.sections) || !Array.isArray(manifest.references) || !Array.isArray(manifest.exclusions) || !Array.isArray(manifest.blobs)) fail();
  const ids = new Set<string>(), workspace: PortableRecords = {};
  for (const raw of manifest.sections) {
    const section = keys(raw, ['id', 'version', 'reason', 'columns', 'records', 'annotations', 'sha256']);
    if (typeof section.id !== 'string' || ids.has(section.id) || !Number.isInteger(section.version) || typeof section.reason !== 'string') fail();
    ids.add(section.id);
    const columns = object(section.columns), records = object(section.records);
    if (Object.keys(records).length !== Object.keys(columns).length) fail();
    for (const table of Object.keys(columns)) {
      if (!Array.isArray(columns[table]) || !Array.isArray(records[table]) || records[table].length > 100_000 || Object.hasOwn(workspace, table)) fail();
      for (const row of records[table]) {
        const value = object(row);
        if (Object.keys(value).length !== columns[table].length || columns[table].some((column: string) => !Object.hasOwn(value, column))) fail();
        // A tenant-bearing column inside a section must always be this workspace's own.
        if (Object.hasOwn(value, 'tenant') && !same(value.tenant, context.sourceTenant)) fail();
      }
      workspace[table] = records[table];
    }
    if (section.sha256 !== portableDigest({ id: section.id, version: section.version, columns, records })) fail();
    const contributor = registry?.list().find(c => c.id === section.id);
    if (registry && (!contributor || contributor.version !== section.version ||
        portableDigest(contributor.columns) !== portableDigest(columns))) fail();
  }
  if (registry && registry.list().some(c => !ids.has(c.id))) fail();
  const edges: PortableGraphEdge[] = manifest.references.map((edge: unknown) => {
    const e = keys(edge, ['table', 'column', 'parent', 'parentColumn', 'contributor', 'status']);
    if (!['resolved', 'external'].includes(e.status) || !ids.has(e.contributor)) fail();
    return e as PortableGraphEdge;
  });
  if (registry && portableDigest(edges) !== portableDigest(buildPortableReferenceEdges(registry))) fail();
  try { validatePortableEdges(workspace, edges); } catch { fail(); }
  for (const edge of edges) if ((edge.status === 'resolved') !== Object.hasOwn(workspace, edge.parent)) fail();
  const exclusions = new Set<string>();
  for (const raw of manifest.exclusions) {
    const row = keys(raw, ['class', 'name', 'reason']);
    if (!CLASSES.includes(row.class) || typeof row.name !== 'string' || typeof row.reason !== 'string' || exclusions.has(row.name)) fail();
    exclusions.add(row.name);
  }
  const declared = new Map<string, CoManagedPortableBlobDescriptor>();
  for (const row of manifest.blobs) {
    const blob = descriptor(row), key = blob.id.toLowerCase();
    if (declared.has(key)) fail(); declared.set(key, blob);
  }
  if (files) {
    const actual = new Map<string, CoManagedPortableBlobDescriptor>();
    for (const file of files) {
      const blob = descriptor({ id: file.id, size: file.size, sha256: file.sha256 }), key = blob.id.toLowerCase();
      if (actual.has(key)) fail(); actual.set(key, blob);
    }
    if (actual.size !== declared.size) fail();
    for (const [key, blob] of declared) { const other = actual.get(key); if (!other || other.size !== blob.size || other.sha256 !== blob.sha256) fail(); }
  }
  if (manifest.credentialVault !== null) validateVault(manifest.credentialVault, context);
  else if (!exclusions.has('credential_vault')) fail();
  return manifest as CoManagedPortableWorkspaceManifest;
}

export function buildCoManagedPortableWorkspaceManifest(input: {
  context: CoManagedPortableWorkspaceContext; collected: Pick<PortableCollectedWorkspace, 'sections' | 'edges' | 'files'> & Partial<Pick<PortableCollectedWorkspace, 'exclusions'>>;
  credentialVault?: ObjectValue | null; vaultExclusion?: string; registry?: PortableContributorRegistry;
}) {
  const { collected, context } = input;
  const exclusions: PortableExclusion[] = [...PORTABLE_BASE_EXCLUSIONS, ...(collected.exclusions ?? [])];
  if (!input.credentialVault) exclusions.push({ class: 'secret', name: 'credential_vault',
    reason: input.vaultExclusion ?? 'The credential vault is optional and was not included in this archive' });
  exclusions.sort((a, b) => a.name.localeCompare(b.name));
  const sections = collected.sections.map(section => ({ id: section.id, version: section.version, reason: section.reason,
    columns: JSON.parse(JSON.stringify(section.columns)) as Record<string, string[]>, records: normalizePortableRecords(section.records),
    annotations: section.annotations, sha256: section.sha256 })).sort((a, b) => a.id.localeCompare(b.id));
  const blobs = collected.files.map(({ id, size, sha256 }) => ({ id, size, sha256 }));
  return validateCoManagedPortableWorkspaceManifest({ kind: PORTABLE_MANIFEST_KIND, version: PORTABLE_MANIFEST_VERSION, context, sections,
    references: collected.edges, exclusions, credentialVault: input.credentialVault ?? null, blobs }, context, collected.files, input.registry);
}
