'use server'

import type { IOnlineMeeting } from '@alga-psa/types';
import { withAuth } from '@alga-psa/auth';
import OnlineMeetingModel from '../models/onlineMeeting';
import { assertMspPermission } from '../lib/authHelpers';

export const getOnlineMeetingForInteraction = withAuth(async (
  user,
  { tenant },
  interactionId: string,
): Promise<IOnlineMeeting | null> => {
  if (!interactionId) {
    throw new Error('Interaction ID is required');
  }

  await assertMspPermission(user, 'interaction', 'read', 'Forbidden');

  return await OnlineMeetingModel.getByInteractionId(interactionId, tenant);
});

// `refreshMeetingRecordings` now lives in @alga-psa/scheduling/actions (it needs EE Microsoft
// Graph access, which clients must not depend on). The clients UI reaches it through the
// ClientCrossFeature context.
