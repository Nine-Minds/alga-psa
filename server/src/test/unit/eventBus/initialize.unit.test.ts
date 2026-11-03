import { describe, expect, it, vi } from 'vitest';

const registerAllSubscribersMock = vi.fn();
const initializeMock = vi.fn();

vi.mock('../../../lib/eventBus/subscribers', () => ({
  registerAllSubscribers: (...args: unknown[]) => registerAllSubscribersMock(...args),
}));
vi.mock('../../../lib/eventBus/index', () => ({
  getEventBus: () => ({ initialize: (...args: unknown[]) => initializeMock(...args) }),
}));
vi.mock('@alga-psa/notifications/actions', () => ({ registerInternalNotificationHook: vi.fn() }));
vi.mock('../../../lib/pushNotifications/pushNotificationDispatcher', () => ({ triggerPushForNotification: vi.fn() }));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), error: vi.fn() } }));

import { initializeEventBus } from '../../../lib/eventBus/initialize';

describe('event bus initialization', () => {
  it('fails startup when subscriber registration fails', async () => {
    registerAllSubscribersMock.mockRejectedValueOnce(new Error('maintenance subscriber unavailable'));

    await expect(initializeEventBus()).rejects.toThrow('maintenance subscriber unavailable');
    expect(initializeMock).not.toHaveBeenCalled();
  });
});
