import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
import { ApiBaseController } from '../../../lib/api/controllers/ApiBaseController';
const { ACTIVE_PERMISSIONS } = require('../../../../migrations/utils/permissions/catalog.cjs') as {
  ACTIVE_PERMISSIONS: Array<{
    resource: string;
    action: string;
    msp: boolean;
    products: string[];
    defaultGrants: Record<string, string[]>;
  }>;
};

const controllerModules = import.meta.glob('../../../lib/api/controllers/Api*Controller.ts', { eager: true });

// Explicit no-permission exports belong here with a reason. API controllers
// must otherwise expose the permission metadata used by their runtime checks.
const NO_PERMISSION_CONTROLLER_EXCLUSIONS: Record<string, string> = {
  ApiContractLineController: 'Its routes use request context and tenant-scoped service methods; the controller declares no RBAC checks.',
};

describe('API controller permission catalog contract', () => {
  it('covers permission-bearing controllers and grants each declared product permission to MSP Admin', () => {
    const discoveredControllers = Array.from(new Set(Object.values(controllerModules).flatMap((module: any) =>
      Object.values(module).filter((Controller: any) =>
        typeof Controller === 'function'
        && Controller !== ApiBaseController
        && /^Api.+Controller$/.test(Controller.name),
      ),
    )));
    const uncovered = discoveredControllers
      .filter((Controller: any) => !Controller.prototype?.getPermissionRequirements
        && !NO_PERMISSION_CONTROLLER_EXCLUSIONS[Controller.name])
      .map((Controller: any) => Controller.name);
    const unexplainedExclusions = Object.entries(NO_PERMISSION_CONTROLLER_EXCLUSIONS)
      .filter(([name, reason]) => !reason || !discoveredControllers.some((Controller: any) =>
        Controller.name === name && !Controller.prototype?.getPermissionRequirements,
      ))
      .map(([name]) => name);

    const requirements = discoveredControllers.flatMap((Controller: any) => {
      if (!Controller.prototype?.getPermissionRequirements || NO_PERMISSION_CONTROLLER_EXCLUSIONS[Controller.name]) return [];
      return new Controller().getPermissionRequirements().map((requirement: any) => ({
        ...requirement,
        controller: Controller.name,
      }));
    });

    const missing = requirements.flatMap(({ resource, action, controller }) => {
      const entries = ACTIVE_PERMISSIONS.filter((entry) =>
        entry.resource === resource && entry.action === action && entry.msp,
      );
      if (entries.length === 0) return [{ controller, resource, action, reason: 'missing MSP catalog permission' }];

      return entries.flatMap((entry) => entry.products
        .filter((product) => !entry.defaultGrants[product]?.includes('msp:Admin'))
        .map((product) => ({ controller, resource, action, product, reason: 'MSP Admin is not granted' })));
    });

    expect(uncovered, 'permission-bearing controllers without runtime declarations').toEqual([]);
    expect(unexplainedExclusions, 'permission exclusions must name a discovered controller and explain why').toEqual([]);
    expect(missing).toEqual([]);
  });
});
