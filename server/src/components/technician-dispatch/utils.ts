import { WorkItemType } from 'server/src/interfaces/workItem.interfaces';

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
  return hour >= 9 && hour < 17; // 9 AM to 5 PM
};

export const getEventColors = (type: WorkItemType) => {
  switch (type) {
    case 'ticket':
      return {
        bg: 'bg-[rgb(var(--color-primary-100))]',
        hover: 'hover:bg-[rgb(var(--color-primary-200))]',
        text: 'text-[rgb(var(--color-text-900))]'
      };
    case 'project_task':
      return {
        bg: 'bg-[rgb(var(--color-secondary-100))]',
        hover: 'hover:bg-[rgb(var(--color-secondary-200))]',
        text: 'text-[rgb(var(--color-text-900))]'
      };
    case 'ad_hoc':
      return {
        bg: 'bg-[rgb(var(--color-border-200))]',
        hover: 'hover:bg-[rgb(var(--color-border-300))]',
        text: 'text-[rgb(var(--color-text-900))]'
      };
    case 'non_billable_category':
      return {
        bg: 'bg-[rgb(var(--color-accent-100))]',
        hover: 'hover:bg-[rgb(var(--color-accent-200))]',
        text: 'text-[rgb(var(--color-text-900))]'
      };
    default:
      return {
        bg: 'bg-[rgb(var(--color-primary-100))]',
        hover: 'hover:bg-[rgb(var(--color-primary-200))]',
        text: 'text-[rgb(var(--color-text-900))]'
      };
  }
};
