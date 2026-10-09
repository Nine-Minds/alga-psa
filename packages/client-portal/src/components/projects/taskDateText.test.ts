import { describe, expect, it } from 'vitest';

import { taskDateText } from './taskDateText';

const formatDay = (date: Date) => date.toISOString().slice(0, 10);
const startsLabel = (date: string) => `Starts ${date}`;
const task = { start_date: new Date('2026-10-05T00:00:00Z'), due_date: new Date('2026-10-09T00:00:00Z') };

describe('taskDateText', () => {
  it('shows a range when both dates are visible', () => {
    expect(taskDateText(task, ['start_date', 'due_date'], formatDay, startsLabel)).toBe('2026-10-05 – 2026-10-09');
  });

  it('never reveals a start date the project has not made visible', () => {
    expect(taskDateText(task, ['due_date'], formatDay, startsLabel)).toBe('2026-10-09');
    expect(taskDateText(task, ['task_name'], formatDay, startsLabel)).toBeNull();
  });

  it('labels a lone start date', () => {
    expect(taskDateText(task, ['start_date'], formatDay, startsLabel)).toBe('Starts 2026-10-05');
    expect(taskDateText({ start_date: task.start_date }, ['start_date', 'due_date'], formatDay, startsLabel)).toBe('Starts 2026-10-05');
  });

  it('is empty for an undated task', () => {
    expect(taskDateText({}, ['start_date', 'due_date'], formatDay, startsLabel)).toBeNull();
  });
});
