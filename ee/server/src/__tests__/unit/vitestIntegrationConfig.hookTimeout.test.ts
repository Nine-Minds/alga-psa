import { describe, expect, it } from 'vitest';
import eeIntegrationConfig from '../../../vitest.integration.config';
import serverConfig from '../../../../../server/vitest.config';

// Every EE integration file recreates its database in beforeAll. A DB clone can
// wait on sessions left by the previous file, so the hook budget must cover it
// the same way the CE server suite's budget does.
describe('EE integration vitest config', () => {
  it('gives per-file database setup at least the CE server suite hook budget', () => {
    const eeHookTimeout = (eeIntegrationConfig as any).test?.hookTimeout;
    const serverHookTimeout = (serverConfig as any).test?.hookTimeout;

    expect(typeof serverHookTimeout).toBe('number');
    expect(eeHookTimeout).toBeGreaterThanOrEqual(serverHookTimeout);
  });
});
