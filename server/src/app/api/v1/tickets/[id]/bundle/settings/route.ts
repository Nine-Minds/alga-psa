/**
 * Ticket Bundle Settings API Route
 * PUT /api/v1/tickets/{id}/bundle/settings - Update bundle settings (mode, reopen-on-reply)
 */

import { ApiTicketController } from 'server/src/lib/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const PUT = controller.updateBundleSettings();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
