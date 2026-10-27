import { afterEach, describe, expect, it, vi } from 'vitest';
import { runTicketRefresh } from '../../components/ticket/TicketDataSourceContext';

describe('runTicketRefresh', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('hands the mode to the source refresh when it supplies one', () => {
    const refresh = vi.fn();
    const router = { refresh: vi.fn() };
    runTicketRefresh({ screen: { refresh } }, 'soft', router);
    runTicketRefresh({ screen: { refresh } }, 'reload', router);
    expect(refresh.mock.calls).toEqual([['soft'], ['reload']]);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('falls back to router.refresh() for a soft refresh', () => {
    const router = { refresh: vi.fn() };
    runTicketRefresh({ screen: {} }, 'soft', router);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('falls back to window.location.reload() for a reload', () => {
    const reload = vi.fn();
    vi.stubGlobal('window', { location: { reload } });
    runTicketRefresh({ screen: {} }, 'reload');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not throw for a soft refresh without a router', () => {
    expect(() => runTicketRefresh({ screen: {} }, 'soft')).not.toThrow();
  });

  it('swallows a rejecting source refresh', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    runTicketRefresh({ screen: { refresh: () => Promise.reject(new Error('boom')) } }, 'soft');
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });
});
