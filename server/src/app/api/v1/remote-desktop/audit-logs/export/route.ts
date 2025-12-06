/**
 * Remote Desktop Audit Logs Export API Route
 * GET /api/v1/remote-desktop/audit-logs/export - Export audit logs as CSV
 */

import { ApiRemoteDesktopController } from '@/lib/api/controllers/ApiRemoteDesktopController';

const controller = new ApiRemoteDesktopController();

export const GET = controller.exportAuditLogs();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
