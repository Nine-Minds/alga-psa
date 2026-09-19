import { createPortableTemporarySweeper } from '../../../packages/co-managed/src/portableTemporaryDirectory';

/** Files are local to the application replica, so a remote job runner cannot
 * reclaim them. The process-global guard also survives development hot reload. */
export function startPortableTemporaryRecovery(reportFailure: () => void) {
  const scope = globalThis as { __portableTemporaryRecoveryTimer?: NodeJS.Timeout };
  if (scope.__portableTemporaryRecoveryTimer) return;
  const sweeper = createPortableTemporarySweeper();
  const tick = async () => {
    try { if ((await sweeper.sweep()).failed) reportFailure(); }
    catch { reportFailure(); }
  };
  scope.__portableTemporaryRecoveryTimer = setInterval(() => void tick(), 60_000);
  scope.__portableTemporaryRecoveryTimer.unref?.();
  void tick();
}
