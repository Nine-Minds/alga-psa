import { formatISO, parseISO, setHours, setMinutes } from 'date-fns';
import { ITimeEntryWithNew } from './types';

export function formatTimeForInput(date: Date): string {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function parseTimeToDate(timeString: string, baseDate: Date): Date {
  const [hours, minutes] = timeString.split(':').map(Number);
  const newDate = new Date(baseDate);
  return setMinutes(setHours(newDate, hours || 0), minutes || 0);
}

export function calculateDuration(startTime: Date, endTime: Date): number {
  return Math.max(0, Math.round((endTime.getTime() - startTime.getTime()) / 60000));
}

export function validateTimeEntry(timeEntry: ITimeEntryWithNew): boolean {
  if (parseISO(timeEntry.start_time) >= parseISO(timeEntry.end_time)) {
    alert('Start time must be before end time');
    return false;
  }
  const duration = calculateDuration(
    parseISO(timeEntry.start_time),
    parseISO(timeEntry.end_time)
  );
  if (timeEntry.billable_duration > duration) {
    alert('Billable duration cannot exceed total duration');
    return false;
  }
  return true;
}

export function getServiceById(services: { id: string; name: string }[], serviceId: string | undefined) {
  if (!serviceId) return undefined;
  return services.find(s => s.id === serviceId);
}

export function getDurationParts(totalDuration: number) {
  return {
    hours: Math.floor(totalDuration / 60),
    minutes: totalDuration % 60
  };
}

// Billability color scheme for time entry visualization
export type BillabilityPercentage = 0 | 25 | 50 | 75 | 100;

export const billabilityColorScheme: Record<BillabilityPercentage, {
    background: string;
    border: string;
    text: string;
}> = {
    0: {
        background: "rgb(var(--color-border-50))",
        border: "rgb(var(--color-border-300))",
        text: "rgb(var(--color-border-700))"
    },
    25: {
        background: "rgb(var(--color-accent-50))",
        border: "rgb(var(--color-accent-300))",
        text: "rgb(var(--color-accent-700))"
    },
    50: {
        background: "rgb(var(--color-accent-100))",
        border: "rgb(var(--color-accent-300))",
        text: "rgb(var(--color-accent-700))"
    },
    75: {
        background: "rgb(var(--color-secondary-100))",
        border: "rgb(var(--color-secondary-300))",
        text: "rgb(var(--color-secondary-700))"
    },
    100: {
        background: "rgb(var(--color-primary-100))",
        border: "rgb(var(--color-primary-300))",
        text: "rgb(var(--color-primary-700))"
    }
} as const;

export function formatDuration(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = Math.round(minutes % 60);
    return `${hours.toString().padStart(2, '0')}:${remainingMinutes.toString().padStart(2, '0')}`;
}

export function formatWorkItemType(type: string): string {
    const words = type.split(/[_\s]+/);
    return words.map((word): string =>
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ');
}

export function formatTimeRange(startTime: string, endTime: string): string {
    const start = parseISO(startTime);
    const end = parseISO(endTime);
    return `${formatTime24(start)} - ${formatTime24(end)}`;
}

function formatTime24(date: Date): string {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
}