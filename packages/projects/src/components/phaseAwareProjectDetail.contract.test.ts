import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const readComponent = (fileName: string) =>
  readFileSync(path.resolve(__dirname, fileName), 'utf8');

describe('phase-aware MSP project UI contracts', () => {
  const projectDetailSource = readComponent('ProjectDetail.tsx');
  const kanbanBoardSource = readComponent('KanbanBoard.tsx');
  const taskStatusSelectSource = readComponent('TaskStatusSelect.tsx');
  const taskEditSource = readComponent('TaskEdit.tsx');
  const taskQuickAddSource = readComponent('TaskQuickAdd.tsx');

  it('T034/T035/T036: ProjectDetail refetches phase-effective statuses and derives counts from them', () => {
    expect(projectDetailSource).toContain('const [projectStatuses, setProjectStatuses] = useState<ProjectStatus[]>(initialStatuses);');
    expect(projectDetailSource).toContain('const fetchStatusesForPhase = async () => {');
    expect(projectDetailSource).toContain(
      'const statuses = await getProjectTaskStatuses(project.project_id, selectedPhase.phase_id);'
    );
    expect(projectDetailSource).toContain('() => new Map(projectStatuses.map((status) => [status.project_status_mapping_id, status]))');
    expect(projectDetailSource).toContain('const completedTasksCount = useMemo(() => {');
    expect(projectDetailSource).toContain(
      "phaseStatusLookup.get(task.project_status_mapping_id)?.is_closed === true"
    );
    expect(projectDetailSource).toContain('const visibleKanbanStatuses = useMemo(');
    expect(projectDetailSource).toContain('const statusTaskCounts = useMemo(() => {');
    expect(projectDetailSource).toContain('if (!phaseStatusLookup.has(statusId)) {');
  });

  it('T037: KanbanBoard renders from the phase-effective statuses it receives via props', () => {
    expect(projectDetailSource).toContain('<KanbanBoard');
    expect(projectDetailSource).toContain('statuses={visibleKanbanStatuses}');
    expect(kanbanBoardSource).toContain('statuses: ProjectStatus[];');
    expect(kanbanBoardSource).toContain('{statuses.filter(status => status.is_visible).map((status, index)');
    expect(kanbanBoardSource).toContain(
      'const statusTasks = enrichedPhaseTasks.filter((task: IProjectTask) => task.project_status_mapping_id === status.project_status_mapping_id);'
    );
  });

  it('T038: task status selectors use the phase-specific status list passed from their current phase', () => {
    expect(taskStatusSelectSource).toContain('statuses: ProjectStatus[];');
    expect(taskStatusSelectSource).toContain('const visibleStatuses = useMemo(() =>');
    expect(taskStatusSelectSource).toContain('.filter(s => s.is_visible)');
    expect(taskStatusSelectSource).toContain('.sort((a, b) => a.display_order - b.display_order)');
    expect(taskEditSource).toContain(
      'const projectStatuses = await getProjectTaskStatuses(phase.project_id, phase.phase_id);'
    );
    expect(taskQuickAddSource).toContain(
      'const statuses = await getProjectTaskStatuses(phase.project_id, phase.phase_id);'
    );
    expect(taskQuickAddSource).toContain('projectStatuses={selectedPhaseStatuses}');
  });
});
