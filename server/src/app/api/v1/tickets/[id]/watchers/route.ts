/**
 * Ticket Watchers API Route
 * GET    /api/v1/tickets/{id}/watchers - List watchers
 * POST   /api/v1/tickets/{id}/watchers - Add a watcher (contact_id | user_id | email), idempotent
 * PATCH  /api/v1/tickets/{id}/watchers - Toggle a watcher active/inactive
 * DELETE /api/v1/tickets/{id}/watchers?email= - Remove a watcher
 */

import { ApiTicketController } from 'server/src/lib/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const GET = controller.getWatchers();
export const POST = controller.addWatcher();
export const PATCH = controller.updateWatcher();
export const DELETE = controller.removeWatcher();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
