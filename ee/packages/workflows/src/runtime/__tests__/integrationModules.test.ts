import { describe, expect, it, vi } from 'vitest';

const loadFresh = async () => {
  vi.resetModules();
  const integrationModules = await import('../integrationModules');
  const { getWorkflowIntegrationModuleRegistry } = await import(
    '../../../../../../shared/workflow/runtime/registries/integrationModuleRegistry'
  );
  const { getWorkflowModuleAvailabilityRegistry } = await import(
    '../../../../../../shared/workflow/runtime/registries/moduleAvailabilityRegistry'
  );
  const { getActionRegistryV2 } = await import(
    '../../../../../../shared/workflow/runtime/registries/actionRegistry'
  );
  return {
    ...integrationModules,
    getWorkflowIntegrationModuleRegistry,
    getWorkflowModuleAvailabilityRegistry,
    getActionRegistryV2
  };
};

const fakeModule = (key: string, availabilityKey: string | undefined) => ({
  groupKey: `app:${key}` as `app:${string}`,
  label: key,
  tileKind: 'app' as const,
  iconToken: key,
  allowedActionIds: [`${key}.things.find`],
  ...(availabilityKey ? { availabilityKey } : {})
});

const rmmKnexStub = (connectedProviders: Record<string, boolean>) => {
  const calls: Array<Record<string, unknown>> = [];
  const knex: any = vi.fn((table: string) => {
    if (table !== 'rmm_integrations') throw new Error(`Unexpected table ${table}`);
    let filters: Record<string, unknown> = {};
    const builder: any = {
      where: vi.fn().mockImplementation((args: Record<string, unknown>) => {
        filters = args;
        calls.push(args);
        return builder;
      }),
      whereNotNull: vi.fn().mockReturnValue({
        first: vi.fn().mockImplementation(async () =>
          connectedProviders[String(filters.provider)] ? { integration_id: 'int-1' } : undefined
        )
      })
    };
    return builder;
  });
  return { knex, calls };
};

describe('WorkflowModuleAvailabilityRegistry', () => {
  it('registers and returns resolvers, rejects blank and duplicate keys', async () => {
    const { getWorkflowModuleAvailabilityRegistry } = await loadFresh();
    const registry = getWorkflowModuleAvailabilityRegistry();
    const resolver = vi.fn(async () => true);

    registry.register('rmm:test', resolver);
    expect(registry.has('rmm:test')).toBe(true);
    expect(registry.get('rmm:test')).toBe(resolver);
    expect(() => registry.register('rmm:test', resolver)).toThrow(/already has/);
    expect(() => registry.register('   ', resolver)).toThrow(/requires availabilityKey/);
  });
});

describe('resolveAvailableIntegrationModuleKeys', () => {
  it('invokes the registered resolver with (knex, tenantId) and includes available modules', async () => {
    const mods = await loadFresh();
    const resolver = vi.fn(async () => true);
    mods.getWorkflowIntegrationModuleRegistry().register(fakeModule('alpha', 'avail:alpha'));
    mods.getWorkflowModuleAvailabilityRegistry().register('avail:alpha', resolver);

    const knex: any = {};
    const available = await mods.resolveAvailableIntegrationModuleKeys(knex, 'tenant-1');

    expect(resolver).toHaveBeenCalledWith(knex, 'tenant-1');
    expect(available).toEqual(new Set(['app:alpha']));
  });

  it('fails closed when no resolver is registered for an availabilityKey', async () => {
    const mods = await loadFresh();
    mods.getWorkflowIntegrationModuleRegistry().register(fakeModule('orphan', 'avail:orphan'));

    const available = await mods.resolveAvailableIntegrationModuleKeys({} as any, 'tenant-1');
    expect(available.size).toBe(0);
  });

  it('treats a throwing resolver as unavailable without propagating', async () => {
    const mods = await loadFresh();
    mods.getWorkflowIntegrationModuleRegistry().register(fakeModule('broken', 'avail:broken'));
    mods.getWorkflowIntegrationModuleRegistry().register(fakeModule('healthy', 'avail:healthy'));
    mods.getWorkflowModuleAvailabilityRegistry().register('avail:broken', async () => {
      throw new Error('vendor table missing');
    });
    mods.getWorkflowModuleAvailabilityRegistry().register('avail:healthy', async () => true);

    const available = await mods.resolveAvailableIntegrationModuleKeys({} as any, 'tenant-1');
    expect(available).toEqual(new Set(['app:healthy']));
  });

  it('returns an empty set without tenantId and skips modules lacking availabilityKey', async () => {
    const mods = await loadFresh();
    mods.getWorkflowIntegrationModuleRegistry().register(fakeModule('ungated', undefined));

    expect((await mods.resolveAvailableIntegrationModuleKeys({} as any, null)).size).toBe(0);
    expect((await mods.resolveAvailableIntegrationModuleKeys({} as any, 'tenant-1')).size).toBe(0);
  });

  it('gates a mixed module set to exactly the connected integrations', async () => {
    const mods = await loadFresh();
    for (const provider of ['tacticalrmm', 'levelio', 'huntress']) {
      mods.getWorkflowIntegrationModuleRegistry().register(fakeModule(provider, `rmm:${provider}`));
      mods.getWorkflowModuleAvailabilityRegistry().register(`rmm:${provider}`, mods.rmmIntegrationAvailability(provider));
    }
    const { knex } = rmmKnexStub({ tacticalrmm: true, levelio: true, huntress: false });

    const available = await mods.resolveAvailableIntegrationModuleKeys(knex, 'tenant-1');
    expect(available).toEqual(new Set(['app:tacticalrmm', 'app:levelio']));
  });
});

