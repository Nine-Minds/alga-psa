import { describe, expect, it } from 'vitest';

import ProjectModel from './project';

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

const columnKey = (column: string): string => {
  const dotIndex = column.lastIndexOf('.');
  return dotIndex === -1 ? column : column.slice(dotIndex + 1);
};

class FakeQuery implements PromiseLike<any> {
  private readonly predicates: Array<(row: Row) => boolean> = [];
  private readonly sorts: Array<{ column: string; direction: 'asc' | 'desc' }> = [];
  private op: 'select' | 'insert' | 'update' = 'select';
  private insertRows: Row[] = [];
  private updateData: Partial<Row> | null = null;
  private opIndex = 0;

  constructor(private readonly tableName: string, private readonly tables: Tables) {}

  where(column: string | Record<string, any>, value?: any) {
    if (typeof column === 'string') {
      const key = columnKey(column);
      this.predicates.push((row) => row[key] === value);
      return this;
    }
    this.predicates.push((row) =>
      Object.entries(column).every(([key, expected]) => row[columnKey(key)] === expected)
    );
    return this;
  }

  andWhere(column: string | Record<string, any>, value?: any) {
    return this.where(column as any, value);
  }

  whereNull(column: string) {
    const key = columnKey(column);
    this.predicates.push((row) => row[key] == null);
    return this;
  }

  whereIn(column: string, values: any[]) {
    const key = columnKey(column);
    this.predicates.push((row) => values.includes(row[key]));
    return this;
  }

  whereNot(column: string | Record<string, any>, value?: any) {
    if (typeof column === 'string') {
      const key = columnKey(column);
      this.predicates.push((row) => row[key] !== value);
      return this;
    }
    this.predicates.push((row) =>
      Object.entries(column).every(([key, expected]) => row[columnKey(key)] !== expected)
    );
    return this;
  }

  orderBy(column: string, direction: 'asc' | 'desc' = 'asc') {
    this.sorts.push({ column: columnKey(column), direction });
    return this;
  }

