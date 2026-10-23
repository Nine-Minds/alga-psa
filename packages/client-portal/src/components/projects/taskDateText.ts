/** Calendar-chip text: a range when both dates are shown, otherwise whichever one exists. */
export function taskDateText(
  task: { start_date?: Date | null; due_date?: Date | null },
  visibleFields: string[],
  formatDay: (date: Date) => string,
  startsLabel: (date: string) => string,
): string | null {
  const start = visibleFields.includes('start_date') && task.start_date ? formatDay(new Date(task.start_date)) : null;
  const due = visibleFields.includes('due_date') && task.due_date ? formatDay(new Date(task.due_date)) : null;
  if (start && due) return `${start} – ${due}`;
  if (due) return due;
  return start ? startsLabel(start) : null;
}
