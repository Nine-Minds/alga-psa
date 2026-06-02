import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  getByInteractionIdMock: vi.fn(),
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) =>
    fn({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('../models/onlineMeeting', () => ({
  default: {
    getByInteractionId: hoisted.getByInteractionIdMock,
  },
}));

import { getOnlineMeetingForInteraction } from './onlineMeetingActions';

describe('onlineMeetingActions', () => {
  beforeEach(() => {
    hoisted.getByInteractionIdMock.mockReset();
  });

  it('gets an online meeting for an interaction scoped to the authenticated tenant', async () => {
    hoisted.getByInteractionIdMock.mockResolvedValue({
      tenant: 'tenant-1',
      meeting_id: 'meeting-1',
      interaction_id: 'interaction-1',
      artifacts: [],
    });

    const meeting = await getOnlineMeetingForInteraction('interaction-1');

    expect(hoisted.getByInteractionIdMock).toHaveBeenCalledWith('interaction-1', 'tenant-1');
    expect(meeting).toMatchObject({
      tenant: 'tenant-1',
      meeting_id: 'meeting-1',
      interaction_id: 'interaction-1',
      artifacts: [],
    });
  });

  it('returns null when no meeting exists for the interaction', async () => {
    hoisted.getByInteractionIdMock.mockResolvedValue(null);

    await expect(getOnlineMeetingForInteraction('interaction-without-meeting')).resolves.toBeNull();
    expect(hoisted.getByInteractionIdMock).toHaveBeenCalledWith('interaction-without-meeting', 'tenant-1');
  });

  it('rejects missing interaction ids before querying the model', async () => {
    await expect(getOnlineMeetingForInteraction('')).rejects.toThrow('Interaction ID is required');
    expect(hoisted.getByInteractionIdMock).not.toHaveBeenCalled();
  });
});