  insert(rows: Row[] | Row) {
    this.op = 'insert';
    this.insertRows = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  returning() {
    return this;
  }

  update(data: Partial<Row>) {
    this.op = 'update';
    this.updateData = data;
    return this;
  }

  first() {
    return Promise.resolve(this.executeSelect()[0] ?? null);
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private matches(row: Row): boolean {
    return this.predicates.every((predicate) => predicate(row));
  }

  private executeSelect(): Row[] {
    return this.tables[this.tableName]
      .filter((row) => this.matches(row))
      .sort((left, right) => {
        for (const sort of this.sorts) {
          if (left[sort.column] === right[sort.column]) continue;
          const comparison = left[sort.column] > right[sort.column] ? 1 : -1;
          return sort.direction === 'desc' ? comparison * -1 : comparison;
        }
        return 0;
      });
  }

  private execute(): any {
    if (this.op === 'insert') {
      const created = this.insertRows.map((data) => {
        const row = { ...data } as Row;
        if (row.project_status_mapping_id == null) {
          row.project_status_mapping_id = `mapping-${this.opIndex++}`;
        }
        if (row.phase_id == null && data.phase_id === undefined) {
          // clone rows carry explicit phase_id in data; nothing to do
        }
        this.tables[this.tableName].push(row);
        return row;
      });
      return created;
    }

    if (this.op === 'update') {
      let count = 0;
      for (const row of this.tables[this.tableName]) {
        if (this.matches(row)) {
          Object.assign(row, this.updateData);
          count += 1;
        }
      }
      return count;
    }

    return this.executeSelect();
  }
}

const createKnex = (tables: Tables) => {
  return ((tableName: string) => new FakeQuery(tableName, tables)) as any;
};

const standard = (id: string, stdId: string, opts: Partial<Row> = {}): Row => ({
  tenant: 'tenant-a',
  project_id: 'project-1',
  project_status_mapping_id: id,
  phase_id: null,
  standard_status_id: stdId,
  status_id: null,
  is_standard: true,
  custom_name: null,
  display_order: 0,
  is_visible: true,
  ...opts,
});

const custom = (id: string, statusId: string, name: string, order: number): Row => ({
  tenant: 'tenant-a',
  project_id: 'project-1',
  project_status_mapping_id: id,
  phase_id: null,
  standard_status_id: null,
  status_id: statusId,
  is_standard: false,
  custom_name: name,
  display_order: order,
  is_visible: true,
});

describe('ProjectModel phase-scope status mapping invariant', () => {
  const tenant = 'tenant-a';
  const projectId = 'project-1';
  const phaseId = 'phase-a';

  const phaseRow = (id: string, project: string): Row => ({
    tenant,
    phase_id: id,
    project_id: project,
  });

  it('remaps phase tasks to cloned defaults via stable semantic identity without collapsing standards', async () => {
    const tables: Tables = {
      project_phases: [phaseRow(phaseId, projectId)],
      project_status_mappings: [
        standard('std-open', 'std-1', { display_order: 1, custom_name: 'Open' }),
        standard('std-done', 'std-2', { display_order: 2, custom_name: 'Done' }),
        custom('cust-review', 'status-1', 'Review', 3),
      ],
      project_tasks: [
        { tenant, task_id: 't1', phase_id: phaseId, project_status_mapping_id: 'std-open' },
        { tenant, task_id: 't2', phase_id: phaseId, project_status_mapping_id: 'std-done' },
        { tenant, task_id: 't3', phase_id: phaseId, project_status_mapping_id: 'cust-review' },
      ],
    };
    const knex = createKnex(tables);

    const created = await ProjectModel.copyProjectStatusMappingsToPhase(knex, tenant, projectId, phaseId);

    // Three clones for three defaults, all phase-scoped.
    expect(created).toHaveLength(3);
    expect(created.every((m) => m.phase_id === phaseId)).toBe(true);

    const phaseMappings = created.map((m) => m.project_status_mapping_id);
    const stdOpenClone = created.find((m) => m.standard_status_id === 'std-1');
    const stdDoneClone = created.find((m) => m.standard_status_id === 'std-2');
    const reviewClone = created.find((m) => m.status_id === 'status-1');

    // Distinct clones (not collapsed onto the first like status_id NULL matching would).
    expect(new Set(phaseMappings).size).toBe(3);

    // Tasks remapped: t1 -> std-open clone, t2 -> std-done clone, t3 -> review clone.
    const remapped = new Map(tables.project_tasks.map((t) => [t.task_id, t.project_status_mapping_id]));
    expect(remapped.get('t1')).toBe(stdOpenClone?.project_status_mapping_id);
    expect(remapped.get('t2')).toBe(stdDoneClone?.project_status_mapping_id);
    expect(remapped.get('t3')).toBe(reviewClone?.project_status_mapping_id);
  });

  it('preserves duplicate-label custom statuses by their underlying status identity', async () => {
    const tables: Tables = {
      project_phases: [phaseRow(phaseId, projectId)],
      project_status_mappings: [
        custom('cust-a', 'status-a', 'Blocked', 1),
        custom('cust-b', 'status-b', 'Blocked', 2),
      ],
      project_tasks: [
        { tenant, task_id: 't1', phase_id: phaseId, project_status_mapping_id: 'cust-a' },
        { tenant, task_id: 't2', phase_id: phaseId, project_status_mapping_id: 'cust-b' },
      ],
    };
    const knex = createKnex(tables);

    const created = await ProjectModel.copyProjectStatusMappingsToPhase(knex, tenant, projectId, phaseId);

    const cloneA = created.find((m) => m.status_id === 'status-a');
    const cloneB = created.find((m) => m.status_id === 'status-b');
    expect(cloneA?.project_status_mapping_id).not.toBe(cloneB?.project_status_mapping_id);

    const remapped = new Map(tables.project_tasks.map((t) => [t.task_id, t.project_status_mapping_id]));
    expect(remapped.get('t1')).toBe(cloneA?.project_status_mapping_id);
    expect(remapped.get('t2')).toBe(cloneB?.project_status_mapping_id);
  });

  it('is idempotent when the phase already has scoped mappings', async () => {
    const tables: Tables = {
      project_phases: [phaseRow(phaseId, projectId)],
      project_status_mappings: [
        standard('std-open', 'std-1', { display_order: 1 }),
        { ...standard('phase-existing', 'std-x', { display_order: 2 }), phase_id: phaseId },
      ],
      project_tasks: [],
    };
    const knex = createKnex(tables);

    const result = await ProjectModel.copyProjectStatusMappingsToPhase(knex, tenant, projectId, phaseId);
    expect(result).toHaveLength(1);
    expect(result[0].project_status_mapping_id).toBe('phase-existing');
  });

  it('rejects a foreign-project phase before any mapping insert or task remap', async () => {
    const projectB = 'project-2';
    const phaseInB = 'phase-b1';
    const tables: Tables = {
      project_phases: [
        phaseRow(phaseId, projectId),
        phaseRow(phaseInB, projectB),
      ],
      project_status_mappings: [
        // Project A has defaults that would otherwise be cloned.
        standard('std-open', 'std-1', { display_order: 1 }),
        // Project B's own default mapping, used by the phase's task.
        standard('b-open', 'std-1', { project_id: projectB, display_order: 1 }),
      ],
      project_tasks: [
        { tenant, task_id: 'tb1', phase_id: phaseInB, project_status_mapping_id: 'b-open' },
      ],
    };
    const knex = createKnex(tables);

    // Project A asked to copy its mappings into a phase that belongs to project B.
    await expect(
      ProjectModel.copyProjectStatusMappingsToPhase(knex, tenant, projectId, phaseInB)
    ).rejects.toThrow('Project phase does not belong to this project');

    // Zero writes: no mapping rows were created for the foreign phase...
    expect(tables.project_status_mappings.filter((m) => m.phase_id === phaseInB)).toHaveLength(0);
    expect(tables.project_status_mappings).toHaveLength(2);
    // ...and no task was remapped.
    expect(tables.project_tasks).toEqual([
      { tenant, task_id: 'tb1', phase_id: phaseInB, project_status_mapping_id: 'b-open' },
    ]);
  });

  it('rejects an unknown phase before any mapping insert or task remap', async () => {
    const tables: Tables = {
      project_phases: [phaseRow(phaseId, projectId)],
      project_status_mappings: [standard('std-open', 'std-1', { display_order: 1 })],
      project_tasks: [],
    };
    const knex = createKnex(tables);

    await expect(
      ProjectModel.copyProjectStatusMappingsToPhase(knex, tenant, projectId, 'phase-missing')
    ).rejects.toThrow('Project phase not found');
    expect(tables.project_status_mappings).toHaveLength(1);
  });

  it('resolveTaskStatusMapping remaps a stale default-scope mapping to its phase clone', async () => {
    const tables: Tables = {
      project_status_mappings: [
        standard('std-open', 'std-1', { display_order: 1 }),
        { ...standard('phase-open', 'std-1', { display_order: 1 }), phase_id: phaseId },
      ],
      project_tasks: [
        { tenant, task_id: 't1', phase_id: phaseId, project_status_mapping_id: 'std-open' },
      ],
    };
    const knex = createKnex(tables);

    const resolved = await ProjectModel.resolveTaskStatusMapping(
      knex, tenant, projectId, phaseId, 'std-open', { allowRemap: true }
    );
    expect(resolved.project_status_mapping_id).toBe('phase-open');
  });

  it('resolveTaskStatusMapping falls back to the first effective mapping when allowRemap', async () => {
    const tables: Tables = {
      project_status_mappings: [
        custom('no-match', 'status-x', 'Nowhere', 1),
        { ...standard('phase-open', 'std-1', { display_order: 1 }), phase_id: phaseId },
      ],
      project_tasks: [],
    };
    const knex = createKnex(tables);

    const resolved = await ProjectModel.resolveTaskStatusMapping(
      knex, tenant, projectId, phaseId, 'no-match', { allowRemap: true }
    );
    expect(resolved.project_status_mapping_id).toBe('phase-open');
  });

  it('resolveTaskStatusMapping rejects a cross-scope mapping when strict (allowRemap=false)', async () => {
    const tables: Tables = {
      project_status_mappings: [
        custom('default-only', 'status-x', 'Default Only', 1),
        { ...standard('phase-open', 'std-1', { display_order: 1 }), phase_id: phaseId },
      ],
      project_tasks: [],
    };
    const knex = createKnex(tables);

    await expect(
      ProjectModel.resolveTaskStatusMapping(knex, tenant, projectId, phaseId, 'default-only', { allowRemap: false })
    ).rejects.toThrow('Project task status is not valid for this phase');
  });

  it('isTaskStatusMappingInScope is true only for the phase effective scope', async () => {
    const tables: Tables = {
      project_status_mappings: [
        custom('default-only', 'status-x', 'Default Only', 1),
        { ...standard('phase-open', 'std-1', { display_order: 1 }), phase_id: phaseId },
      ],
      project_tasks: [],
    };
    const knex = createKnex(tables);

    await expect(ProjectModel.isTaskStatusMappingInScope(knex, tenant, projectId, phaseId, 'phase-open')).resolves.toBe(true);
    await expect(ProjectModel.isTaskStatusMappingInScope(knex, tenant, projectId, phaseId, 'default-only')).resolves.toBe(false);
  });
});