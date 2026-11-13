import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useLabelPrint, type LabelPrintOutcome } from './useLabelPrint';

afterEach(() => vi.unstubAllGlobals());

describe('useLabelPrint', () => {
  it('passes per-record worksheet failures from the API to the dialog', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({
        error: 'Label 2 (TIC-2): Contains text that does not fit.',
        failures: [{ index: 1, recordId: 'ticket-2', identifier: 'TIC-2', templateCode: 'standard-ticket-customer-worksheet', errorCode: 'worksheetTextOverflow', message: 'Contains text that does not fit.' }],
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
      message: 'Label 2 (TIC-2): Contains text that does not fit.',
      failures: [{ index: 1, recordId: 'ticket-2', identifier: 'TIC-2', templateCode: 'standard-ticket-customer-worksheet', errorCode: 'worksheetTextOverflow', message: 'Contains text that does not fit.' }],
    });
  });
});
