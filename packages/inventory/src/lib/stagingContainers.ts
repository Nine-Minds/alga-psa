import { Knex } from 'knex';
import type { IProjectStagingLine, IStagingContainer, IStagingContainerMember } from '@alga-psa/types';
import { assertTaskInProject, normalizeStagingLine, StagingError, stageLineInTransaction } from './staging';

/**
 * Staging containers (C6 D10): a box / tote on a project, optionally on a task, holding staging lines.
 *
 * - One member shape for units, quantities and client items (they are all staging lines).
 * - A serialized or client-asset line lives in at most one box; a quantity line may be split across
 *   boxes, the members never summing past the line quantity (enforced under a lock on the line row).
 * - Packing a `reserved` stock line or a `received` client line stages it in the same transaction:
 *   it has now been physically picked.
 * - open <-> sealed. Sealed blocks membership changes; reopening is allowed. Only an empty box can be
 *   deleted (soft: its number is never reused).
 * - Numbering: `sequence` per project, max+1; identifier `<project_number>-B<nn>`; "n of m" is computed
 *   when read (rank among the project's live boxes), so a printed label is a snapshot.
 *
 * Writes nothing outside the staging tables (packing may stage a line, which moves its own claim).
 */

function runInTransaction<T>(db: Knex, fn: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
  const maybe = db as unknown as { commit?: unknown; rollback?: unknown };
  if (typeof maybe.commit === 'function' && typeof maybe.rollback === 'function') {
    return fn(db as unknown as Knex.Transaction);
  }
  return db.transaction(fn);
}

/** `<project_number>-B<sequence padded to 2>`, e.g. PRJ-0042-B03. Also the box's Code 128 value. */
export function stagingContainerIdentifier(projectNumber: string, sequence: number): string {
  return `${projectNumber}-B${String(sequence).padStart(2, '0')}`;
}

export interface StagingContainerInput {
  project_id: string;
  task_id?: string | null;
  name?: string | null;
  stock_location_id?: string | null;
  location_note?: string | null;
  notes?: string | null;
}

const TEXT_LIMIT = 500;

function cleanText(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new StagingError(`${field} must be text`, 'invalid_input');
  const trimmed = value.trim();
  if (trimmed.length > TEXT_LIMIT) throw new StagingError(`${field} is too long`, 'invalid_input');
  return trimmed.length ? trimmed : null;
}

async function assertLocation(trx: Knex.Transaction, tenant: string, locationId: string | null | undefined): Promise<void> {
  if (!locationId) return;
  const loc = await trx('stock_locations').where({ tenant, location_id: locationId }).first('location_id');
  if (!loc) throw new StagingError('Stock location not found', 'invalid_input');
}

async function lockContainer(trx: Knex.Transaction, tenant: string, containerId: string): Promise<IStagingContainer> {
  const c = await trx('staging_containers').where({ tenant, container_id: containerId }).whereNull('deleted_at').forUpdate().first();
  if (!c) throw new StagingError('Box not found', 'not_found');
  return c as IStagingContainer;
}

function assertOpen(container: IStagingContainer): void {
  if (container.status === 'sealed') throw new StagingError('This box is sealed. Reopen it to change its contents.', 'invalid_state');
}

export async function createContainer(
  db: Knex,
  tenant: string,
  input: StagingContainerInput,
  performedBy: string | null,
): Promise<IStagingContainer> {
  return runInTransaction(db, async (trx) => {
    // The project row is the numbering mutex: concurrent creates serialize here.
    const project = await trx('projects').where({ tenant, project_id: input.project_id }).forUpdate().first('project_id');
    if (!project) throw new StagingError('Project not found', 'not_found');
    await assertTaskInProject(trx, tenant, input.project_id, input.task_id);
    await assertLocation(trx, tenant, input.stock_location_id);
    // Deleted boxes count: a number is never reused.
    const max = await trx('staging_containers').where({ tenant, project_id: input.project_id }).max({ m: 'sequence' }).first();
    const sequence = Number(max?.m ?? 0) + 1;
    const [row] = await trx('staging_containers')
      .insert({
        tenant,
        project_id: input.project_id,
        task_id: input.task_id ?? null,
        sequence,
        name: cleanText(input.name, 'name'),
        status: 'open',
        stock_location_id: input.stock_location_id ?? null,
        location_note: cleanText(input.location_note, 'location_note'),
        notes: cleanText(input.notes, 'notes'),
        created_by: performedBy,
      })
      .returning('*');
    return row as IStagingContainer;
  });
}

