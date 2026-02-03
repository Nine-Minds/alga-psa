import { describe, it, expectTypeOf } from 'vitest';
import type { ISlaBackend } from '../backends/ISlaBackend';

describe('ISlaBackend', () => {
  it('has required method signatures', () => {
    type RequiredMethods = {
      startSlaTracking: (...args: unknown[]) => Promise<void>;
      pauseSla: (...args: unknown[]) => Promise<void>;
      resumeSla: (...args: unknown[]) => Promise<void>;
      completeSla: (...args: unknown[]) => Promise<void>;
      cancelSla: (...args: unknown[]) => Promise<void>;
      getSlaStatus: (...args: unknown[]) => Promise<unknown>;
    };

    expectTypeOf<ISlaBackend>().toMatchTypeOf<RequiredMethods>();
  });
});
