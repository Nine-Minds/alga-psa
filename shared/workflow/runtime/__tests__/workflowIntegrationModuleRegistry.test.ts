import { describe, expect, it } from 'vitest';
import { WorkflowIntegrationModuleRegistry } from '../registries/integrationModuleRegistry';

describe('workflow integration module registry', () => {
  it('registers and lists module metadata', () => {
    const registry = new WorkflowIntegrationModuleRegistry();
    registry.register({
      groupKey: 'app:ninjaone',
      label: 'NinjaOne',
      tileKind: 'app',
      iconToken: 'ninjaone',
      defaultActionId: 'ninjaone.devices.find',
      allowedActionIds: ['ninjaone.devices.find'],
      availabilityKey: 'rmm:ninjaone'
    });
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]).toMatchObject({
      groupKey: 'app:ninjaone',
      availabilityKey: 'rmm:ninjaone',
      allowedActionIds: ['ninjaone.devices.find']
    });
  });

  it('rejects duplicate group keys', () => {
    const registry = new WorkflowIntegrationModuleRegistry();
    registry.register({
      groupKey: 'app:ninjaone',
      label: 'NinjaOne',
      tileKind: 'app',
      iconToken: 'ninjaone',
      allowedActionIds: ['ninjaone.devices.find']
    });
    expect(() =>
      registry.register({
        groupKey: 'app:ninjaone',
        label: 'NinjaOne 2',
        tileKind: 'app',
        iconToken: 'ninjaone',
        allowedActionIds: ['ninjaone.devices.sync']
      })
    ).toThrow(/already has/);
  });
});
