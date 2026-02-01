/**
 * NinjaOne OAuth Callback Endpoint
 *
 * Re-exports the EE implementation for NinjaOne OAuth callback handling.
 */

export const dynamic = 'force-dynamic';

export { GET } from '@enterprise/app/api/integrations/ninjaone/callback/route';
