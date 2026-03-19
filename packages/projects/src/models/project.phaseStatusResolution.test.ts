import { describe, expect, it } from 'vitest';

import ProjectModel from './project';

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

class InMemoryQuery<T extends Row> implements PromiseLike<T[]> {
  private readonly predicates: Array<(row: T) => boolean> = [];
  private readonly sorts: Array<{ column: string; direction: 'asc' | 'desc' }> = [];

  constructor(private readonly rows: T[]) {}

  where(column: string | Record<string, any>, value?: any) {
    if (typeof column === 'string') {
      this.predicates.push((row) => row[column] === value);
      return this;
    }

    this.predicates.push((row) =>
      Object.entries(column).every(([key, expected]) => row[key] === expected)
    );
    return this;
  }

  andWhere(column: string | Record<string, any>, value?: any) {
    return this.where(column as any, value);
  }

  whereNull(column: string) {
    this.predicates.push((row) => row[column] == null);
    return this;
  }

  whereIn(column: string, values: any[]) {
    this.predicates.push((row) => values.includes(row[column]));
    return this;
  }

  orderBy(column: string, direction: 'asc' | 'desc' = 'asc') {
    this.sorts.push({ column, direction });
    return this;
  }

  then<TResult1 = T[], TResult2 = never>(
    onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute() {
    const filtered = this.rows.filter((row) => this.predicates.every((predicate) => predicate(row)));

    return filtered.sort((left, right) => {
      for (const sort of this.sorts) {
        if (left[sort.column] === right[sort.column]) {
          continue;
        }

        const comparison = left[sort.column] > right[sort.column] ? 1 : -1;
        return sort.direction === 'desc' ? comparison * -1 : comparison;
      }

      return 0;
    });
  }
}

const createKnex = (tables: Tables) => {
  return ((tableName: string) => {
    return new InMemoryQuery(tables[tableName] ?? []);
  }) as any;
};

describe('ProjectModel per-phase status resolution', () => {
  const tenant = 'tenant-a';
  const projectId = 'project-1';
  const customPhaseId = 'phase-custom';
  const defaultOnlyPhaseId = 'phase-default-only';

  const tables: Tables = {
    project_status_mappings: [
      {
        tenant,
        project_id: projectId,
        project_status_mapping_id: 'default-open',
        phase_id: null,
        status_id: 'status-default-open',
        is_standard: false,
        display_order: 2,
        custom_name: 'Backlog',
        is_visible: true,
      },
      {
        tenant,
        project_id: projectId,
        project_status_mapping_id: 'default-closed',
        phase_id: null,
        status_id: 'status-default-closed',
        is_standard: false,
        display_order: 3,
        custom_name: 'Done',
        is_visible: true,
      },
      {
        tenant,
        project_id: projectId,
        project_status_mapping_id: 'default-standard',
        phase_id: null,
        standard_status_id: 'std-review',
        is_standard: true,
        display_order: 1,
        custom_name: 'Review',
        is_visible: true,
      },
      {
        tenant,
        project_id: projectId,
        project_status_mapping_id: 'phase-open',
        phase_id: customPhaseId,
        status_id: 'status-phase-open',
        is_standard: false,
        display_order: 2,
        custom_name: 'In Design',
        is_visible: true,
      },
      {
        tenant,
        project_id: projectId,
        project_status_mapping_id: 'phase-standard',
        phase_id: customPhaseId,
        standard_status_id: 'std-review',
        is_standard: true,
        display_order: 1,
        custom_name: 'Ready for Review',
        is_visible: true,
      },
      {
        tenant: 'tenant-b',
        project_id: projectId,
        project_status_mapping_id: 'other-tenant-phase',
        phase_id: customPhaseId,
        status_id: 'status-other-tenant',
        is_standard: false,
        display_order: 1,
        custom_name: 'Wrong Tenant',
        is_visible: true,
      },
    ],
    statuses: [
      {
        tenant,
        status_id: 'status-default-open',
        name: 'Backlog',
        is_closed: false,
        status_type: 'project',
      },
      {
        tenant,
        status_id: 'status-default-closed',
        name: 'Done',
        is_closed: true,
        status_type: 'project',
      },
      {
        tenant,
        status_id: 'status-phase-open',
        name: 'In Design',
        is_closed: false,
        status_type: 'project',
      },
      {
        tenant: 'tenant-b',
        status_id: 'status-other-tenant',
        name: 'Leaked Status',
        is_closed: false,
        status_type: 'project',
      },
    ],
    standard_statuses: [
      {
        standard_status_id: 'std-review',
        name: 'Review',
        is_closed: false,
        item_type: 'project',
      },
    ],
  };

  it('T009/T011: returns only phase-specific mappings when a phase has custom statuses', async () => {
    const knex = createKnex(tables);

    const mappings = await ProjectModel.getEffectiveStatusMappings(knex, tenant, projectId, customPhaseId);

    expect(mappings.map((mapping) => mapping.project_status_mapping_id)).toEqual([
      'phase-standard',
      'phase-open',
    ]);
    expect(mappings.every((mapping) => mapping.phase_id === customPhaseId)).toBe(true);
  });

  it('T010/T012: falls back to project defaults for missing, null, and undefined phase scopes', async () => {
    const knex = createKnex(tables);

    const missingPhaseMappings = await ProjectModel.getEffectiveStatusMappings(
      knex,
      tenant,
      projectId,
      defaultOnlyPhaseId
    );
    const nullPhaseMappings = await ProjectModel.getEffectiveStatusMappings(knex, tenant, projectId, null);
    const undefinedPhaseMappings = await ProjectModel.getEffectiveStatusMappings(
      knex,
      tenant,
      projectId
    );

    const expectedDefaultIds = ['default-standard', 'default-open', 'default-closed'];

    expect(missingPhaseMappings.map((mapping) => mapping.project_status_mapping_id)).toEqual(
      expectedDefaultIds
    );
    expect(nullPhaseMappings.map((mapping) => mapping.project_status_mapping_id)).toEqual(
      expectedDefaultIds
    );
    expect(undefinedPhaseMappings.map((mapping) => mapping.project_status_mapping_id)).toEqual(
      expectedDefaultIds
    );
    expect(missingPhaseMappings.every((mapping) => mapping.phase_id == null)).toBe(true);
  });

  it('T013/T014: getProjectTaskStatuses resolves phase-effective statuses without mixing project defaults', async () => {
    const knex = createKnex(tables);

    const statuses = await ProjectModel.getProjectTaskStatuses(knex, tenant, projectId, customPhaseId);

    expect(statuses.map((status) => status.project_status_mapping_id)).toEqual([
      'phase-standard',
      'phase-open',
    ]);
    expect(statuses.map((status) => status.phase_id)).toEqual([customPhaseId, customPhaseId]);
    expect(statuses.map((status) => status.custom_name)).toEqual([
      'Ready for Review',
      'In Design',
    ]);
  });

  it('T060: keeps tenant isolation when resolving mappings and custom statuses', async () => {
    const knex = createKnex(tables);

    const mappings = await ProjectModel.getEffectiveStatusMappings(knex, tenant, projectId, customPhaseId);
    const statuses = await ProjectModel.getProjectTaskStatuses(knex, tenant, projectId, customPhaseId);

    expect(mappings.some((mapping) => mapping.project_status_mapping_id === 'other-tenant-phase')).toBe(
      false
    );
    expect(statuses.some((status) => status.name === 'Leaked Status')).toBe(false);
  });
});
