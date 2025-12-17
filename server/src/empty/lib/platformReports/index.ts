/**
 * Platform Reports Module - CE Empty Stub
 */

export { PlatformReportService } from './platformReportService';
export type {
  CustomReport,
  CreateReportInput,
  UpdateReportInput,
} from './platformReportService';

// Allowlist exports (empty for CE)
export const PLATFORM_REPORT_ALLOWLIST: Record<string, string[]> = {};
export const BLOCKED_TABLES: string[] = [];

export function isTableAllowed(_table: string): boolean {
  return false;
}

export function isColumnAllowed(_table: string, _column: string): boolean {
  return false;
}

export function getAllowedColumns(_table: string): string[] {
  return [];
}
