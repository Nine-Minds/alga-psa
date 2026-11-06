import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useLabelPrint, type LabelPrintOutcome } from './useLabelPrint';

afterEach(() => vi.unstubAllGlobals());

describe('useLabelPrint', () => {
  it('passes worksheet error codes and sheet numbers from the API to the dialog', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        error: 'Worksheet 2 is clipped',
        errorCode: 'worksheetTextOverflow',
        worksheetNumbers: [2],
        failures: [],
      }),
    }));
    const { result } = renderHook(() => useLabelPrint());
    let outcome: LabelPrintOutcome | undefined;
    await act(async () => {
      outcome = await result.current.print({ labelClass: 'ticket-work-tag', labels: [{ recordId: 'ticket-1' }] });
    });
    expect(outcome).toEqual({
      status: 'failed',
      httpStatus: 422,
      message: 'Worksheet 2 is clipped',
      errorCode: 'worksheetTextOverflow',
      worksheetNumbers: [2],
      failures: [],
    });
  });
});
