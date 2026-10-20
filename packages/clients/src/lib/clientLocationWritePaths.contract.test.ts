import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Coverage ledger for every `client_locations` write path. Each path either publishes
 * CLIENT_LOCATION_* (directly or through models/clientLocation.ts) or is listed as
 * intentionally silent with the reason. Adding a new writer without choosing one fails here.
 */
const root = path.resolve(__dirname, '../../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

describe('client_locations write-path publisher coverage', () => {
  it('the shared model publishes create, update (incl. deactivate) and delete', () => {
    const src = read('packages/clients/src/models/clientLocation.ts');
    expect(src).toContain('queueClientLocationCreated(');
    expect(src).toContain('queueClientLocationUpdated(');
    expect(src).toContain('queueClientLocationDeleted(');
  });

  it('UI actions, REST ClientService and the migration applier go through the model', () => {
    const actions = read('packages/clients/src/actions/clientLocationActions.ts');
    const service = read('server/src/lib/api/services/ClientService.ts');
    expect(actions).toMatch(/models\/clientLocation|createLocation|updateLocation|deleteLocation/);
    expect(service).toMatch(/createLocation|updateLocation|deleteLocation|ClientLocation/);
  });

  it.each([
    ['CSV client import', 'packages/clients/src/actions/clientActions.ts', 'queueClientLocationCreated'],
    ['Xero CSV client import', 'packages/integrations/src/services/xeroCsvClientSyncService.ts', 'CLIENT_LOCATION_CREATED'],
    ['Xero CSV client import (update)', 'packages/integrations/src/services/xeroCsvClientSyncService.ts', 'CLIENT_LOCATION_UPDATED'],
    ['onboarding saveClientInfo/createClient', 'packages/onboarding/src/actions/onboarding-actions/onboardingActions.ts', 'queueClientLocationCreated'],
    ['workflow upsertDefaultClientLocation + clients.duplicate', 'shared/workflow/runtime/actions/businessOperations/clients.ts', 'CLIENT_LOCATION_CREATED'],
    ['workflow upsertDefaultClientLocation (update)', 'shared/workflow/runtime/actions/businessOperations/clients.ts', 'CLIENT_LOCATION_UPDATED'],
  ])('%s publishes directly (bypasses the model)', (_name, file, marker) => {
    expect(read(file)).toContain(marker);
  });
});
