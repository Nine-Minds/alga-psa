import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ sweep: vi.fn(), create: vi.fn() }));
vi.mock('../../../../../packages/co-managed/src/portableTemporaryDirectory', () => ({
  createPortableTemporarySweeper: mocks.create,
}));
import { startPortableTemporaryRecovery } from '../../../lib/portableTemporaryRecovery';
const scope = globalThis as { __portableTemporaryRecoveryTimer?: NodeJS.Timeout };
afterEach(() => {
  clearInterval(scope.__portableTemporaryRecoveryTimer); delete scope.__portableTemporaryRecoveryTimer;
  vi.useRealTimers(); vi.resetAllMocks();
});
it('runs at startup and each minute, and retains one timer across repeated startup calls', async () => {
  vi.useFakeTimers(); mocks.create.mockReturnValue({ sweep: mocks.sweep }); mocks.sweep.mockResolvedValue({ failed: 0 });
  const report = vi.fn(); startPortableTemporaryRecovery(report); startPortableTemporaryRecovery(report);
  expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.sweep).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.sweep).toHaveBeenCalledTimes(2); expect(report).not.toHaveBeenCalled();
});
it('reports bounded failures and continues after a failed sweep', async () => {
  vi.useFakeTimers(); mocks.create.mockReturnValue({ sweep: mocks.sweep });
  mocks.sweep.mockRejectedValueOnce(new Error('private storage path')).mockResolvedValueOnce({ failed: 1 }).mockResolvedValue({ failed: 0 });
  const report = vi.fn(); startPortableTemporaryRecovery(report);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(mocks.sweep).toHaveBeenCalledTimes(3); expect(report.mock.calls).toEqual([[], []]);
});
