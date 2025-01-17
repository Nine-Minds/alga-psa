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