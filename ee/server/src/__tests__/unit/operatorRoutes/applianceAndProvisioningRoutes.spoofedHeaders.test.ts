import { vi } from 'vitest';
import { defineOperatorMatrix } from './operatorRouteHarness';
import { applianceAndProvisioningRows } from './routeTable';

// Identity sources (the only mocks around the real gate and real handleApplianceTrigger).
vi.mock('@alga-psa/user-composition/actions', async () => (await import('./operatorRouteHarness')).identityMocks().userComposition());
vi.mock('@alga-psa/auth', async () => (await import('./operatorRouteHarness')).identityMocks().auth());
vi.mock('@/lib/services/apiKeyServiceForApi', async () => (await import('./operatorRouteHarness')).identityMocks().apiKeyService());

// Tripwires: everything appliance-installs and provisioning reach after the gate.
vi.mock('@alga-psa/db', async () => (await import('./operatorRouteHarness')).tripwire('@alga-psa/db'));
vi.mock('@alga-psa/db/admin', async () => (await import('./operatorRouteHarness')).tripwire('@alga-psa/db/admin'));
vi.mock('@ee/lib/platformReports', async () => (await import('./operatorRouteHarness')).tripwire('@ee/lib/platformReports'));
vi.mock('@ee/lib/applianceConsole/algaLicenseAdminClient', async () => (await import('./operatorRouteHarness')).tripwire('@ee/lib/applianceConsole/algaLicenseAdminClient'));
vi.mock('@ee/lib/applianceConsole/workflowClient', async () => (await import('./operatorRouteHarness')).tripwire('@ee/lib/applianceConsole/workflowClient'));
vi.mock('@ee/lib/applianceConsole/stripeBilling', async () => (await import('./operatorRouteHarness')).tripwire('@ee/lib/applianceConsole/stripeBilling'));
vi.mock('@ee/services/provisioning', async () => (await import('./operatorRouteHarness')).tripwire('@ee/services/provisioning'));
vi.mock('@/lib/observability/logging', async () => (await import('./operatorRouteHarness')).tripwire('@/lib/observability/logging', { allowed: true }));

defineOperatorMatrix('appliance-installs and provisioning routes with spoofed x-internal-* headers', applianceAndProvisioningRows);
