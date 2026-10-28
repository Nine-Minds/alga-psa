/**
 * Single source of truth for the operator-route auth regression tests: one row
 * per exported handler (and per `__method` override). The three spec files run
 * the matrix over their slice; the inventory test asserts this table matches
 * the route files on disk.
 */
import type { RouteRow } from './operatorRouteHarness';

type Loader = () => Promise<Record<string, unknown>>;

// Literal specifiers so the bundler can resolve each route. Loading must stay
// lazy: the spec calls vi.resetModules() and stubs the env before the import.
const LOADERS: Record<string, Loader> = {
  'v1/tenant-management/addons/route.ts': () => import('@ee/app/api/v1/tenant-management/addons/route'),
  'v1/tenant-management/audit/route.ts': () => import('@ee/app/api/v1/tenant-management/audit/route'),
  'v1/tenant-management/confirm-deletion/route.ts': () => import('@ee/app/api/v1/tenant-management/confirm-deletion/route'),
  'v1/tenant-management/create-tenant/route.ts': () => import('@ee/app/api/v1/tenant-management/create-tenant/route'),
  'v1/tenant-management/export-status/route.ts': () => import('@ee/app/api/v1/tenant-management/export-status/route'),
  'v1/tenant-management/export-tenant/route.ts': () => import('@ee/app/api/v1/tenant-management/export-tenant/route'),
  'v1/tenant-management/exports/route.ts': () => import('@ee/app/api/v1/tenant-management/exports/route'),
  'v1/tenant-management/pending-deletions/route.ts': () => import('@ee/app/api/v1/tenant-management/pending-deletions/route'),
  'v1/tenant-management/resend-welcome-email/route.ts': () => import('@ee/app/api/v1/tenant-management/resend-welcome-email/route'),
  'v1/tenant-management/rollback-deletion/route.ts': () => import('@ee/app/api/v1/tenant-management/rollback-deletion/route'),
  'v1/tenant-management/start-deletion/route.ts': () => import('@ee/app/api/v1/tenant-management/start-deletion/route'),
  'v1/tenant-management/tenants/route.ts': () => import('@ee/app/api/v1/tenant-management/tenants/route'),
  'v1/tenant-management/tenants/[tenantId]/addons/route.ts': () => import('@ee/app/api/v1/tenant-management/tenants/[tenantId]/addons/route'),
  'v1/platform-reports/route.ts': () => import('@ee/app/api/v1/platform-reports/route'),
  'v1/platform-reports/[reportId]/route.ts': () => import('@ee/app/api/v1/platform-reports/[reportId]/route'),
  'v1/platform-reports/[reportId]/execute/route.ts': () => import('@ee/app/api/v1/platform-reports/[reportId]/execute/route'),
  'v1/platform-reports/access/route.ts': () => import('@ee/app/api/v1/platform-reports/access/route'),
  'v1/platform-reports/audit/route.ts': () => import('@ee/app/api/v1/platform-reports/audit/route'),
  'v1/platform-reports/schema/route.ts': () => import('@ee/app/api/v1/platform-reports/schema/route'),
  'v1/platform-notifications/route.ts': () => import('@ee/app/api/v1/platform-notifications/route'),
  'v1/platform-notifications/[notificationId]/route.ts': () => import('@ee/app/api/v1/platform-notifications/[notificationId]/route'),
  'v1/platform-notifications/[notificationId]/reads/route.ts': () => import('@ee/app/api/v1/platform-notifications/[notificationId]/reads/route'),
  'v1/platform-notifications/[notificationId]/stats/route.ts': () => import('@ee/app/api/v1/platform-notifications/[notificationId]/stats/route'),
  'v1/platform-notifications/resolve-recipients/route.ts': () => import('@ee/app/api/v1/platform-notifications/resolve-recipients/route'),
  'v1/platform-feature-flags/route.ts': () => import('@ee/app/api/v1/platform-feature-flags/route'),
  'v1/platform-feature-flags/[flagId]/route.ts': () => import('@ee/app/api/v1/platform-feature-flags/[flagId]/route'),
  'v1/platform-feature-flags/[flagId]/tenants/route.ts': () => import('@ee/app/api/v1/platform-feature-flags/[flagId]/tenants/route'),
  'provisioning/tenants/route.ts': () => import('@ee/app/api/provisioning/tenants/route'),
  'v1/appliance-installs/route.ts': () => import('@ee/app/api/v1/appliance-installs/route'),
  'v1/appliance-installs/access/route.ts': () => import('@ee/app/api/v1/appliance-installs/access/route'),
  'v1/appliance-installs/[tenantId]/route.ts': () => import('@ee/app/api/v1/appliance-installs/[tenantId]/route'),
  'v1/appliance-installs/[tenantId]/audit/route.ts': () => import('@ee/app/api/v1/appliance-installs/[tenantId]/audit/route'),
  'v1/appliance-installs/[tenantId]/billing/route.ts': () => import('@ee/app/api/v1/appliance-installs/[tenantId]/billing/route'),
  'v1/appliance-installs/[tenantId]/airgap-key/route.ts': () => import('@ee/app/api/v1/appliance-installs/[tenantId]/airgap-key/route'),
  'v1/appliance-installs/[tenantId]/entitlement/route.ts': () => import('@ee/app/api/v1/appliance-installs/[tenantId]/entitlement/route'),
  'v1/appliance-installs/[tenantId]/extend-pro/route.ts': () => import('@ee/app/api/v1/appliance-installs/[tenantId]/extend-pro/route'),
  'v1/appliance-installs/[tenantId]/pause-billing/route.ts': () => import('@ee/app/api/v1/appliance-installs/[tenantId]/pause-billing/route'),
  'v1/appliance-installs/[tenantId]/reissue-activation-code/route.ts': () => import('@ee/app/api/v1/appliance-installs/[tenantId]/reissue-activation-code/route'),
  'v1/appliance-installs/[tenantId]/reissue-install-code/route.ts': () => import('@ee/app/api/v1/appliance-installs/[tenantId]/reissue-install-code/route'),
  'v1/appliance-installs/[tenantId]/resume-billing/route.ts': () => import('@ee/app/api/v1/appliance-installs/[tenantId]/resume-billing/route'),
  'v1/appliance-installs/[tenantId]/revoke/route.ts': () => import('@ee/app/api/v1/appliance-installs/[tenantId]/revoke/route'),
  'v1/appliance-installs/[tenantId]/status/route.ts': () => import('@ee/app/api/v1/appliance-installs/[tenantId]/status/route'),
  'v1/appliance-installs/[tenantId]/appliances/[applianceId]/revoke/route.ts': () => import('@ee/app/api/v1/appliance-installs/[tenantId]/appliances/[applianceId]/revoke/route'),
  'v1/appliance-installs/workflows/[workflowId]/route.ts': () => import('@ee/app/api/v1/appliance-installs/workflows/[workflowId]/route'),
};