/** Edit a box's name, task, location or notes. Allowed while sealed: none of these change its contents. */
export async function updateContainer(
  db: Knex,
  tenant: string,
  containerId: string,
  patch: Partial<Omit<StagingContainerInput, 'project_id'>>,
): Promise<IStagingContainer> {
  return runInTransaction(db, async (trx) => {
    const container = await lockContainer(trx, tenant, containerId);
    const update: Record<string, unknown> = { updated_at: trx.fn.now() };
    if ('name' in patch) update.name = cleanText(patch.name, 'name');
    if ('task_id' in patch) {
      await assertTaskInProject(trx, tenant, container.project_id, patch.task_id);
      update.task_id = patch.task_id ?? null;
    }
    if ('stock_location_id' in patch) {
      await assertLocation(trx, tenant, patch.stock_location_id);
      update.stock_location_id = patch.stock_location_id ?? null;
    }
    if ('location_note' in patch) update.location_note = cleanText(patch.location_note, 'location_note');
    if ('notes' in patch) update.notes = cleanText(patch.notes, 'notes');
    const [row] = await trx('staging_containers').where({ tenant, container_id: containerId }).update(update).returning('*');
    return row as IStagingContainer;
  });
}

export async function deleteContainer(db: Knex, tenant: string, containerId: string, performedBy: string | null): Promise<void> {
  await runInTransaction(db, async (trx) => {
    await lockContainer(trx, tenant, containerId);
    const member = await trx('staging_container_members').where({ tenant, container_id: containerId }).first('member_id');
    if (member) throw new StagingError('Only an empty box can be deleted', 'invalid_state');
    await trx('staging_containers')
      .where({ tenant, container_id: containerId })
      .update({ deleted_at: trx.fn.now(), deleted_by: performedBy, updated_at: trx.fn.now() });
  });
}

export async function sealContainer(db: Knex, tenant: string, containerId: string, performedBy: string | null): Promise<IStagingContainer> {
  return runInTransaction(db, async (trx) => {
    const container = await lockContainer(trx, tenant, containerId);
    if (container.status === 'sealed') return container;
    const [row] = await trx('staging_containers')
      .where({ tenant, container_id: containerId })
      .update({ status: 'sealed', sealed_at: trx.fn.now(), sealed_by: performedBy, updated_at: trx.fn.now() })
      .returning('*');
    return row as IStagingContainer;
  });
}

export async function reopenContainer(db: Knex, tenant: string, containerId: string): Promise<IStagingContainer> {
  return runInTransaction(db, async (trx) => {
    const container = await lockContainer(trx, tenant, containerId);
    if (container.status === 'open') return container;
    const [row] = await trx('staging_containers')
      .where({ tenant, container_id: containerId })
      .update({ status: 'open', sealed_at: null, sealed_by: null, updated_at: trx.fn.now() })
      .returning('*');
    return row as IStagingContainer;
  });
}

export interface PackItem {
  staging_line_id: string;
  /** Quantity lines only; defaults to everything not yet packed. Units and client assets are always 1. */
  quantity?: number | null;
}

/** Lines that are a single physical thing: they live in at most one box. */
function isSingleton(line: IProjectStagingLine): boolean {
  return Boolean(line.unit_id) || line.kind === 'client_asset';
}

/**
 * Pack staging lines into an open box. Each line is locked; packing a reserved stock line or a
 * received client line stages it. Installed or released lines cannot be packed.
 */
export async function packLines(
  db: Knex,
  tenant: string,
  containerId: string,
  items: readonly PackItem[],
  performedBy: string | null,
): Promise<IStagingContainerMember[]> {
  if (!Array.isArray(items) || items.length === 0) throw new StagingError('Choose something to pack', 'invalid_input');
  return runInTransaction(db, async (trx) => {
    const container = await lockContainer(trx, tenant, containerId);
    assertOpen(container);
    const result: IStagingContainerMember[] = [];
    for (const item of items) {
      const raw = await trx('project_staging_lines').where({ tenant, staging_line_id: item.staging_line_id }).forUpdate().first();
      if (!raw || raw.project_id !== container.project_id) throw new StagingError('Staging line not found', 'not_found');
      let line = normalizeStagingLine(raw) as IProjectStagingLine;
      if (line.status === 'installed' || line.status === 'released') {
        throw new StagingError(`A ${line.status} line cannot be packed`, 'invalid_state');
      }

      const members = (await trx('staging_container_members')
        .where({ tenant, staging_line_id: line.staging_line_id })
        .select('member_id', 'container_id', 'quantity')) as Array<{ member_id: string; container_id: string; quantity: number }>;
      const here = members.find((m) => m.container_id === containerId) ?? null;
      const packedElsewhere = members.filter((m) => m.container_id !== containerId).reduce((sum, m) => sum + Number(m.quantity), 0);
      const packedHere = here ? Number(here.quantity) : 0;

      let add: number;
      if (isSingleton(line)) {
        if (packedElsewhere > 0) throw new StagingError('This item is already packed in another box', 'already_staged_elsewhere');
        if (here) {
          result.push(here as unknown as IStagingContainerMember);
          continue;
        }
        add = 1;
      } else {
        const remaining = line.quantity - packedElsewhere - packedHere;
        add = item.quantity == null ? remaining : Math.floor(Number(item.quantity));
        if (!Number.isFinite(add) || add < 1) {
          throw new StagingError(remaining > 0 ? 'quantity must be greater than 0' : 'Everything on this line is already packed', 'invalid_input');
        }
        if (add > remaining) {
          throw new StagingError(`Only ${Math.max(0, remaining)} of this line ${remaining === 1 ? 'is' : 'are'} left to pack`, 'packed_exceeds_quantity');
        }
      }

      if (line.status === 'reserved' || line.status === 'received') {
        line = await stageLineInTransaction(trx, tenant, line, performedBy);
      }

      if (here) {
        const [updated] = await trx('staging_container_members')
          .where({ tenant, member_id: here.member_id })
          .update({ quantity: packedHere + add, updated_at: trx.fn.now() })
          .returning('*');
        result.push(updated as IStagingContainerMember);
      } else {
        const [inserted] = await trx('staging_container_members')
          .insert({ tenant, container_id: containerId, staging_line_id: line.staging_line_id, quantity: add, added_by: performedBy, created_at: new Date().toISOString() })
          .returning('*');
        result.push(inserted as IStagingContainerMember);
      }
    }
    await trx('staging_containers').where({ tenant, container_id: containerId }).update({ updated_at: trx.fn.now() });
    return result;
  });
}

