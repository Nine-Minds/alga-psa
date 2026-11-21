import { describe, expect, it } from 'vitest';
import { clientPath } from '../kernel/clientPath';
import { clientResolvers } from '../kernel/clientResolvers';

/**
 * A write on a record of a polymorphic kind is also a write on the parent resource the kind is governed through. The
 * parent is declared on the kind's client path, next to the client, so a kind cannot have one without the other.
 */
describe('client path parent resource', () => {
  it('names the project as the parent of a project task, for every polymorphic family that carries one', () => {
    for (const resolver of ['work_item', 'tagged_entity', 'document_entity']) {
      expect(clientResolvers.parentResource(resolver, 'project_task'), resolver).toBe('project');
    }
  });

  it('names no parent for a kind whose path ends at the record that holds its client', () => {
    for (const kind of ['ticket', 'interaction']) expect(clientResolvers.parentResource('work_item', kind), kind).toBeNull();
    expect(clientResolvers.parentResource('work_item', 'ad_hoc')).toBeNull();
    expect(clientResolvers.parentResource('no_such_resolver', 'project_task')).toBeNull();
  });

  it('reads the parent along the same hops as the client, and stays in the tenant', async () => {
    const calls: Array<{ from: string; where: unknown[]; select: unknown }> = [];
    const builder: any = {
      from(table: string) { calls.push({ from: table, where: [], select: null }); return builder; },
      join() { return builder; },
      where(...args: unknown[]) { calls[calls.length - 1].where.push(args); return builder; },
      first: async (columns: unknown) => { calls[calls.length - 1].select = columns; return { parent_id: 'project-1', client_id: 'client-1' }; },
    };
    const resolver = clientPath({
      table: 'project_tasks', idColumn: 'task_id', clientColumn: 'client_id',
      via: [{ column: 'phase_id', table: 'project_phases', parentColumn: 'phase_id' }, { column: 'project_id', table: 'projects', parentColumn: 'project_id' }],
      parent: { resource: 'project', idColumn: 'project_id' },
    });
    expect(resolver.parentResource).toBe('project');
    await expect(resolver.resolveParent({ queryBuilder: () => builder } as never, 'tenant-1', 'task-1'))
      .resolves.toEqual({ resource: 'project', id: 'project-1', clientId: 'client-1' });
    expect(calls[0].from).toBe('project_tasks as p0');
    expect(calls[0].where).toEqual([['p0.tenant', 'tenant-1'], ['p0.task_id', 'task-1']]);
    expect(calls[0].select).toEqual({ parent_id: 'p2.project_id', client_id: 'p2.client_id' });
  });

  it('has no parent to resolve for a path that declares none', async () => {
    const resolver = clientPath({ table: 'tickets', idColumn: 'ticket_id', clientColumn: 'client_id' });
    expect(resolver.parentResource).toBeNull();
    await expect(resolver.resolveParent({} as never, 'tenant-1', 'ticket-1')).resolves.toBeNull();
  });
});
