/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDeletionValidation } from './useDeletionValidation';

vi.mock('../server/deletion/deletionActions', () => ({
  preCheckDeletion: vi.fn()
}));

import { preCheckDeletion } from '../server/deletion/deletionActions';

describe('useDeletionValidation', () => {
  it('T059: returns isValidating=true during validation', async () => {
    let resolvePromise: (value: any) => void = () => {};
    const pending = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    (preCheckDeletion as unknown as ReturnType<typeof vi.fn>).mockReturnValue(pending);

    const { result } = renderHook(() => useDeletionValidation('client'));

    act(() => {
      result.current.validate('client-1');
    });

    expect(result.current.isValidating).toBe(true);

    await act(async () => {
      resolvePromise({ canDelete: true, dependencies: [], alternatives: [] });
      await pending;
    });
  });

  it('T060: returns validationResult after successful validation', async () => {
    (preCheckDeletion as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      canDelete: true,
      dependencies: [],
      alternatives: []
    });

    const { result } = renderHook(() => useDeletionValidation('client'));

    await act(async () => {
      await result.current.validate('client-1');
    });

    expect(result.current.validationResult?.canDelete).toBe(true);
  });

  it('T061: returns error string when validation throws', async () => {
    (preCheckDeletion as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useDeletionValidation('client'));

    await act(async () => {
      await expect(result.current.validate('client-1')).rejects.toThrow('boom');
    });

    expect(result.current.error).toBe('boom');
  });

  it('T062: reset clears all state', async () => {
    (preCheckDeletion as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      canDelete: true,
      dependencies: [],
      alternatives: []
    });

    const { result } = renderHook(() => useDeletionValidation('client'));

    await act(async () => {
      await result.current.validate('client-1');
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.validationResult).toBeNull();
    expect(result.current.isValidating).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
