import { ITimeEntry } from 'server/src/interfaces/timeEntry.interfaces';
import { parseISO } from 'date-fns';

export function calculateBillabilityPercentage(timeEntry: ITimeEntry): number {
  const duration = ( parseISO(timeEntry.end_time).getTime() - parseISO(timeEntry.start_time).getTime()) / 3600000; // Convert ms to hours
  return (timeEntry.billable_duration / duration) * 100;
}

export function getCellBackgroundColor(timeEntry: ITimeEntry): string {
  const percentage = calculateBillabilityPercentage(timeEntry);
  if (percentage === 100) return "#22C55E";
  if (percentage >= 75) return "#86EFAC";
  if (percentage >= 50) return "#FDE68A";
  if (percentage >= 25) return "#FEF08A";
  return "#FEF9C3";
}

export function validateTimeEntry(timeEntry: ITimeEntry): boolean {
  if (timeEntry.start_time >= timeEntry.end_time) {
    console.error('Start time must be before end time');
    return false;
  }
  const duration = ( parseISO(timeEntry.end_time).getTime() - parseISO(timeEntry.start_time).getTime()) / 3600000; // Convert ms to hours
  if (timeEntry.billable_duration > duration) {
    console.error('Billable duration cannot exceed total duration');
    return false;
  }
  // Add any other necessary validation rules
  return true;
}

export function calculateTotalHours(timeEntries: ITimeEntry[]): { total: number; billable: number } {
  return timeEntries.reduce(
    (acc, entry) => {
      const duration = ( parseISO(entry.end_time).getTime() - parseISO(entry.start_time).getTime()) / 3600000; // Convert ms to hours
      return {
        total: acc.total + duration,
        billable: acc.billable + entry.billable_duration,
      };
    },
    { total: 0, billable: 0 }
  );
}
