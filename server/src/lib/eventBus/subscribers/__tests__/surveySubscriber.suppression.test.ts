import { describe, expect, it } from 'vitest';

import { __testHooks } from '../surveySubscriber';

describe('surveySubscriber ticket close suppression', () => {
  it('T021: skips survey invitations on contact suppression and allows them without flags', () => {
    expect(
      __testHooks.shouldSendTicketClosedSurveyInvitation({
        suppressContactNotifications: true,
      })
    ).toBe(false);

    expect(__testHooks.shouldSendTicketClosedSurveyInvitation({})).toBe(true);
  });
});