/** Appliance parsers reject past timestamps, so build the date at load time. */
const FUTURE_UNIX = Math.floor(Date.now() / 1000) + 7 * 86400;
const ADDON_KEY = 'ai_assistant';

function row(
  surface: RouteRow['surface'],
  file: string,
  method: RouteRow['method'],
  label: string | undefined,
  url: string,
  params: Record<string, string> | undefined,
  body: Record<string, unknown> | undefined,
): RouteRow {
  const load = LOADERS[file];
  if (!load) throw new Error(`No loader registered for ${file}`);
  const name = file.replace(/^v1\//, '').replace(/\/route\.ts$/, '');
  return {
    id: `${method} ${name}${label ? ` (${label})` : ''}`,
    surface,
    file,
    method,
    load,
    url,
    params,
    body,
  };
}

export const tenantManagementRows: RouteRow[] = [
  { ...(row('tenant-management', 'v1/tenant-management/addons/route.ts', 'GET', undefined, '/api/v1/tenant-management/addons', undefined, undefined)), staticAfterGate: true },
  row('tenant-management', 'v1/tenant-management/audit/route.ts', 'GET', undefined, '/api/v1/tenant-management/audit', undefined, undefined),
  row('tenant-management', 'v1/tenant-management/confirm-deletion/route.ts', 'POST', undefined, '/api/v1/tenant-management/confirm-deletion', undefined, {'workflowId': 'wf-1', 'type': 'immediate'}),
  row('tenant-management', 'v1/tenant-management/create-tenant/route.ts', 'POST', undefined, '/api/v1/tenant-management/create-tenant', undefined, {'companyName': 'Acme', 'firstName': 'A', 'lastName': 'B', 'email': 'a@example.test', 'licenseCount': 5, 'productCode': 'psa'}),
  row('tenant-management', 'v1/tenant-management/export-status/route.ts', 'GET', undefined, '/api/v1/tenant-management/export-status?workflowId=wf-1', undefined, undefined),
  row('tenant-management', 'v1/tenant-management/export-tenant/route.ts', 'POST', undefined, '/api/v1/tenant-management/export-tenant', undefined, {'tenantId': '00000000-0000-4000-8000-000000000001', 'reason': 'test'}),
  row('tenant-management', 'v1/tenant-management/exports/route.ts', 'GET', undefined, '/api/v1/tenant-management/exports?tenantId=00000000-0000-4000-8000-000000000001', undefined, undefined),
  row('tenant-management', 'v1/tenant-management/pending-deletions/route.ts', 'GET', undefined, '/api/v1/tenant-management/pending-deletions', undefined, undefined),
  row('tenant-management', 'v1/tenant-management/resend-welcome-email/route.ts', 'POST', undefined, '/api/v1/tenant-management/resend-welcome-email', undefined, {'tenantId': '00000000-0000-4000-8000-000000000001'}),
  row('tenant-management', 'v1/tenant-management/rollback-deletion/route.ts', 'POST', undefined, '/api/v1/tenant-management/rollback-deletion', undefined, {'workflowId': 'wf-1', 'reason': 'test'}),
  row('tenant-management', 'v1/tenant-management/start-deletion/route.ts', 'POST', undefined, '/api/v1/tenant-management/start-deletion', undefined, {'tenantId': '00000000-0000-4000-8000-000000000001', 'reason': 'test'}),
  row('tenant-management', 'v1/tenant-management/tenants/route.ts', 'GET', undefined, '/api/v1/tenant-management/tenants', undefined, undefined),
  row('tenant-management', 'v1/tenant-management/tenants/[tenantId]/addons/route.ts', 'POST', undefined, '/api/v1/tenant-management/tenants/00000000-0000-4000-8000-000000000001/addons', {'tenantId': '00000000-0000-4000-8000-000000000001'}, {'action': 'grant', 'addonKey': ADDON_KEY}),
];

export const platformOperatorRows: RouteRow[] = [
  row('platform', 'v1/platform-reports/route.ts', 'GET', undefined, '/api/v1/platform-reports', undefined, undefined),
  row('platform', 'v1/platform-reports/route.ts', 'POST', undefined, '/api/v1/platform-reports', undefined, {'name': 'r', 'report_definition': {'id': 'r'}}),
  row('platform', 'v1/platform-reports/[reportId]/route.ts', 'GET', undefined, '/api/v1/platform-reports/rep-1', {'reportId': 'rep-1'}, undefined),
  row('platform', 'v1/platform-reports/[reportId]/route.ts', 'PUT', undefined, '/api/v1/platform-reports/rep-1', {'reportId': 'rep-1'}, {'name': 'r2'}),
  row('platform', 'v1/platform-reports/[reportId]/route.ts', 'POST', '__method PUT', '/api/v1/platform-reports/rep-1', {'reportId': 'rep-1'}, {'__method': 'PUT', 'name': 'r2'}),
  row('platform', 'v1/platform-reports/[reportId]/route.ts', 'POST', '__method DELETE', '/api/v1/platform-reports/rep-1', {'reportId': 'rep-1'}, {'__method': 'DELETE'}),
  row('platform', 'v1/platform-reports/[reportId]/route.ts', 'DELETE', undefined, '/api/v1/platform-reports/rep-1', {'reportId': 'rep-1'}, undefined),
  row('platform', 'v1/platform-reports/[reportId]/execute/route.ts', 'POST', undefined, '/api/v1/platform-reports/rep-1/execute', {'reportId': 'rep-1'}, {'parameters': {}}),
  row('platform', 'v1/platform-reports/access/route.ts', 'POST', undefined, '/api/v1/platform-reports/access', undefined, {}),
  row('platform', 'v1/platform-reports/audit/route.ts', 'GET', undefined, '/api/v1/platform-reports/audit', undefined, undefined),
  row('platform', 'v1/platform-reports/schema/route.ts', 'GET', undefined, '/api/v1/platform-reports/schema', undefined, undefined),
  row('platform', 'v1/platform-notifications/route.ts', 'GET', undefined, '/api/v1/platform-notifications', undefined, undefined),
  row('platform', 'v1/platform-notifications/route.ts', 'POST', undefined, '/api/v1/platform-notifications', undefined, {'name': 'n', 'title': 't', 'body': 'b'}),
  row('platform', 'v1/platform-notifications/[notificationId]/route.ts', 'GET', undefined, '/api/v1/platform-notifications/note-1', {'notificationId': 'note-1'}, undefined),
  row('platform', 'v1/platform-notifications/[notificationId]/route.ts', 'PUT', undefined, '/api/v1/platform-notifications/note-1', {'notificationId': 'note-1'}, {'title': 't2'}),
  row('platform', 'v1/platform-notifications/[notificationId]/route.ts', 'POST', '__method PUT', '/api/v1/platform-notifications/note-1', {'notificationId': 'note-1'}, {'__method': 'PUT', 'title': 't2'}),
  row('platform', 'v1/platform-notifications/[notificationId]/route.ts', 'POST', '__method DELETE', '/api/v1/platform-notifications/note-1', {'notificationId': 'note-1'}, {'__method': 'DELETE'}),
  row('platform', 'v1/platform-notifications/[notificationId]/route.ts', 'DELETE', undefined, '/api/v1/platform-notifications/note-1', {'notificationId': 'note-1'}, undefined),
  row('platform', 'v1/platform-notifications/[notificationId]/reads/route.ts', 'GET', undefined, '/api/v1/platform-notifications/note-1/reads', {'notificationId': 'note-1'}, undefined),
  row('platform', 'v1/platform-notifications/[notificationId]/stats/route.ts', 'GET', undefined, '/api/v1/platform-notifications/note-1/stats', {'notificationId': 'note-1'}, undefined),
  row('platform', 'v1/platform-notifications/resolve-recipients/route.ts', 'POST', undefined, '/api/v1/platform-notifications/resolve-recipients', undefined, {'filters': {}}),
  row('platform', 'v1/platform-feature-flags/route.ts', 'GET', undefined, '/api/v1/platform-feature-flags', undefined, undefined),
  row('platform', 'v1/platform-feature-flags/route.ts', 'POST', undefined, '/api/v1/platform-feature-flags', undefined, {'key': 'f', 'name': 'f'}),
  row('platform', 'v1/platform-feature-flags/[flagId]/route.ts', 'GET', undefined, '/api/v1/platform-feature-flags/42', {'flagId': '42'}, undefined),
  row('platform', 'v1/platform-feature-flags/[flagId]/route.ts', 'POST', 'no override (GET)', '/api/v1/platform-feature-flags/42', {'flagId': '42'}, {}),
  row('platform', 'v1/platform-feature-flags/[flagId]/route.ts', 'POST', '__method PATCH', '/api/v1/platform-feature-flags/42', {'flagId': '42'}, {'__method': 'PATCH', 'active': true}),
  row('platform', 'v1/platform-feature-flags/[flagId]/route.ts', 'POST', '__method DELETE', '/api/v1/platform-feature-flags/42', {'flagId': '42'}, {'__method': 'DELETE'}),
  row('platform', 'v1/platform-feature-flags/[flagId]/route.ts', 'PATCH', undefined, '/api/v1/platform-feature-flags/42', {'flagId': '42'}, {'active': true}),
  row('platform', 'v1/platform-feature-flags/[flagId]/route.ts', 'DELETE', undefined, '/api/v1/platform-feature-flags/42', {'flagId': '42'}, undefined),
  row('platform', 'v1/platform-feature-flags/[flagId]/tenants/route.ts', 'POST', undefined, '/api/v1/platform-feature-flags/42/tenants', {'flagId': '42'}, {'tenantId': '00000000-0000-4000-8000-000000000001', '__action': 'add'}),
];

export const applianceAndProvisioningRows: RouteRow[] = [
  row('provisioning', 'provisioning/tenants/route.ts', 'POST', undefined, '/api/provisioning/tenants', undefined, {'client_name': 'Acme', 'email': 'a@example.test'}),
  row('appliance', 'v1/appliance-installs/route.ts', 'GET', undefined, '/api/v1/appliance-installs', undefined, undefined),
  row('appliance', 'v1/appliance-installs/route.ts', 'POST', undefined, '/api/v1/appliance-installs', undefined, {'company_name': 'Acme', 'contact_email': 'a@example.test', 'edition': 'essentials'}),
  row('appliance', 'v1/appliance-installs/access/route.ts', 'POST', undefined, '/api/v1/appliance-installs/access', undefined, {}),
  row('appliance', 'v1/appliance-installs/[tenantId]/route.ts', 'GET', undefined, '/api/v1/appliance-installs/00000000-0000-4000-8000-000000000001', {'tenantId': '00000000-0000-4000-8000-000000000001'}, undefined),
  row('appliance', 'v1/appliance-installs/[tenantId]/route.ts', 'POST', '__method PATCH', '/api/v1/appliance-installs/00000000-0000-4000-8000-000000000001', {'tenantId': '00000000-0000-4000-8000-000000000001'}, {'__method': 'PATCH', 'company_name': 'Acme 2'}),
  row('appliance', 'v1/appliance-installs/[tenantId]/audit/route.ts', 'GET', undefined, '/api/v1/appliance-installs/00000000-0000-4000-8000-000000000001/audit', {'tenantId': '00000000-0000-4000-8000-000000000001'}, undefined),
  row('appliance', 'v1/appliance-installs/[tenantId]/billing/route.ts', 'GET', undefined, '/api/v1/appliance-installs/00000000-0000-4000-8000-000000000001/billing', {'tenantId': '00000000-0000-4000-8000-000000000001'}, undefined),
  row('appliance', 'v1/appliance-installs/[tenantId]/airgap-key/route.ts', 'POST', undefined, '/api/v1/appliance-installs/00000000-0000-4000-8000-000000000001/airgap-key', {'tenantId': '00000000-0000-4000-8000-000000000001'}, {}),
  row('appliance', 'v1/appliance-installs/[tenantId]/entitlement/route.ts', 'POST', undefined, '/api/v1/appliance-installs/00000000-0000-4000-8000-000000000001/entitlement', {'tenantId': '00000000-0000-4000-8000-000000000001'}, {'mode': 'comp', 'seats': 5, 'reason': 'test'}),
  row('appliance', 'v1/appliance-installs/[tenantId]/extend-pro/route.ts', 'POST', undefined, '/api/v1/appliance-installs/00000000-0000-4000-8000-000000000001/extend-pro', {'tenantId': '00000000-0000-4000-8000-000000000001'}, {'ends_at': FUTURE_UNIX, 'reason': 'test'}),
  row('appliance', 'v1/appliance-installs/[tenantId]/pause-billing/route.ts', 'POST', undefined, '/api/v1/appliance-installs/00000000-0000-4000-8000-000000000001/pause-billing', {'tenantId': '00000000-0000-4000-8000-000000000001'}, {'behavior': 'void', 'reason': 'test'}),
  row('appliance', 'v1/appliance-installs/[tenantId]/reissue-activation-code/route.ts', 'POST', undefined, '/api/v1/appliance-installs/00000000-0000-4000-8000-000000000001/reissue-activation-code', {'tenantId': '00000000-0000-4000-8000-000000000001'}, {'reason': 'test'}),
  row('appliance', 'v1/appliance-installs/[tenantId]/reissue-install-code/route.ts', 'POST', undefined, '/api/v1/appliance-installs/00000000-0000-4000-8000-000000000001/reissue-install-code', {'tenantId': '00000000-0000-4000-8000-000000000001'}, {}),
  row('appliance', 'v1/appliance-installs/[tenantId]/resume-billing/route.ts', 'POST', undefined, '/api/v1/appliance-installs/00000000-0000-4000-8000-000000000001/resume-billing', {'tenantId': '00000000-0000-4000-8000-000000000001'}, {}),
  row('appliance', 'v1/appliance-installs/[tenantId]/revoke/route.ts', 'POST', undefined, '/api/v1/appliance-installs/00000000-0000-4000-8000-000000000001/revoke', {'tenantId': '00000000-0000-4000-8000-000000000001'}, {'reason': 'test'}),
  row('appliance', 'v1/appliance-installs/[tenantId]/status/route.ts', 'POST', undefined, '/api/v1/appliance-installs/00000000-0000-4000-8000-000000000001/status', {'tenantId': '00000000-0000-4000-8000-000000000001'}, {'status': 'suspended', 'reason': 'test'}),
  row('appliance', 'v1/appliance-installs/[tenantId]/appliances/[applianceId]/revoke/route.ts', 'POST', undefined, '/api/v1/appliance-installs/00000000-0000-4000-8000-000000000001/appliances/app-1/revoke', {'tenantId': '00000000-0000-4000-8000-000000000001', 'applianceId': 'app-1'}, {'reason': 'test'}),
  row('appliance', 'v1/appliance-installs/workflows/[workflowId]/route.ts', 'GET', undefined, '/api/v1/appliance-installs/workflows/appliance-revoke:abc:def', {'workflowId': 'appliance-revoke:abc:def'}, undefined),
];

export const allRows: RouteRow[] = [
  ...tenantManagementRows,
  ...platformOperatorRows,
  ...applianceAndProvisioningRows,
];

/**
 * Route files that deliberately have no gate. The download-url route answers a
 * constant 410 and touches no data.
 */
export const UNGATED_ROUTE_ALLOWLIST: string[] = ['v1/tenant-management/exports/[exportId]/download-url/route.ts'];
