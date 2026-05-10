import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '..', 'SsoBulkAssignment.tsx'), 'utf8');
const preferencesSource = fs.readFileSync(
  path.join(here, '..', '..', '..', '..', 'lib', 'actions', 'auth', 'ssoPreferences.ts'),
  'utf8'
);
const confirmRouteSource = fs.readFileSync(
  path.join(here, '..', '..', '..', '..', 'app', 'api', 'integrations', 'entra', 'mappings', 'confirm', 'route.ts'),
  'utf8'
);
const confirmServiceSource = fs.readFileSync(
  path.join(here, '..', '..', '..', '..', 'lib', 'integrations', 'entra', 'mapping', 'confirmMappingsService.ts'),
  'utf8'
);

describe('SSO bulk assignment auto-link contract', () => {
  it('T010/F024: exposes separate internal and client auto-link toggles and persists autoLinkClient independently', () => {
    expect(source).toContain('autoLinkInternalEnabled');
    expect(source).toContain('autoLinkClientEnabled');
    expect(source).toContain('updateSsoPreferencesAction({ autoLinkInternal: checked })');
    expect(source).toContain('updateSsoPreferencesAction({ autoLinkClient: checked })');
    expect(source).toContain('ssoBulk.autoLink.clientTitle');
    expect(source).toContain('ssoBulk.autoLink.internalTitle');
  });

  it('T010/F025/F026/F027: exposes provisioning mode and entitlement-removal deactivation controls in settings UI', () => {
    expect(source).toContain('clientPortalEntraProvisioningMode');
    expect(source).toContain('deactivateEntraManagedPortalUsersOnEntitlementRemoval');
    expect(source).toContain('handleProvisioningModeChange');
    expect(source).toContain('handleDeactivateToggle');
    expect(source).toContain('modeWorkflowManaged');
    expect(preferencesSource).toContain('clientPortalEntraProvisioningMode');
    expect(preferencesSource).toContain('deactivateEntraManagedPortalUsersOnEntitlementRemoval');
    expect(preferencesSource).toContain('const provisioningModeRaw');
    expect(preferencesSource).toContain('provisioningModeRaw === "built_in" || provisioningModeRaw === "workflow_managed"');
  });

  it('T010/F028: persists client portal provisioning mode on managed Entra tenant/client mapping confirm', () => {
    expect(confirmRouteSource).toContain('clientPortalEntraProvisioningMode');
    expect(confirmRouteSource).toContain('client_portal_entra_provisioning_mode');
    expect(confirmServiceSource).toContain('client_portal_entra_provisioning_mode');
    expect(confirmServiceSource).toContain('normalizeProvisioningMode');
  });

  it('T026/F075: shows workflow-managed explanatory copy that workflow owns provisioning and lifecycle behavior', () => {
    expect(source).toContain('workflowManagedInfo');
    expect(source).toContain('Workflow-managed mode publishes Entra access events only.');
    expect(source).toContain('client portal user provisioning, role assignment, invitations, and lifecycle changes');
  });
});