describe('rmmIntegrationAvailability', () => {
  it('matches only active connected rows of the requested provider', async () => {
    const { rmmIntegrationAvailability } = await loadFresh();
    const { knex, calls } = rmmKnexStub({ tacticalrmm: true });

    await expect(rmmIntegrationAvailability('tacticalrmm')(knex, 'tenant-1')).resolves.toBe(true);
    await expect(rmmIntegrationAvailability('levelio')(knex, 'tenant-1')).resolves.toBe(false);

    expect(calls[0]).toEqual({ tenant: 'tenant-1', provider: 'tacticalrmm', is_active: true });
    expect(calls[1]).toEqual({ tenant: 'tenant-1', provider: 'levelio', is_active: true });
  });
});

describe('registerIntegrationWorkflowModule', () => {
  it('registers actions, tile, and resolver once even when invoked twice', async () => {
    const mods = await loadFresh();
    const registerActions = vi.fn();
    const availability = vi.fn(async () => true);
    const registration = {
      module: fakeModule('repeat', 'avail:repeat'),
      availability,
      registerActions
    };

    mods.registerIntegrationWorkflowModule(registration);
    mods.registerIntegrationWorkflowModule(registration);

    const tiles = mods.getWorkflowIntegrationModuleRegistry().list().filter((m) => m.groupKey === 'app:repeat');
    expect(tiles).toHaveLength(1);
    expect(mods.getWorkflowModuleAvailabilityRegistry().get('avail:repeat')).toBe(availability);
    // Action register functions self-guard; the helper may call them per invocation.
    expect(registerActions).toHaveBeenCalled();
    expect(registerActions.mock.calls[0][0]).toBe(mods.getActionRegistryV2());
  });

  it('rejects modules without an availabilityKey', async () => {
    const mods = await loadFresh();
    expect(() =>
      mods.registerIntegrationWorkflowModule({
        module: fakeModule('nokey', undefined) as any,
        availability: async () => true,
        registerActions: () => undefined
      })
    ).toThrow(/requires availabilityKey/);
  });
});

describe('NinjaOne module migration parity', () => {
  it('registers the same tile definition and actions as the pre-migration inline block', async () => {
    vi.resetModules();
    const { registerNinjaOneWorkflowModule } = await import('../actions/registerNinjaOneWorkflowActions');
    const { getWorkflowIntegrationModuleRegistry } = await import(
      '../../../../../../shared/workflow/runtime/registries/integrationModuleRegistry'
    );
    const { getWorkflowModuleAvailabilityRegistry } = await import(
      '../../../../../../shared/workflow/runtime/registries/moduleAvailabilityRegistry'
    );
    const { getActionRegistryV2 } = await import(
      '../../../../../../shared/workflow/runtime/registries/actionRegistry'
    );

    registerNinjaOneWorkflowModule();
    registerNinjaOneWorkflowModule();

    const tiles = getWorkflowIntegrationModuleRegistry().list().filter((m) => m.groupKey === 'app:ninjaone');
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({
      groupKey: 'app:ninjaone',
      label: 'NinjaOne',
      tileKind: 'app',
      iconToken: 'ninjaone',
      defaultActionId: 'ninjaone.devices.find',
      availabilityKey: 'rmm:ninjaone'
    });
    expect(tiles[0].allowedActionIds).toEqual(
      expect.arrayContaining([
        'ninjaone.devices.find',
        'ninjaone.devices.sync',
        'ninjaone.devices.reboot',
        'ninjaone.alerts.list_active',
        'ninjaone.alerts.get',
        'ninjaone.alerts.reset'
      ])
    );

    const registry = getActionRegistryV2();
    for (const actionId of tiles[0].allowedActionIds) {
      expect(registry.listById(actionId)[0]).toBeDefined();
    }

    const resolver = getWorkflowModuleAvailabilityRegistry().get('rmm:ninjaone');
    expect(resolver).toBeDefined();
    const { knex, calls } = rmmKnexStub({ ninjaone: true });
    await expect(resolver!(knex, 'tenant-1')).resolves.toBe(true);
    expect(calls[0]).toEqual({ tenant: 'tenant-1', provider: 'ninjaone', is_active: true });
  });
});