/** Take a line (or part of a quantity line) out of an open box. The line stays staged. */
export async function unpackLine(
  db: Knex,
  tenant: string,
  containerId: string,
  stagingLineId: string,
  quantity?: number | null,
): Promise<void> {
  await runInTransaction(db, async (trx) => {
    const container = await lockContainer(trx, tenant, containerId);
    assertOpen(container);
    const member = await trx('staging_container_members')
      .where({ tenant, container_id: containerId, staging_line_id: stagingLineId })
      .forUpdate()
      .first();
    if (!member) throw new StagingError('That item is not in this box', 'not_found');
    const current = Number(member.quantity);
    const take = quantity == null ? current : Math.floor(Number(quantity));
    if (!Number.isFinite(take) || take < 1 || take > current) throw new StagingError(`Choose between 1 and ${current}`, 'invalid_input');
    if (take === current) {
      await trx('staging_container_members').where({ tenant, member_id: member.member_id }).delete();
    } else {
      await trx('staging_container_members')
        .where({ tenant, member_id: member.member_id })
        .update({ quantity: current - take, updated_at: trx.fn.now() });
    }
    await trx('staging_containers').where({ tenant, container_id: containerId }).update({ updated_at: trx.fn.now() });
  });
}

// ---------------------------------------------------------------------------------------------
// Read (labels, manifests, the staging page). Read-only.

export interface StagingContainerMemberView {
  member_id: string;
  staging_line_id: string;
  quantity: number;
  kind: IProjectStagingLine['kind'];
  line_status: IProjectStagingLine['status'];
  line_quantity: number;
  service_id: string | null;
  service_name: string | null;
  sku: string | null;
  unit_id: string | null;
  serial_number: string | null;
  asset_id: string | null;
  asset_tag: string | null;
  asset_name: string | null;
  asset_serial_number: string | null;
  description: string | null;
  task_id: string | null;
  task_name: string | null;
}

export interface StagingContainerView extends IStagingContainer {
  identifier: string;
  /** Rank by sequence among the project's live boxes (1-based) and their count. */
  position: { n: number; total: number };
  project_number: string;
  project_name: string;
  client_id: string;
  client_name: string | null;
  task_name: string | null;
  stock_location_name: string | null;
  sealed_by_name: string | null;
  members: StagingContainerMemberView[];
}

