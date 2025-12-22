/**
 * NinjaOne Webhook Endpoint
 *
 * Re-exports the EE implementation for NinjaOne webhook handling.
 */

export const runtime = 'nodejs';

export { POST, GET, OPTIONS } from '@ee/app/api/webhooks/ninjaone/route';
