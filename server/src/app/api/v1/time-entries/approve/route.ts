/**
 * Time Entry Approval API Route
 * POST /api/v1/time-entries/approve - Approve time entries
 */

import { ApiTimeEntryController } from '@/lib/api/controllers/ApiTimeEntryController';

const controller = new ApiTimeEntryController();

export const POST = controller.approve();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';