async function loadMembers(db: Knex | Knex.Transaction, tenant: string, containerIds: string[]): Promise<Map<string, StagingContainerMemberView[]>> {
  const map = new Map<string, StagingContainerMemberView[]>();
  if (containerIds.length === 0) return map;
  const rows = (await db('staging_container_members as m')
    .join('project_staging_lines as l', function () {
      this.on('l.staging_line_id', '=', 'm.staging_line_id').andOn('l.tenant', '=', 'm.tenant');
    })
    .leftJoin('service_catalog as sc', function () {
      this.on('sc.service_id', '=', 'l.service_id').andOn('sc.tenant', '=', 'l.tenant');
    })
    .leftJoin('stock_units as u', function () {
      this.on('u.unit_id', '=', 'l.unit_id').andOn('u.tenant', '=', 'l.tenant');
    })
    .leftJoin('assets as a', function () {
      this.on('a.asset_id', '=', 'l.asset_id').andOn('a.tenant', '=', 'l.tenant');
    })
    .leftJoin('project_tasks as t', function () {
      this.on('t.task_id', '=', 'l.task_id').andOn('t.tenant', '=', 'l.tenant');
    })
    .where('m.tenant', tenant)
    .whereIn('m.container_id', containerIds)
    .select(
      'm.member_id',
      'm.container_id',
      'm.staging_line_id',
      'm.quantity',
      'l.kind',
      'l.status as line_status',
      'l.quantity as line_quantity',
      'l.service_id',
      'sc.service_name',
      'sc.sku',
      'l.unit_id',
      'u.serial_number',
      'l.asset_id',
      'a.asset_tag',
      'a.name as asset_name',
      'a.serial_number as asset_serial_number',
      'l.description',
      'l.task_id',
      't.task_name',
    )
    // Packing order, then a stable order for members packed in the same instant.
    .orderBy('m.created_at', 'asc')
    .orderBy('l.created_at', 'asc')
    .orderBy('sc.service_name', 'asc')
    .orderBy('u.serial_number', 'asc')
    .orderBy('m.member_id', 'asc')) as any[];
  for (const r of rows) {
    const list = map.get(r.container_id) ?? [];
    const { container_id: _c, ...rest } = r;
    list.push({ ...rest, quantity: Number(r.quantity), line_quantity: Number(r.line_quantity) });
    map.set(r.container_id, list);
  }
  return map;
}

function containerQuery(db: Knex | Knex.Transaction, tenant: string) {
  return db('staging_containers as c')
    .join('projects as p', function () {
      this.on('p.project_id', '=', 'c.project_id').andOn('p.tenant', '=', 'c.tenant');
    })
    .leftJoin('clients as cl', function () {
      this.on('cl.client_id', '=', 'p.client_id').andOn('cl.tenant', '=', 'p.tenant');
    })
    .leftJoin('project_tasks as t', function () {
      this.on('t.task_id', '=', 'c.task_id').andOn('t.tenant', '=', 'c.tenant');
    })
    .leftJoin('stock_locations as loc', function () {
      this.on('loc.location_id', '=', 'c.stock_location_id').andOn('loc.tenant', '=', 'c.tenant');
    })
    .leftJoin('users as su', function () {
      this.on('su.user_id', '=', 'c.sealed_by').andOn('su.tenant', '=', 'c.tenant');
    })
    .where('c.tenant', tenant)
    .whereNull('c.deleted_at')
    .select(
      'c.*',
      'p.project_number',
      'p.project_name',
      'p.client_id',
      'cl.client_name',
      't.task_name',
      'loc.name as stock_location_name',
      db.raw("NULLIF(TRIM(CONCAT_WS(' ', su.first_name, su.last_name)), '') as sealed_by_name"),
      db.raw(
        `(SELECT COUNT(*) FROM staging_containers c2
          WHERE c2.tenant = c.tenant AND c2.project_id = c.project_id AND c2.deleted_at IS NULL AND c2.sequence <= c.sequence) AS position_n`,
      ),
      db.raw(
        `(SELECT COUNT(*) FROM staging_containers c3
          WHERE c3.tenant = c.tenant AND c3.project_id = c.project_id AND c3.deleted_at IS NULL) AS position_total`,
      ),
    );
}

function toView(row: any, members: StagingContainerMemberView[]): StagingContainerView {
  const { position_n, position_total, ...rest } = row;
  return {
    ...rest,
    identifier: stagingContainerIdentifier(row.project_number, Number(row.sequence)),
    position: { n: Number(position_n), total: Number(position_total) },
    members,
  } as StagingContainerView;
}

/** A project's live boxes in sequence order, with "n of m" and contents. */
export async function listContainers(db: Knex | Knex.Transaction, tenant: string, projectId: string): Promise<StagingContainerView[]> {
  const rows = (await containerQuery(db, tenant).where('c.project_id', projectId).orderBy('c.sequence', 'asc')) as any[];
  const members = await loadMembers(db, tenant, rows.map((r) => r.container_id));
  return rows.map((r) => toView(r, members.get(r.container_id) ?? []));
}

/** Boxes by id (any project in the tenant), in the order asked; null for a missing or deleted box. */
export async function getContainers(
  db: Knex | Knex.Transaction,
  tenant: string,
  containerIds: readonly string[],
): Promise<Array<StagingContainerView | null>> {
  if (containerIds.length === 0) return [];
  const rows = (await containerQuery(db, tenant).whereIn('c.container_id', containerIds as string[])) as any[];
  const members = await loadMembers(db, tenant, rows.map((r) => r.container_id));
  const byId = new Map(rows.map((r) => [r.container_id, r]));
  return containerIds.map((id) => {
    const row = byId.get(id);
    return row ? toView(row, members.get(id) ?? []) : null;
  });
}
