/**
 * Ticket Agents API Route
 * GET  /api/v1/tickets/{id}/agents - List the primary and additional agents
 * POST /api/v1/tickets/{id}/agents - Add an additional agent
 */

import { ApiTicketController } from 'server/src/lib/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const GET = controller.getAgents();
export const POST = controller.addAgent();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
