import { describe, expect, it, vi } from 'vitest';
import { EvaluationBusyError } from '@alga-psa/workflows/runtime/expressionEngine';

vi.mock('@alga-psa/auth', () => ({ runWithApiKeyUser: vi.fn() }));
vi.mock('server/src/lib/api/middleware/apiAuthMiddleware', () => ({ authenticateApiKeyRequest: vi.fn() }));

import { handleWorkflowV2ApiError } from '../workflowRuntimeV2Api';

describe('handleWorkflowV2ApiError 429 mapping', () => {
  it('maps EvaluationBusyError to 429 with Retry-After', () => {
    const response = handleWorkflowV2ApiError(new EvaluationBusyError('busy', 'queue_timeout', 3, 2000, 4));
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('3');
  });

  it('maps a rate-limit style status error carrying retryAfterSeconds', () => {
    const error = Object.assign(new Error('Workflow simulation rate limit exceeded'), { status: 429, retryAfterSeconds: 12 });
    const response = handleWorkflowV2ApiError(error);
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('12');
  });

  it('does not add Retry-After to other statuses', () => {
    const response = handleWorkflowV2ApiError(Object.assign(new Error('nope'), { status: 413 }));
    expect(response.status).toBe(413);
    expect(response.headers.get('Retry-After')).toBeNull();
  });
});
