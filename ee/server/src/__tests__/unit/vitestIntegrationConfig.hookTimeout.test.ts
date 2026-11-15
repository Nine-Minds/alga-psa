import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DB_SETUP_HOOK_TIMEOUT_MS } from '../../../../../server/test-utils/dbSetupHookTimeout';

// The EE integration config composes server/vitest.config.ts, which is written
// against the server project's vitest setup and is not part of the EE type
// graph. Load it at runtime through a computed specifier so the EE typecheck
// does not have to compile the CE server's vitest config.
const EE_INTEGRATION_CONFIG = pathToFileURL(
  path.resolve(__dirname, '../../../vitest.integration.config.ts'),
).href;

// Every EE integration file recreates its database in beforeAll. A DB clone can
// wait on sessions left by the previous file, so the hook budget must cover it
// the same way the CE server suite's budget does.
describe('EE integration vitest config', () => {
  it('gives per-file database setup at least the shared DB setup hook budget', async () => {
    const { default: eeIntegrationConfig } = await import(/* @vite-ignore */ EE_INTEGRATION_CONFIG);
    const eeHookTimeout = eeIntegrationConfig?.test?.hookTimeout;

    expect(DB_SETUP_HOOK_TIMEOUT_MS).toBeGreaterThan(10_000);
    expect(eeHookTimeout).toBeGreaterThanOrEqual(DB_SETUP_HOOK_TIMEOUT_MS);
  });
});
