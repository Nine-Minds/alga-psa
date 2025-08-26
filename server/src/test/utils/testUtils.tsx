import { within } from '@testing-library/react';

export function getFirstMatchingElement<T extends HTMLElement>(
  queryFn: () => T[],
  fallbackQueryFn?: () => T
): T {
  try {
    const elements = queryFn();
    return elements[0];
  } catch (error) {
    if (fallbackQueryFn) {
      return fallbackQueryFn();
    }
    throw error;
  }
}

export function queryWithinFirst<T extends HTMLElement>(
  container: HTMLElement,
  queryFn: (element: ReturnType<typeof within>) => T
): T {
  const withinContainer = within(container);
  return queryFn(withinContainer);
}