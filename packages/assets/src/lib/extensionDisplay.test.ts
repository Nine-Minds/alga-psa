import { describe, expect, it } from 'vitest';
import { formatCpuSummary } from './extensionDisplay';

describe('formatCpuSummary (alga0002283)', () => {
  it('formats model and cores', () => {
    expect(formatCpuSummary('Intel i7', 8)).toBe('Intel i7 (8 cores)');
  });
  it('keeps a real 0', () => {
    expect(formatCpuSummary('Intel i7', 0)).toBe('Intel i7 (0 cores)');
  });
  it('degrades to whichever part is known, or null', () => {
    expect(formatCpuSummary('Intel i7', null)).toBe('Intel i7');
    expect(formatCpuSummary('', 4)).toBe('4 cores');
    expect(formatCpuSummary('', null)).toBeNull();
    expect(formatCpuSummary(undefined, undefined)).toBeNull();
  });
});
