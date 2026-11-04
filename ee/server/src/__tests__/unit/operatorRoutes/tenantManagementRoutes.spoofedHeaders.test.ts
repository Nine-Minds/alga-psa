import { vi } from 'vitest';
import { defineOperatorMatrix } from './operatorRouteHarness';
import { tenantManagementRows } from './routeTable';

// Identity sources (the only mocks around the real gate).
vi.mock('@alga-psa/user-composition/actions', async () => (await import('./operatorRouteHarness')).identityMocks().userComposition());
vi.mock('@alga-psa/auth', async () => (await import('./operatorRouteHarness')).identityMocks().auth());
vi.mock('@/lib/services/apiKeyServiceForApi', async () => (await import('./operatorRouteHarness')).identityMocks().apiKeyService());

// Tripwires: everything the tenant-management routes reach after the gate.
vi.mock('@alga-psa/db', async () => (await import('./operatorRouteHarness')).tripwire('@alga-psa/db'));
vi.mock('@alga-psa/db/admin', async () => (await import('./operatorRouteHarness')).tripwire('@alga-psa/db/admin'));
vi.mock('@ee/lib/tenant-management/workflowClient', async () => (await import('./operatorRouteHarness')).tripwire('@ee/lib/tenant-management/workflowClient'));
vi.mock('@ee/lib/platformReports', async () => (await import('./operatorRouteHarness')).tripwire('@ee/lib/platformReports'));
vi.mock('@ee/lib/storage/s3-client', async () => (await import('./operatorRouteHarness')).tripwire('@ee/lib/storage/s3-client'));
// Logging is spied but allowed: routes log on rejection too.
vi.mock('@/lib/observability/logging', async () => (await import('./operatorRouteHarness')).tripwire('@/lib/observability/logging', { allowed: true }));

defineOperatorMatrix('tenant-management routes with spoofed x-internal-* headers', tenantManagementRows);
