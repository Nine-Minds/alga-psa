import { WorkItemType } from '@alga-psa/types';

export const calculateTimeFromPosition = (
  x: number,
  rect: DOMRect,
  selectedDate: Date
): Date => {
  const relativeX = Math.max(0, Math.min(x - rect.left, rect.width));
  const totalMinutesInDay = 24 * 60;
  const minutes = (relativeX / rect.width) * totalMinutesInDay;
  const roundedMinutes = Math.round(minutes / 15) * 15;
  const hour = Math.floor(roundedMinutes / 60);
  const minute = roundedMinutes % 60;

  const time = new Date(selectedDate);
  time.setHours(hour, minute, 0, 0);
  return time;
};

export const isWorkingHour = (hour: number): boolean => {
  return hour >= 8 && hour < 17; // 8 AM to 5 PM
};

export const getEventColors = (
  type: WorkItemType,
  isPrimary: boolean,
  isComparison: boolean
) => {
  let bg = 'bg-[rgb(var(--color-primary-200))]';
  let hover = 'hover:bg-[rgb(var(--color-primary-300))]';
  let text = 'text-[rgb(var(--color-text-900))]';

  switch (type) {
    case 'ticket':
      bg = 'bg-[rgb(var(--color-primary-200))]';
      hover = 'hover:bg-[rgb(var(--color-primary-300))]';
      text = 'text-[rgb(var(--color-text-900))]';
      break;
    case 'project_task':
      bg = 'bg-[rgb(var(--color-secondary-100))]';
      hover = 'hover:bg-[rgb(var(--color-secondary-200))]';
      text = 'text-[rgb(var(--color-text-900))]';
      break;
    case 'ad_hoc':
      bg = 'bg-[rgb(var(--color-border-200))]';
      hover = 'hover:bg-[rgb(var(--color-border-300))]';
      text = 'text-[rgb(var(--color-text-900))]';
      break;
    case 'non_billable_category':
      bg = 'bg-[rgb(var(--color-accent-100))]';
      hover = 'hover:bg-[rgb(var(--color-accent-200))]';
      text = 'text-[rgb(var(--color-text-900))]';
      break;
    case 'interaction':
      bg = 'bg-green-100';
      hover = 'hover:bg-green-200';
      text = 'text-green-900';
      break;
    case 'appointment_request':
      bg = 'bg-rose-200';
      hover = 'hover:bg-rose-300';
      text = 'text-[rgb(var(--color-text-900))]';
      break;
  }

  return { bg, hover, text };
};
