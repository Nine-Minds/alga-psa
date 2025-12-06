/**
 * Remote Desktop Audit Logs API Route
 * GET /api/v1/remote-desktop/audit-logs - List audit logs
 * POST /api/v1/remote-desktop/audit-logs - Create audit log entry
 */

import { ApiRemoteDesktopController } from '@/lib/api/controllers/ApiRemoteDesktopController';

const controller = new ApiRemoteDesktopController();

export const GET = controller.listAuditLogs();
export const POST = controller.createAuditLog();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
