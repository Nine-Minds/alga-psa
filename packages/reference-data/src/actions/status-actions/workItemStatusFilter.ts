export const WORK_ITEM_STATUS_NAME_PREFIX = '__status_name__:';

export function createWorkItemStatusNameFilterValue(statusName: string): string {
  return `${WORK_ITEM_STATUS_NAME_PREFIX}${encodeURIComponent(statusName)}`;
}

export function parseWorkItemStatusNameFilterValue(value?: string | null): string | null {
  if (!value || !value.startsWith(WORK_ITEM_STATUS_NAME_PREFIX)) {
    return null;
  }
  return decodeURIComponent(value.slice(WORK_ITEM_STATUS_NAME_PREFIX.length));
}
