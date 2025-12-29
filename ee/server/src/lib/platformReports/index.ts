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
  BLOCKED_TABLES,
  BLOCKED_COLUMN_PATTERNS,
  isTableAllowed,
  isColumnAllowed,
  filterAllowedColumns,
} from './blocklist';

export {
  PlatformReportAuditService,
  extractClientInfo,
} from './auditService';
export type {
  AuditEventType,
  AuditLogEntry,
  LogEventInput,
  ListLogsOptions,
} from './auditService';
