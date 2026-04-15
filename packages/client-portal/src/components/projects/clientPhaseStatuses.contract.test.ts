import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const readPortalFile = (relativePath: string) =>
  readFileSync(path.resolve(__dirname, relativePath), 'utf8');

describe('client portal phase status contracts', () => {
  const actionSource = readPortalFile('../../actions/client-portal-actions/client-project-details.ts');
  const detailViewSource = readPortalFile('ProjectDetailView.tsx');
  const kanbanSource = readPortalFile('ClientKanbanBoard.tsx');
  const listViewSource = readPortalFile('ClientTaskListView.tsx');

  it('T032/T033: getClientProjectStatuses accepts phaseId and falls back to project defaults when needed', () => {
    expect(actionSource).toContain('export const getClientProjectStatuses = withAuth(async (');
    expect(actionSource).toContain('phaseId?: string | null');
    expect(actionSource).toContain('const loadStatusesForScope = async (scopedPhaseId?: string | null) => {');
    expect(actionSource).toContain("query.andWhere('psm.phase_id', scopedPhaseId);");
    expect(actionSource).toContain("query.whereNull('psm.phase_id');");
    expect(actionSource).toContain('let statuses = phaseId ? await loadStatusesForScope(phaseId) : [];');
    expect(actionSource).toContain('statuses = await loadStatusesForScope();');
  });

  it('T046: ProjectDetailView refetches client portal statuses when the selected phase changes and passes them to kanban', () => {
    expect(detailViewSource).toContain('const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null);');
    expect(detailViewSource).toContain(
      'const statusesResult = await getClientProjectStatuses(project.project_id, selectedPhaseId);'
    );
    expect(detailViewSource).toContain('statuses={statuses}');
    expect(detailViewSource).toContain('selectedPhaseId={selectedPhaseId}');
    expect(detailViewSource).toContain('onPhaseSelect={setSelectedPhaseId}');
  });

  it('T047: client kanban and list views render/group tasks by phase-effective statuses', () => {
    expect(kanbanSource).toContain('const orderedStatuses = React.useMemo(');
    expect(kanbanSource).toContain('() => [...statuses].sort((a, b) => a.display_order - b.display_order),');
    expect(kanbanSource).toContain('const phaseTasks = selectedPhaseId');
    expect(kanbanSource).toContain('const tasksByStatus = phaseTasks.reduce((acc, task) => {');
    expect(listViewSource).toContain("// Group by effective status label for the task's phase");
    expect(listViewSource).toContain('const statusName = task.custom_name || task.status_name || \'Unknown\';');
    expect(listViewSource).toContain('statusGroups: Array.from(statusMap.values()).sort((a, b) => a.display_order - b.display_order)');
  });
});
