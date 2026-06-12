import { describe, expect, it } from 'vitest';
import {
  resolveEffectiveDefaultRoleName,
  resolveEffectiveProvisioningMode,
} from '@ee/lib/integrations/entra/sync/clientPortalEntitlementResolution';

describe('client portal entitlement resolution', () => {
  it('T029: resolves effective provisioning mode from mapping override first, workspace default second', () => {
    expect(resolveEffectiveProvisioningMode('workflow_managed', 'disabled')).toBe('workflow_managed');
    expect(resolveEffectiveProvisioningMode('disabled', 'built_in')).toBe('disabled');
    expect(resolveEffectiveProvisioningMode('inherit', 'built_in')).toBe('built_in');
    expect(resolveEffectiveProvisioningMode(undefined, 'disabled')).toBe('disabled');
  });

  it('T031: resolves default role from mapping override, then workspace default, then User', () => {
    expect(resolveEffectiveDefaultRoleName('Approver', 'Workspace User')).toBe('Approver');
    expect(resolveEffectiveDefaultRoleName(null, 'Workspace User')).toBe('Workspace User');
    expect(resolveEffectiveDefaultRoleName('', '')).toBe('User');
  });
});
