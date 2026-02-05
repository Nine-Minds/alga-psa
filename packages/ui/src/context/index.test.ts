import { describe, it, expect } from 'vitest';
import { SchedulingContext } from './index';

describe('context index re-exports', () => {
  it('re-exports SchedulingContext', () => {
    expect(SchedulingContext).toBeDefined();
  });
});
