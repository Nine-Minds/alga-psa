import { describe, expect, it, vi } from 'vitest';
import type { StopwatchSessionView } from '@alga-psa/types';
import { createHeaderStopLauncher } from '../../components/layout/stopwatchHeaderStop';

const session = { session_id: 's1', work_item_type: 'ticket', work_item_id: 't1' } as unknown as StopwatchSessionView;
const args = { session, span: {} as any, onLogged: vi.fn() };

describe('header Stop launcher', () => {
  it('opens the log drawer when an outlet is mounted', async () => {
    const drawerLauncher = vi.fn().mockResolvedValue(undefined);
    const notify = vi.fn();
    await createHeaderStopLauncher({ hasOutlet: () => true, drawerLauncher, notifyPausedWithoutDrawer: notify })(args);
    expect(drawerLauncher).toHaveBeenCalledWith(args);
    expect(notify).not.toHaveBeenCalled();
  });

  it('never silently does nothing: with no outlet it notifies instead of opening the drawer', async () => {
    const drawerLauncher = vi.fn();
    const notify = vi.fn();
    await createHeaderStopLauncher({ hasOutlet: () => false, drawerLauncher, notifyPausedWithoutDrawer: notify })(args);
    expect(drawerLauncher).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(session);
  });
});
