/**
 * Utility functions for formatting values
 */

/**
 * Format a number as currency
 * @param value The number to format
 * @param locale The locale to use (default: 'en-US')
 * @param currency The currency code (default: 'USD')
 * @returns Formatted currency string
 */
export function formatCurrency(
  value: number,
  locale: string = 'en-US',
  currency: string = 'USD'
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

/**
 * Format a date as a string
 * @param date The date to format
 * @param locale The locale to use (default: 'en-US')
 * @returns Formatted date string
 */
export function formatDate(
  date: Date | string | null | undefined,
  locale: string = 'en-US'
): string {
  if (!date) return '';

  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return dateObj.toLocaleDateString(locale);
}

/**
 * Format bytes as human-readable file size
 * @param bytes The number of bytes
 * @param decimals Number of decimal places (default: 2)
 * @returns Formatted file size string
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}