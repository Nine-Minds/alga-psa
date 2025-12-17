/**
 * Platform Reports Module
 *
 * Cross-tenant reporting for Nine Minds platform administration.
 */

export { PlatformReportService } from './platformReportService';
export type {
  CustomReport,
  CreateReportInput,
  UpdateReportInput,
} from './platformReportService';

export {
  PLATFORM_REPORT_ALLOWLIST,
  BLOCKED_TABLES,
  isTableAllowed,
  isColumnAllowed,
  getAllowedColumns,
} from './allowlist';
