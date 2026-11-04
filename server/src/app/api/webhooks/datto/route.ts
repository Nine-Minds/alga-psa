/**
 * Datto RMM Webhook Endpoint
 *
 * Re-exports the EE implementation (CE builds resolve @enterprise to the stub).
 */

export const runtime = 'nodejs';

export { POST, OPTIONS } from '@enterprise/app/api/webhooks/datto/route';
