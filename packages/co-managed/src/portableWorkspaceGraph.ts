import { createHash } from 'node:crypto';
import { assertPortableTransferActive } from './portableTransfer';
import type { PortableStagedBlob } from './portableBlobStaging';
import type { PortableRecordReference, PortableRecords } from './portableRecordValidation';
import { CoManagedSharedWorkError } from './sharedWorkIdentity';
import { PortableContributorError, type PortableBlobLease, type PortableContributor, type PortableContributorRegistry,
  type PortableExportContext, type PortableRetainContext } from './portableContributorRegistry';

/** Explicit caps. A section larger than this is refused, never truncated. */
export const PORTABLE_GRAPH_LIMITS = Object.freeze({ rowsPerTable: 100_000, blobs: 100_000 });

type Row = Record<string, unknown>;

/** JSON with sorted object keys and no timestamps of its own: the byte form every digest is taken over. */
export function portableCanonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(portableCanonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().filter(key => (value as Row)[key] !== undefined)
    .map(key => `${JSON.stringify(key)}:${portableCanonicalJson((value as Row)[key])}`).join(',')}}`;
}
export const portableDigest = (value: unknown) => createHash('sha256').update(portableCanonicalJson(value)).digest('hex');

/** Tables in name order, rows in canonical-content order, so the same data always digests the same. */
export function normalizePortableRecords(records: PortableRecords): PortableRecords {
  const out: PortableRecords = {};
  for (const table of Object.keys(records).sort()) {
    out[table] = records[table].map(row => JSON.parse(portableCanonicalJson(row)) as Row)
      .map(row => [portableCanonicalJson(row), row] as const).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, row]) => row);
  }
  return out;
}

export interface PortableGraphEdge {
  table: string; column: string; parent: string; parentColumn: string; contributor: string;
  /** `resolved`: the parent table is in the workspace and every value was found. `external`: the parent belongs to a
   * domain no registered contributor provides, so the value is carried as-is for the restore to reconcile. */
  status: 'resolved' | 'external';
}

/** Edges for the whole registry, with each parent column checked against the parent's declared projection. */
export function buildPortableReferenceEdges(registry: PortableContributorRegistry): PortableGraphEdge[] {
  const edges: PortableGraphEdge[] = [];
  for (const contributor of registry.list()) {
    for (const [table, column, parent, parentColumn] of contributor.references) {
      const owner = registry.owner(parent);
      if (owner && !(owner.columns[parent] as readonly string[]).includes(parentColumn)) {
        throw new PortableContributorError(contributor.id, `reference ${table}.${column} targets unknown column ${parent}.${parentColumn}`);
      }
      edges.push({ table, column, parent, parentColumn, contributor: contributor.id, status: owner ? 'resolved' : 'external' });
    }
  }
  return edges.sort((a, b) => portableCanonicalJson(a) < portableCanonicalJson(b) ? -1 : 1);
}

/** Every value of a resolved edge must exist in its parent column (UUIDs compare case-insensitively, like PostgreSQL). */
export function validatePortableEdges(records: PortableRecords, edges: readonly PortableGraphEdge[]) {
  const indexes = new Map<string, Set<string>>();
  const key = (value: unknown) => String(value).toLowerCase();
  for (const edge of edges) {
    if (edge.status !== 'resolved') continue;
    const index = `${edge.parent}.${edge.parentColumn}`;
    if (!indexes.has(index)) indexes.set(index, new Set((records[edge.parent] ?? []).map(row => key(row[edge.parentColumn]))));
    const ids = indexes.get(index)!;
    for (const row of records[edge.table] ?? []) {
      if (row[edge.column] !== null && row[edge.column] !== undefined && !ids.has(key(row[edge.column]))) {
        throw new PortableContributorError(edge.contributor, `${edge.table}.${edge.column} references a missing ${edge.parent}`);
      }
    }
  }
}

export interface PortableCollectedSection {
  id: string; version: number; reason: string; columns: Readonly<Record<string, readonly string[]>>;
  records: PortableRecords; annotations: Record<string, unknown>; sha256: string;
}
export interface PortableBlobEntry extends PortableStagedBlob { contributor: string }
export interface PortableCollectedWorkspace {
  sections: PortableCollectedSection[]; edges: PortableGraphEdge[]; files: PortableBlobEntry[];
  /** Every contributor's lease; dispose after the archive is sealed (or on failure). */
  leases: PortableBlobLease[];
  dispose(): Promise<void>;
}

const isObject = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);

/** The contract, as the engine enforces it on what a contributor actually returned. */
function checkRecords(contributor: PortableContributor, input: unknown): PortableRecords {
  const fail = (message: string): never => { throw new PortableContributorError(contributor.id, message); };
  if (!isObject(input)) return fail('returned no records');
  const tables = Object.keys(contributor.columns);
  if (Object.keys(input).length !== tables.length || tables.some(table => !Object.hasOwn(input, table))) fail('records do not match the declared tables');
  for (const table of tables) {
    const rows = input[table], columns = contributor.columns[table];
    if (!Array.isArray(rows) || rows.length > PORTABLE_GRAPH_LIMITS.rowsPerTable) fail(`invalid or oversized rows for ${table}`);
    for (const row of rows as unknown[]) {
      if (!isObject(row) || Object.keys(row).length !== columns.length || columns.some(column => !Object.hasOwn(row, column))) fail(`rows of ${table} do not match the declared columns`);
    }
  }
  return normalizePortableRecords(input as PortableRecords);
}

function sectionDigest(contributor: PortableContributor, records: PortableRecords) {
  return portableDigest({ id: contributor.id, version: contributor.version, columns: contributor.columns, records });
}

/**
 * Runs every registered contributor's `export` at the shared snapshot, enforces
 * the contract on what came back, then validates each section against the whole
 * workspace and every resolved reference edge. Nothing here names a domain.
 * On any failure all staged blobs are disposed.
 */
export async function collectPortableWorkspace(registry: PortableContributorRegistry, ctx: PortableExportContext): Promise<PortableCollectedWorkspace> {
  const edges = buildPortableReferenceEdges(registry), sections: PortableCollectedSection[] = [], leases: PortableBlobLease[] = [];
  const dispose = async () => {
    const results = await Promise.allSettled(leases.splice(0).map(lease => lease.dispose()));
    if (results.some(result => result.status === 'rejected')) throw new Error('Portable export staging cleanup failed');
  };
  try {
    for (const contributor of registry.list()) {
      assertPortableTransferActive();
      const contribution = await contributor.export(ctx);
      if (contribution?.files) leases.push(contribution.files);
      const records = checkRecords(contributor, contribution?.records);
      sections.push({ id: contributor.id, version: contributor.version, reason: contributor.reason, columns: contributor.columns, records,
        annotations: JSON.parse(portableCanonicalJson(contribution.annotations ?? {})), sha256: sectionDigest(contributor, records) });
    }
    const workspace: PortableRecords = Object.assign({}, ...sections.map(section => section.records));
    for (const contributor of registry.list()) {
      try { contributor.validate(workspace && sections.find(section => section.id === contributor.id)!.records, workspace); }
      catch (error) {
        if (error instanceof CoManagedSharedWorkError || error instanceof PortableContributorError) throw error;
        throw Object.assign(new PortableContributorError(contributor.id, 'validation failed'), { cause: error });
      }
    }
    validatePortableEdges(workspace, edges);
    const files = new Map<string, PortableBlobEntry>();
    for (const [index, lease] of leases.entries()) {
      const owner = registry.list().filter(contributor => sections.some(section => section.id === contributor.id))[index]?.id ?? 'unknown';
      for (const file of lease.files) {
        const id = file.id.toLowerCase(), previous = files.get(id);
        if (previous && (previous.size !== file.size || previous.sha256 !== file.sha256)) throw new PortableContributorError(owner, 'file identity conflicts with another contributor');
        if (!previous) files.set(id, { ...file, contributor: owner });
      }
    }
    if (files.size > PORTABLE_GRAPH_LIMITS.blobs) throw new Error('Portable export has too many files');
    return { sections, edges, files: [...files.values()].sort((a, b) => a.id.localeCompare(b.id)), leases, dispose };
  } catch (error) { await dispose().catch(() => {}); throw error; }
}

/**
 * Final current-source check: every contributor re-reads its rows under the
 * caller's transaction and must digest identically to what was captured.
 */
export async function assertPortableWorkspaceCurrent(registry: PortableContributorRegistry, collected: Pick<PortableCollectedWorkspace, 'sections'>, ctx: PortableRetainContext) {
  for (const contributor of registry.list()) {
    const captured = collected.sections.find(section => section.id === contributor.id);
    const current = await contributor.retain(ctx);
    if (!captured || sectionDigest(contributor, checkRecords(contributor, current?.records)) !== captured.sha256) throw new CoManagedSharedWorkError();
  }
}
