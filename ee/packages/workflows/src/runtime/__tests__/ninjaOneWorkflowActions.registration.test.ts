import { vi } from 'vitest';
import { ninjaOneRegistrationContract } from './ninjaOneRegistrationContract';
import { initializeWorkflowRuntimeV2 } from '../bootstrap';

vi.mock('@alga-psa/db/workDate', () => ({
  computeWorkDateFields: vi.fn(() => ({ localDate: '2026-01-01' })),
  resolveUserTimeZone: vi.fn(() => 'America/New_York')
}));

// Import the runtime during module setup: cold dependency transformation is not
// part of the registration behavior measured by the test timeout. File isolation
// gives each entrypoint its own registries without resetting the entire graph.
ninjaOneRegistrationContract('bootstrap', initializeWorkflowRuntimeV2);
