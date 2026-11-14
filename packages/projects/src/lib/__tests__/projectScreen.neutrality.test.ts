import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Neutrality: the seam adds no I/O of its own. Importing/constructing the native source calls no action,
// and the seam files carry no co-managed code, so a psa tenant issues the same statements as before.
const calls = vi.hoisted(() => ({ n: 0 }));
const trap = vi.hoisted(() => () => new Proxy({}, { get: (_t, key) => (key === 'then' || key === '__esModule' ? undefined : () => { calls.n += 1; }) }));
vi.mock('../../actions/projectActions', trap);
vi.mock('../../actions/projectTaskActions', () => {
  const count = () => { calls.n += 1; return Promise.resolve([]); };
  return { getTaskChecklistItems: count, getTaskResourcesAction: count, getTaskTicketLinksAction: count };
});
vi.mock('../../actions/projectTaskStatusActions', trap);
vi.mock('../../actions/projectTaskCommentActions', trap);

const SEAM_FILES = [join(__dirname, '..', 'projectDataSource.ts'), join(__dirname, '..', 'nativeProjectDataSource.ts'),
  join(__dirname, '..', '..', 'context', 'ProjectDataSourceContext.tsx'), join(__dirname, '..', 'taskEditChanges.ts')];

describe('project screen neutrality (flag off / no entitlement)', () => {
  it('constructing the native source and the default context issues no action call', async () => {
    const { nativeProjectDataSource } = await import('../nativeProjectDataSource');
    await import('../../context/ProjectDataSourceContext');
    expect(calls.n).toBe(0);
    expect(nativeProjectDataSource.kind).toBe('native');
  });

  it('each new read forwarder issues exactly the one action call the screen used to make (0 extra statements)', async () => {
    const { nativeProjectDataSource } = await import('../nativeProjectDataSource');
    const before = calls.n;
    await nativeProjectDataSource.tasks.checklist('t1');
    await nativeProjectDataSource.tasks.resources('t1');
    await nativeProjectDataSource.tasks.ticketLinks('t1');
    // The trap counts every action invocation: one per forwarder call, nothing added by the seam.
    expect(calls.n - before).toBe(3);
  });

  it('the screen reads checklist/resources/ticket links only through the seam', () => {
    const dir = join(__dirname, '..', '..', 'components');
    for (const f of ['ProjectDetail.tsx', 'TaskForm.tsx', 'KanbanBoard.tsx']) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/\b(getTaskChecklistItems|getTaskResourcesAction|getTaskTicketLinksAction|getTaskTypes)\(/);
      expect(src, f).not.toMatch(/import \{[^}]*\b(getTaskChecklistItems|getTaskResourcesAction|getTaskTicketLinksAction|getTaskTypes)\b[^}]*\} from/);
    }
  });

  it('the seam files reference no co-managed capability, table or package', () => {
    for (const file of SEAM_FILES) {
      const src = readFileSync(file, 'utf8');
      expect(src, file).not.toMatch(/from ['"][^'"]*co-managed|co_management|co_managed_|useCapability|requireCapability/);
    }
  });

  it('the native components consult only the seam, never a co-managed module', () => {
    const dir = join(__dirname, '..', '..', 'components');
    for (const f of readdirSync(dir).filter(x => /^(ProjectDetail|ProjectPage|TaskForm|TaskEdit)\.tsx$/.test(x))) {
      expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/@alga-psa\/co-managed|co_management|useCapability\(/);
    }
  });
});
