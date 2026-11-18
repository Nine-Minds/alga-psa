/**
 * POST /api/v1/billing-catalog/operator   { command, args }
 *
 * Platform-operator catalog commands (inspect | inventory | seed | publish | restore), executed on the
 * platform with its Stripe credential. Backs `npm run billing-catalog`. Master-tenant authority only
 * (`assertMasterTenantAccess`, re-checked by the catalog); a tenant admin is refused before any
 * Stripe or catalog access. Writes need `--confirm` and `--expect=<current version id|none>`.
 */
import { NextRequest } from 'next/server';
import { getStripeService } from '@ee/lib/stripe/StripeService';
import { BadRequest, catalogRoute, readJson, str } from '@ee/lib/stripe/offerCatalog/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMMANDS = ['inspect', 'inventory', 'seed', 'publish', 'restore'];

export async function POST(request: NextRequest) {
  return catalogRoute(request, async (operator) => {
    const body = await readJson(request);
    const command = str(body.command, 'command');
    if (!COMMANDS.includes(command)) throw new BadRequest(`command must be one of ${COMMANDS.join(', ')}`);
    const args = Array.isArray(body.args) ? body.args : [];
    if (args.length > 20 || args.some((arg) => typeof arg !== 'string' || arg.length > 300 || !arg.startsWith('--'))) throw new BadRequest('args must be --flag[=value] strings');
    return getStripeService().runCatalogOperatorCommand(command, args as string[], operator);
  });
}
