/** POST /api/v1/time-entries/cancel-tracking/{sessionId} abandons an owned timer. */
import { ApiTimeEntryController } from '@/lib/api/controllers/ApiTimeEntryController';

const controller = new ApiTimeEntryController();
export const POST = controller.cancelTracking();
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
