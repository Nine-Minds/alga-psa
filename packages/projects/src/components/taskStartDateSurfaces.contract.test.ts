import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const read = (relative: string) => readFileSync(path.resolve(__dirname, relative), 'utf8');

/**
 * TaskListView and the template editor are too heavy to mount in a unit test.
 * These pin the start-date wiring in them; the behaviour behind it is tested in
 * templateTaskDates, TaskCardDates and TaskFormStartDateAndGuard.
 */
describe('task list start date column', () => {
  const list = read('TaskListView.tsx');

  it('declares a resizable Start Date column next to Due Date that yields before it when space is short', () => {
    const start = list.match(/\{ key: 'start_date',\s*priority: ([\d.]+),[^}]*resizable: true/);
    const due = list.match(/\{ key: 'due_date',\s*priority: ([\d.]+),/);
    expect(start).not.toBeNull();
    expect(due).not.toBeNull();
    // Lower priority number survives longer; the due date outlasts the start date.
    expect(Number(start![1])).toBeGreaterThan(Number(due![1]));
    expect(list.indexOf("{ key: 'start_date'")).toBeLessThan(list.indexOf("{ key: 'due_date'"));
    expect(list).toContain("start_date: t('startDate', 'Start Date'),");
  });

  it('edits the start date inline through the shared update handler, capped at the due date', () => {
    const cell = list.slice(list.indexOf("case 'start_date':"), list.indexOf("case 'due_date':"));
    expect(cell).toContain('onChange={(date) => onTaskUpdate(task.task_id, { start_date: date ?? null })}');
    expect(cell).toContain('maxDate={task.due_date ? new Date(task.due_date) : undefined}');
    expect(cell).toContain('clearable');
    // Read-only users get plain text, not a picker.
    expect(cell).toContain("format(new Date(task.start_date), 'MMM d, yyyy')");
  });

  it('includes the start date in the printable columns', () => {
    expect(list).toMatch(/key: 'startDate',\s*label: t\('startDate', 'Start Date'\),/);
  });
});

describe('template start offset wiring', () => {
  it('reads and writes the offset in the template task form through the shared parser', () => {
    const form = read('project-templates/TemplateTaskForm.tsx');
    expect(form).toContain('formatStartOffsetDays(task.start_offset_days)');
    expect(form).toContain('start_offset_days: parseStartOffsetDays(startOffsetDays),');
    // Changing only the offset counts as an unsaved change.
    expect(form).toContain('if (startOffsetDays !== initialValues.startOffsetDays) return true;');
    expect(form).toContain('id="start-offset-days"');
  });

  it('passes the offset when the editor creates a task and when the wizard builds one', () => {
    expect(read('project-templates/TemplateEditor.tsx')).toContain('start_offset_days: taskData.start_offset_days,');
    const wizard = read('project-templates/wizard-steps/TemplateTasksStep.tsx');
    expect(wizard).toContain('start_offset_days: parseStartOffsetDays(e.target.value) ?? undefined,');
    expect(wizard).toContain('value={formatStartOffsetDays(task.start_offset_days)}');
  });

  it('copies the offset when a template is duplicated or created from the wizard, keeping zero', () => {
    const actions = read('../actions/projectTemplateActions.ts');
    expect(actions).toContain('start_offset_days: task.start_offset_days ?? null,');
    expect(actions).toContain('start_offset_days: taskData.start_offset_days ?? null,');
    const wizardActions = read('../actions/projectTemplateWizardActions.ts');
    expect(wizardActions.match(/start_offset_days: task\.start_offset_days \?\? null,/g)).toHaveLength(3);
    // `|| null` would turn a zero offset into "no start date".
    expect(actions).not.toMatch(/start_offset_days: [\w.]+ \|\| null/);
    expect(wizardActions).not.toMatch(/start_offset_days: [\w.]+ \|\| null/);
  });
});
