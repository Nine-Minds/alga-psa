'use server'

import type { IOnlineMeeting } from '@alga-psa/types';
import { withAuth, hasPermission } from '@alga-psa/auth';
import OnlineMeetingModel from '../models/onlineMeeting';

export const getOnlineMeetingForInteraction = withAuth(async (
  user,
  { tenant },
  interactionId: string,
): Promise<IOnlineMeeting | null> => {
  if (!interactionId) {
    throw new Error('Interaction ID is required');
  }

  if (!(await hasPermission(user, 'interaction', 'read'))) {
    throw new Error('Forbidden');
  }

  return await OnlineMeetingModel.getByInteractionId(interactionId, tenant);
});

// `refreshMeetingRecordings` now lives in @alga-psa/scheduling/actions (it needs EE Microsoft
// Graph access, which clients must not depend on). The clients UI reaches it through the
// ClientCrossFeature context.
