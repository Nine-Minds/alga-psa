import { dynamic, ok, runtime } from './_responses';

export { dynamic, runtime };

export async function GET(): Promise<Response> {
  return ok({
    status: 'not_connected',
    connectionType: null,
    lastDiscoveryAt: null,
    mappedTenantCount: 0,
    availableConnectionTypes: ['direct', 'cipp'],
  });
}
