import { describe, it, expectTypeOf } from 'vitest';
import type { ISlaBackend } from '../backends/ISlaBackend';

describe('ISlaBackend', () => {
  it('has required method signatures', () => {
    type RequiredMethods = {
      startSlaTracking: (...args: any[]) => Promise<void>;
      pauseSla: (...args: any[]) => Promise<void>;
      resumeSla: (...args: any[]) => Promise<void>;
      completeSla: (...args: any[]) => Promise<void>;
      cancelSla: (...args: any[]) => Promise<void>;
      getSlaStatus: (...args: any[]) => Promise<any>;
    };

    expectTypeOf<ISlaBackend>().toMatchTypeOf<RequiredMethods>();
  });
});
