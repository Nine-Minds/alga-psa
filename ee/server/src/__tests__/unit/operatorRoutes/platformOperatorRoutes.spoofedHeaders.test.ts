import { vi } from 'vitest';
import { defineOperatorMatrix } from './operatorRouteHarness';
import { platformOperatorRows } from './routeTable';

// Identity sources (the only mocks around the real gate).
vi.mock('@alga-psa/user-composition/actions', async () => (await import('./operatorRouteHarness')).identityMocks().userComposition());
vi.mock('@alga-psa/auth', async () => (await import('./operatorRouteHarness')).identityMocks().auth());
vi.mock('@/lib/services/apiKeyServiceForApi', async () => (await import('./operatorRouteHarness')).identityMocks().apiKeyService());

// Tripwires: everything the platform-reports / -notifications / -feature-flags routes reach after the gate.
vi.mock('@alga-psa/db', async () => (await import('./operatorRouteHarness')).tripwire('@alga-psa/db'));
vi.mock('@alga-psa/db/admin', async () => (await import('./operatorRouteHarness')).tripwire('@alga-psa/db/admin'));
vi.mock('@ee/lib/platformReports', async () => (await import('./operatorRouteHarness')).tripwire('@ee/lib/platformReports'));
vi.mock('@ee/lib/platformReports/blocklist', async () => (await import('./operatorRouteHarness')).tripwire('@ee/lib/platformReports/blocklist'));
vi.mock('@ee/lib/platformNotifications', async () => (await import('./operatorRouteHarness')).tripwire('@ee/lib/platformNotifications'));
vi.mock('@ee/lib/platformFeatureFlags', async () => (await import('./operatorRouteHarness')).tripwire('@ee/lib/platformFeatureFlags'));
vi.mock('@/lib/observability/logging', async () => (await import('./operatorRouteHarness')).tripwire('@/lib/observability/logging', { allowed: true }));

defineOperatorMatrix('platform-reports / -notifications / -feature-flags routes with spoofed x-internal-* headers', platformOperatorRows);
