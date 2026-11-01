import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
import { ApiBaseController } from '../../../lib/api/controllers/ApiBaseController';
const { ACTIVE_PERMISSIONS } = require('../../../../migrations/utils/permissions/catalog.cjs') as {
  ACTIVE_PERMISSIONS: Array<{ resource: string; action: string; msp: boolean }>;
};

const controllerModules = import.meta.glob('../../../lib/api/controllers/Api*Controller.ts', { eager: true });

describe('API controller permission catalog contract', () => {
  it('declares only permissions that the MSP catalog can grant', () => {
    const requirements = Object.values(controllerModules).flatMap((module: any) =>
      Object.values(module).flatMap((Controller: any) => {
        if (typeof Controller !== 'function' || Controller === ApiBaseController
          || !Controller.prototype?.getPermissionRequirements) return [];
        return new Controller().getPermissionRequirements().map((requirement: any) => ({
          ...requirement,
          controller: Controller.name,
        }));
      }),
    );

    const missing = requirements.filter(({ resource, action }) =>
      !ACTIVE_PERMISSIONS.some((entry) => entry.resource === resource && entry.action === action && entry.msp),
    );

    expect(missing).toEqual([]);
  });
});
