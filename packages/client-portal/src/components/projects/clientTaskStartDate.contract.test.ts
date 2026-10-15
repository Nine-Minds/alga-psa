import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const read = (relative: string) => readFileSync(path.resolve(__dirname, relative), 'utf8');

describe('client portal task start date contracts', () => {
  const action = read('../../actions/client-portal-actions/client-project-details.ts');

  it('selects the start date only when the project has made it visible', () => {
    expect(action).toContain("if (visibleFields.includes('start_date')) selectColumns.push('pt.start_date');");
    // Guarded select is the only place the column is read: no unconditional pt.start_date, no pt.*.
    expect(action.match(/pt\.start_date/g)).toHaveLength(1);
    expect(action).not.toContain("'pt.*'");
    // It is opt-in: absent from the default fields the query falls back to.
    expect(action).toContain("result.config.visible_task_fields ?? ['task_name', 'due_date', 'status']");
  });

  it('renders dates on cards through the visibility-aware helper', () => {
    for (const file of ['ClientKanbanBoard.tsx', 'ProjectPhaseTasksView.tsx']) {
      const source = read(file);
      expect(source, file).toContain("import { taskDateText } from './taskDateText';");
      expect(source, file).toMatch(/taskDateText\(\s*task,\s*visibleFields,/);
      // No direct, ungated rendering of the start date.
      expect(source, file).not.toMatch(/format\(new Date\(task\.start_date\)/);
    }
  });

  it('gates the start date line in the task details section on the visible fields', () => {
    const section = read('ProjectTasksSection.tsx');
    expect(section).toContain("{visibleFields.includes('start_date') && task.start_date && (");
  });
});
