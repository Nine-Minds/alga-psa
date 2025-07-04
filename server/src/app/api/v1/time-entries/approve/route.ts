/**
 * Time Entry Approval API Route
 * POST /api/v1/time-entries/approve - Approve time entries
 */

import { ApiTimeEntryControllerV2 } from '@/lib/api/controllers/ApiTimeEntryControllerV2';

const controller = new ApiTimeEntryControllerV2();

export const POST = controller.approve();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';